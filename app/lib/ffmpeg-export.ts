import { fetchFile } from "@ffmpeg/util";

type ExportOptions = {
  file: File;
  playbackRate: number;
  offsetSec: number;
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
};

declare global {
  interface Window {
    FFmpegWASM?: { FFmpeg: new () => FFmpegLike };
  }
}

let ffmpegInstance: FFmpegLike | null = null;
let ffmpegLoading: Promise<FFmpegLike> | null = null;
let logBuffer: string[] = [];

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
      // eslint-disable-next-line no-console
      console.debug(line);
    });
    ffmpeg.on("progress", ({ progress }) => {
      onProgress?.(progress);
    });

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

export async function exportVideoWithOffset(options: ExportOptions) {
  const { file, playbackRate, offsetSec, onProgress } = options;
  const ffmpeg = await getFFmpeg(onProgress);

  logBuffer = [];
  const inputName = "input.mp4";
  const outputName = "output.mp4";
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
  } catch {
    throw new Error("入力ファイルの読み込みに失敗しました。");
  }

  const videoFilter = `setpts=PTS/${playbackRate}`;

  const audioFilters: string[] = [];
  if (offsetSec > 0) {
    const ms = Math.round(offsetSec * 1000);
    audioFilters.push(`adelay=${ms}|${ms}`);
  } else if (offsetSec < 0) {
    const abs = Math.abs(offsetSec);
    audioFilters.push(`atrim=start=${abs}`, "asetpts=PTS-STARTPTS");
  }

  audioFilters.push(...buildAtempoFilters(playbackRate));
  const audioFilter = audioFilters.length > 0 ? audioFilters.join(",") : "anull";

  const filterComplex = `[0:v]${videoFilter}[v];[0:a]${audioFilter}[a]`;

  try {
    await ffmpeg.exec([
      "-i",
      inputName,
      "-filter_complex",
      filterComplex,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputName,
    ]);
  } catch {
    const detail = logBuffer.slice(-20).join("\n");
    const message = detail
      ? `書き出しに失敗しました。\n\nFFmpeg log:\n${detail}`
      : "書き出しに失敗しました。";
    throw new Error(message);
  }

  const data = await ffmpeg.readFile(outputName);
  const ab = new Uint8Array(data).buffer;
  return new Blob([ab], { type: "video/mp4" });
}
