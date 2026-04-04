import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const REPO_ROOT = process.cwd();
const TMP_ROOT = path.join(REPO_ROOT, ".tmp", "youtube-imports");
const DEFAULT_MAX_FILESIZE_MB = 250;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov"]);
const FORMAT_SELECTORS = [
  "best[height<=720][vcodec!=none][acodec!=none][ext=mp4]",
  "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]",
  "bestvideo[height<=720]+bestaudio",
  "best[vcodec!=none][acodec!=none][ext=mp4]",
  "best[vcodec!=none][acodec!=none]",
];

type CommandResult = {
  stdout: string;
  stderr: string;
};

export async function importYouTubeVideo(options: {
  url: string;
  videoId: string;
  title?: string;
}) {
  const jobDir = path.join(TMP_ROOT, randomUUID());
  const outputTemplate = path.join(jobDir, "%(id)s.%(ext)s");
  const ytDlpPath = process.env.YT_DLP_PATH || "yt-dlp";
  const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
  const cookieArgs = getYtDlpCookieArgs();
  const maxFilesizeMb =
    parsePositiveInteger(process.env.YT_DLP_MAX_FILESIZE_MB) ?? DEFAULT_MAX_FILESIZE_MB;

  await fs.mkdir(jobDir, { recursive: true });

  try {
    const importedPath = await downloadVideoWithRetry({
      cookieArgs,
      ffmpegPath,
      jobDir,
      maxFilesizeMb,
      outputTemplate,
      url: options.url,
      ytDlpPath,
    });
    const data = await fs.readFile(importedPath);
    const fileName = buildOutputFilename(options.title, options.videoId);

    return {
      buffer: data,
      fileName,
    };
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadVideoWithRetry(options: {
  cookieArgs: string[];
  ffmpegPath: string;
  jobDir: string;
  maxFilesizeMb: number;
  outputTemplate: string;
  url: string;
  ytDlpPath: string;
}) {
  let lastError: Error | null = null;

  for (const selector of FORMAT_SELECTORS) {
    await clearDirectory(options.jobDir);

    try {
      const result = await runCommand(
        options.ytDlpPath,
        [
          "--no-playlist",
          "--no-warnings",
          ...options.cookieArgs,
          "--print",
          "after_move:filepath",
          "-o",
          options.outputTemplate,
          "-f",
          selector,
          "--merge-output-format",
          "mp4",
          "--max-filesize",
          `${options.maxFilesizeMb}M`,
          "--ffmpeg-location",
          options.ffmpegPath,
          options.url,
        ],
        REPO_ROOT
      );

      const importedPath = await resolveImportedFile(options.jobDir, result.stdout);
      return importedPath;
    } catch (error) {
      lastError =
        error instanceof Error
          ? new Error(`[selector: ${selector}] ${error.message}`)
          : new Error("YouTube 動画の取得に失敗しました。");
    }
  }

  throw lastError ?? new Error("映像付きの動画ファイルを作成できませんでした。");
}

async function clearDirectory(targetDir: string) {
  const entries = await fs.readdir(targetDir).catch(() => []);
  await Promise.all(
    entries.map((entry) =>
      fs.rm(path.join(targetDir, entry), { recursive: true, force: true }).catch(() => {})
    )
  );
}

async function runCommand(command: string, args: string[], cwd: string) {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        reject(
          new Error(
            "yt-dlp または ffmpeg が見つかりません。YT_DLP_PATH / FFMPEG_PATH を設定してください。"
          )
        );
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
      reject(new Error(formatYtDlpError(detail)));
    });
  });
}

async function resolveImportedFile(jobDir: string, stdout: string) {
  const printedPath = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (printedPath) {
    const candidate = path.isAbsolute(printedPath)
      ? printedPath
      : path.resolve(jobDir, printedPath);

    if (await fileExists(candidate) && isVideoContainer(candidate)) {
      return candidate;
    }
  }

  const entries = await fs.readdir(jobDir);
  const preferred = entries.find((entry) => isVideoContainer(entry));
  if (!preferred) {
    throw new Error("映像付きの動画ファイルを作成できませんでした。");
  }

  return path.join(jobDir, preferred);
}

async function fileExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function buildOutputFilename(title: string | undefined, videoId: string) {
  const baseName = sanitizeFilename(title?.trim() || `youtube-${videoId}`);
  return `${baseName || `youtube-${videoId}`}.mp4`;
}

function sanitizeFilename(input: string) {
  return input.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim().slice(0, 80);
}

function parsePositiveInteger(value: string | undefined) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isVideoContainer(fileNameOrPath: string) {
  const lowered = fileNameOrPath.toLowerCase();
  if (lowered.endsWith(".part")) return false;
  return VIDEO_EXTENSIONS.has(path.extname(lowered));
}

function getYtDlpCookieArgs() {
  const cookiesPath =
    process.env.YT_DLP_COOKIES_PATH?.trim() || process.env.YT_DLP_COOKIES_FILE?.trim();
  if (cookiesPath) {
    return ["--cookies", cookiesPath];
  }

  const cookiesFromBrowser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
  if (cookiesFromBrowser) {
    return ["--cookies-from-browser", cookiesFromBrowser];
  }

  return [];
}

function formatYtDlpError(detail: string) {
  if (/Sign in to confirm you.+not a bot/i.test(detail)) {
    return [
      "yt-dlp の実行に失敗しました: YouTube 側で bot 確認が必要です。",
      "Edge を完全に終了したうえで `YT_DLP_COOKIES_FROM_BROWSER=edge` を使うか、",
      "`YT_DLP_COOKIES_PATH` に cookies.txt を指定してください。",
      `詳細: ${detail}`,
    ].join(" ");
  }

  if (/Failed to decrypt with DPAPI/i.test(detail)) {
    return [
      "yt-dlp の実行に失敗しました: ブラウザ cookies の復号に失敗しました。",
      "この環境では Chrome cookies の自動読込が失敗しています。",
      "Edge を完全に終了して `YT_DLP_COOKIES_FROM_BROWSER=edge` を使うか、",
      "`YT_DLP_COOKIES_PATH` に cookies.txt を指定してください。",
      `詳細: ${detail}`,
    ].join(" ");
  }

  if (/Could not copy Chrome cookie database/i.test(detail)) {
    return [
      "yt-dlp の実行に失敗しました: ブラウザ cookies DB を開けませんでした。",
      "Edge または Chrome を完全に終了して再試行するか、",
      "`YT_DLP_COOKIES_PATH` に cookies.txt を指定してください。",
      `詳細: ${detail}`,
    ].join(" ");
  }

  return `yt-dlp の実行に失敗しました: ${detail}`;
}
