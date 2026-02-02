import { fetchFile } from "@ffmpeg/util";

type ExportOptions = {
  file: File;
  playbackRate: number; // 例: 1.0, 0.75, 1.25
  offsetSec: number;    // +で遅らせる / -で早める
  onProgress?: (progress: number) => void;
};

type FFmpegLike = {
  on: (
    event: "log" | "progress",
    cb: (payload: { type: string; message: string; progress: number }) => void
  ) => void;
  load: (options: { coreURL: string; wasmURL: string }) => Promise<void>;
  exec: (args: string[]) => Promise<void>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  readFile: (path: string) => Promise<Uint8Array>;
  // ffmpeg.wasm v0.12+ だと deleteFile があることが多い（型に無くても動く）
  deleteFile?: (path: string) => Promise<void>;
};

declare global {
  interface Window {
    FFmpegWASM?: { FFmpeg: new () => FFmpegLike };
  }
}

let ffmpegInstance: FFmpegLike | null = null;
let ffmpegLoading: Promise<FFmpegLike> | null = null;
let logBuffer: string[] = [];

/** 同一セッション内の簡易キャッシュ（同じ入力×条件なら2回目は即返す） */
const exportCache = new Map<string, Blob>();

async function getFFmpeg(onProgress?: (progress: number) => void) {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    const globalFFmpeg = window.FFmpegWASM;
    if (!globalFFmpeg?.FFmpeg) {
      throw new Error("FFmpeg ランタイムが読み込まれていません。");
    }

    const ffmpeg: FFmpegLike = new globalFFmpeg.FFmpeg();

    ffmpeg.on("log", ({ type, message }) => {
      const line = `[${type}] ${message}`;
      logBuffer.push(line);
      if (logBuffer.length > 200) logBuffer.shift();
      console.debug(line);
    });
    ffmpeg.on("progress", ({ progress }) => onProgress?.(progress));

    const baseURL = "/ffmpeg";
    await ffmpeg.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return ffmpegLoading;
}

function buildAtempoFilters(rate: number) {
  const filters: string[] = [];
  let r = rate;

  while (r < 0.5) {
    filters.push("atempo=0.5");
    r /= 0.5;
  }
  while (r > 2.0) {
    filters.push("atempo=2.0");
    r /= 2.0;
  }
  if (Math.abs(r - 1.0) > 0.0001) {
    filters.push(`atempo=${r.toFixed(3)}`);
  }
  return filters;
}

/** 720pに落とす（長辺1280）。縦横比維持 */
function buildScaleTo720p() {
  // 横が長いなら幅1280、縦が長いなら高さ720に寄せる
  // -2 は 2の倍数へ丸め（x264互換）
  return "scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(720,ih))'";
}

function clampRate(rate: number) {
  if (!Number.isFinite(rate) || rate <= 0) return 1.0;
  return rate;
}

export async function exportVideoWithOffset(options: ExportOptions) {
  const { file, playbackRate, offsetSec, onProgress } = options;

  const rate = clampRate(playbackRate);
  const offset = Number.isFinite(offsetSec) ? offsetSec : 0;

  // 1) 変換不要なら即返す（最速）
  if (Math.abs(rate - 1.0) < 1e-6 && Math.abs(offset) < 1e-6) {
    return file; // FileはBlob互換
  }

  // 2) キャッシュキー（同一ファイル×条件なら使い回す）
  // ※ file.lastModified はブラウザ次第で変わることがあるが、軽い用途としては十分
  const cacheKey = `${file.name}:${file.size}:${file.lastModified}:r=${rate}:o=${offset}`;
  const cached = exportCache.get(cacheKey);
  if (cached) return cached;

  const ffmpeg = await getFFmpeg(onProgress);

  logBuffer = [];

  // 入力/出力ファイル名を毎回ユニークに（衝突＆残骸防止）
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const inputName = `input_${stamp}.mp4`;
  const outputName = `output_${stamp}.mp4`;

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
  } catch {
    throw new Error("入力ファイルの読み込みに失敗しました。");
  }

  // 3) offsetだけ（rate=1）の場合：まず -c copy を試す（爆速）
  if (Math.abs(rate - 1.0) < 1e-6 && Math.abs(offset) > 1e-6) {
    try {
      const o = offset.toFixed(3);

      await ffmpeg.exec([
        "-i", inputName,
        "-itsoffset", o, "-i", inputName,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c", "copy",
        "-movflags", "+faststart",
        outputName,
      ]);

      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data], { type: "video/mp4" });
      exportCache.set(cacheKey, blob);

      // 後片付け（あれば）
      await ffmpeg.deleteFile?.(inputName).catch(() => {});
      await ffmpeg.deleteFile?.(outputName).catch(() => {});

      return blob;
    } catch {
      // copyが通らないケースがあるので、下の「再エンコード」にフォールバック
    }
  }

  // 4) 速度変更あり or copy失敗：フィルタで再エンコード
  // video: setpts + 720pスケール + fps少し制限（軽くする）
  const scale720p = buildScaleTo720p();
  const videoFilter = `setpts=PTS/${rate},${scale720p},fps=30`;

  // audio: offset処理 → atempo
  const audioFilters: string[] = [];
  if (offset > 0) {
    const ms = Math.round(offset * 1000);
    audioFilters.push(`adelay=${ms}|${ms}`);
  } else if (offset < 0) {
    const abs = Math.abs(offset);
    audioFilters.push(`atrim=start=${abs}`, "asetpts=PTS-STARTPTS");
  }
  audioFilters.push(...buildAtempoFilters(rate));
  const audioFilter = audioFilters.length ? audioFilters.join(",") : "anull";

  const filterComplex = `[0:v]${videoFilter}[v];[0:a]${audioFilter}[a]`;

  try {
    await ffmpeg.exec([
      "-i", inputName,
      "-filter_complex", filterComplex,
      "-map", "[v]",
      "-map", "[a]",
      // ブラウザ環境では ultrafast が効く
      "-c:v", "libx264",
      "-preset", "ultrafast",
      // 720pで5分なら CRF 30 前後が「速い＆そこそこ」ライン
      "-crf", "30",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      // 先に終わった方に合わせる（ズレ処理で長さがずれやすい）
      "-shortest",
      outputName,
    ]);
  } catch {
    const detail = logBuffer.slice(-25).join("\n");
    const message = detail
      ? `書き出しに失敗しました。\n\nFFmpeg log:\n${detail}`
      : "書き出しに失敗しました。";
    throw new Error(message);
  }

  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data], { type: "video/mp4" });
  exportCache.set(cacheKey, blob);

  // 後片付け
  await ffmpeg.deleteFile?.(inputName).catch(() => {});
  await ffmpeg.deleteFile?.(outputName).catch(() => {});

  return blob;
}
