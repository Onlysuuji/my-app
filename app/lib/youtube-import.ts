import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const REPO_ROOT = process.cwd();
const TMP_ROOT =
  process.env.YOUTUBE_IMPORT_TMP_ROOT?.trim() ||
  path.join(REPO_ROOT, ".tmp", "youtube-imports");
const DEFAULT_MAX_FILESIZE_MB = 250;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT_IMPORTS = 2;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov"]);
const FORMAT_SELECTORS = [
  "bestvideo*[height<=720][vcodec^=avc1][ext=mp4]+bestaudio[acodec!=none][ext=m4a]/best*[height<=720][vcodec^=avc1][acodec!=none][ext=mp4]",
  "bestvideo*[vcodec^=avc1][ext=mp4]+bestaudio[acodec!=none][ext=m4a]/best*[vcodec^=avc1][acodec!=none][ext=mp4]",
  "bestvideo*[height<=720][ext=mp4]+bestaudio[acodec!=none][ext=m4a]/best*[height<=720][acodec!=none][vcodec!=none][ext=mp4]",
  "bestvideo*[ext=mp4]+bestaudio[acodec!=none][ext=m4a]/best*[acodec!=none][vcodec!=none][ext=mp4]",
  "bestvideo*+bestaudio/best*[acodec!=none][vcodec!=none]/best",
];

let activeImportCount = 0;

type CommandResult = {
  stdout: string;
  stderr: string;
};

type ProbedMediaStreams = {
  hasAudio: boolean;
  hasVideo: boolean;
};

type CookieAuthStrategy = {
  args: string[];
  label: string;
};

type ImportErrorCode =
  | "IMPORT_BUSY"
  | "IMPORT_CONFIG"
  | "IMPORT_TIMEOUT"
  | "IMPORT_TOO_LARGE";

export type ImportedYouTubeVideo = {
  filePath: string;
  fileName: string;
  contentLength: number;
  cleanup: () => Promise<void>;
};

export class YouTubeImportError extends Error {
  status: number;
  code: ImportErrorCode;

  constructor(message: string, options: { code: ImportErrorCode; status: number }) {
    super(message);
    this.name = "YouTubeImportError";
    this.code = options.code;
    this.status = options.status;
  }
}

export async function importYouTubeVideo(options: {
  url: string;
  videoId: string;
  title?: string;
}): Promise<ImportedYouTubeVideo> {
  return withImportSlot(async () => {
    const jobDir = path.join(TMP_ROOT, randomUUID());
    const outputTemplate = path.join(jobDir, "%(id)s.%(ext)s");
    const ytDlpPath = await resolveExecutablePath("YT_DLP_PATH", "yt-dlp");
    const ffmpegPath = await resolveExecutablePath("FFMPEG_PATH", "ffmpeg");
    const cookieAuthStrategies = getYtDlpCookieStrategies();
    const maxFilesizeMb =
      parsePositiveInteger(process.env.YT_DLP_MAX_FILESIZE_MB) ?? DEFAULT_MAX_FILESIZE_MB;
    const timeoutMs = parsePositiveInteger(process.env.YT_DLP_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
    const cleanup = createCleanup(jobDir);

    await fs.mkdir(jobDir, { recursive: true });

    try {
      const importedPath = await downloadVideoWithRetry({
        cookieAuthStrategies,
        ffmpegPath,
        jobDir,
        maxFilesizeMb,
        outputTemplate,
        timeoutMs,
        url: options.url,
        ytDlpPath,
      });
      const { size } = await fs.stat(importedPath);
      const fileName = buildOutputFilename(options.title, options.videoId);

      return {
        filePath: importedPath,
        fileName,
        contentLength: size,
        cleanup,
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  });
}

async function downloadVideoWithRetry(options: {
  cookieAuthStrategies: CookieAuthStrategy[];
  ffmpegPath: string;
  jobDir: string;
  maxFilesizeMb: number;
  outputTemplate: string;
  timeoutMs: number;
  url: string;
  ytDlpPath: string;
}) {
  try {
    return await downloadVideoWithSelectors({
      ...options,
      cookieArgs: [],
      label: "no-cookies",
    });
  } catch (error) {
    if (
      !options.cookieAuthStrategies.length ||
      !(error instanceof Error) ||
      !shouldRetryWithCookies(error)
    ) {
      throw error;
    }
  }

  let lastCookieError: Error | null = null;

  for (const strategy of options.cookieAuthStrategies) {
    try {
      return await downloadVideoWithSelectors({
        ...options,
        cookieArgs: strategy.args,
        label: strategy.label,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /Requested format is not available/i.test(error.message)
      ) {
        const cookieFormatError = await diagnoseCookieFormatFailure({
          cookieArgs: strategy.args,
          strategyLabel: strategy.label,
          timeoutMs: options.timeoutMs,
          url: options.url,
          ytDlpPath: options.ytDlpPath,
        });

        if (cookieFormatError) {
          lastCookieError = new Error(cookieFormatError);
          continue;
        }
      }

      lastCookieError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastCookieError ?? new Error("YouTube import failed.");
}

async function downloadVideoWithSelectors(options: {
  cookieArgs: string[];
  ffmpegPath: string;
  jobDir: string;
  label: string;
  maxFilesizeMb: number;
  outputTemplate: string;
  timeoutMs: number;
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
        REPO_ROOT,
        options.timeoutMs
      );

      const importedPath = await resolveImportedFile(options.jobDir, result.stdout);
      await waitForUsableImportedFile(importedPath, options.ffmpegPath);
      await ensureImportedFileSize(importedPath, options.maxFilesizeMb);
      return importedPath;
    } catch (error) {
      if (shouldAbortSelectorFallback(error)) {
        throw error;
      }

      lastError =
        error instanceof Error
          ? new Error(`[${options.label}][selector: ${selector}] ${error.message}`)
          : new Error("YouTube 動画の取り込みに失敗しました。");
    }
  }

  throw lastError ?? new Error("有効な形式の動画ファイルを取得できませんでした。");
}

async function clearDirectory(targetDir: string) {
  const entries = await fs.readdir(targetDir).catch(() => [] as string[]);
  await Promise.all(
    entries.map((entry) =>
      fs.rm(path.join(targetDir, entry), { recursive: true, force: true }).catch(() => {})
    )
  );
}

async function runCommand(command: string, args: string[], cwd: string, timeoutMs: number) {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finishResolve = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    };

    const timeoutId = setTimeout(() => {
      child.kill("SIGKILL");
      finishReject(
        new YouTubeImportError(
          "yt-dlp の処理がタイムアウトしました。少し待ってから再試行してください。",
          { code: "IMPORT_TIMEOUT", status: 504 }
        )
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        finishReject(
          new YouTubeImportError(
            "yt-dlp または ffmpeg が見つかりません。YT_DLP_PATH / FFMPEG_PATH を確認してください。",
            { code: "IMPORT_CONFIG", status: 500 }
          )
        );
        return;
      }

      finishReject(error instanceof Error ? error : new Error(String(error)));
    });

    child.on("close", (code) => {
      if (code === 0) {
        finishResolve({ stdout, stderr });
        return;
      }

      const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
      finishReject(new Error(formatYtDlpError(detail)));
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

    const preferredSibling = await findPreferredImportedFile(jobDir, candidate);
    if (preferredSibling) {
      return preferredSibling;
    }

    if (await fileExists(candidate) && isVideoContainer(candidate)) {
      return candidate;
    }
  }

  const preferred = await findPreferredImportedFile(jobDir);
  if (!preferred) {
    throw new Error("有効な形式の動画ファイルを取得できませんでした。");
  }

  return preferred;
}

async function ensureImportedFileSize(importedPath: string, maxFilesizeMb: number) {
  const { size } = await fs.stat(importedPath);
  const maxBytes = maxFilesizeMb * 1024 * 1024;

  if (size <= maxBytes) {
    return;
  }

  throw new YouTubeImportError(
    `動画サイズが上限を超えています。${maxFilesizeMb}MB 以下の動画を選んでください。`,
    { code: "IMPORT_TOO_LARGE", status: 413 }
  );
}

async function waitForUsableImportedFile(importedPath: string, ffmpegPath: string) {
  let previousSize = -1;
  let stableChecks = 0;
  let lastProbe: ProbedMediaStreams | null = null;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { size } = await fs.stat(importedPath);

    if (size > 0 && size === previousSize) {
      stableChecks += 1;
    } else {
      stableChecks = 0;
      previousSize = size;
    }

    if (size > 0) {
      lastProbe = await probeMediaStreams(importedPath, ffmpegPath);
      if (stableChecks >= 2 && lastProbe.hasVideo && lastProbe.hasAudio) {
        return;
      }
    }

    await wait(250);
  }

  if (lastProbe && !lastProbe.hasAudio) {
    throw new Error("音声トラック付きの MP4 を作れませんでした。");
  }

  if (lastProbe && !lastProbe.hasVideo) {
    throw new Error("映像トラック付きの MP4 を作れませんでした。");
  }

  throw new Error("取り込みファイルの完成待ちがタイムアウトしました。");
}

async function fileExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function withImportSlot<T>(operation: () => Promise<T>) {
  const maxConcurrentImports =
    parsePositiveInteger(process.env.YOUTUBE_IMPORT_MAX_CONCURRENT) ??
    DEFAULT_MAX_CONCURRENT_IMPORTS;

  if (activeImportCount >= maxConcurrentImports) {
    throw new YouTubeImportError(
      "YouTube 取り込みが混み合っています。少し待ってから再試行してください。",
      { code: "IMPORT_BUSY", status: 503 }
    );
  }

  activeImportCount += 1;

  try {
    return await operation();
  } finally {
    activeImportCount = Math.max(0, activeImportCount - 1);
  }
}

function shouldAbortSelectorFallback(error: unknown) {
  return error instanceof YouTubeImportError;
}

function shouldRetryWithCookies(error: Error) {
  return [
    /sign in to confirm you.+not a bot/i,
    /cookies\.txt/i,
    /login required/i,
    /members-only/i,
    /private video/i,
    /bot 確認が必要/,
  ].some((pattern) => pattern.test(error.message));
}

async function findPreferredImportedFile(jobDir: string, printedCandidate?: string) {
  const entries = await fs.readdir(jobDir).catch(() => [] as string[]);
  const videoFiles = entries
    .filter((entry) => isVideoContainer(entry))
    .map((entry) => path.join(jobDir, entry));

  if (!videoFiles.length) {
    return null;
  }

  const mergedFiles = videoFiles.filter((filePath) => !hasFormatSuffix(filePath));
  if (printedCandidate) {
    const printedBaseName = path.basename(printedCandidate).replace(/\.f\d+\./i, ".");
    const exactMerged = mergedFiles.find((filePath) => path.basename(filePath) === printedBaseName);
    if (exactMerged) {
      return exactMerged;
    }
  }

  if (mergedFiles.length) {
    return pickLargestFile(mergedFiles);
  }

  return pickLargestFile(videoFiles);
}

function hasFormatSuffix(filePath: string) {
  return /\.f\d+\./i.test(path.basename(filePath));
}

async function pickLargestFile(filePaths: string[]) {
  const withStats = await Promise.all(
    filePaths.map(async (filePath) => ({
      filePath,
      size: (await fs.stat(filePath)).size,
    }))
  );

  withStats.sort((a, b) => b.size - a.size);
  return withStats[0]?.filePath ?? null;
}

async function probeMediaStreams(importedPath: string, ffmpegPath: string) {
  const result = await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ["-hide_banner", "-i", importedPath],
      {
        cwd: REPO_ROOT,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finishResolve = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        finishReject(
          new YouTubeImportError(
            "ffmpeg が見つかりません。FFMPEG_PATH を確認してください。",
            { code: "IMPORT_CONFIG", status: 500 }
          )
        );
        return;
      }

      finishReject(error instanceof Error ? error : new Error(String(error)));
    });

    child.on("close", (code) => {
      const detail = `${stdout}\n${stderr}`.trim();
      if (!detail && code !== 0) {
        finishReject(new Error(`exit code ${code}`));
        return;
      }
      finishResolve({ stdout, stderr });
    });
  });

  const detail = `${result.stdout}\n${result.stderr}`;
  return {
    hasAudio: /Audio:/i.test(detail),
    hasVideo: /Video:/i.test(detail),
  };
}

async function diagnoseCookieFormatFailure(options: {
  cookieArgs: string[];
  strategyLabel: string;
  timeoutMs: number;
  url: string;
  ytDlpPath: string;
}) {
  try {
    const result = await runCommand(
      options.ytDlpPath,
      ["--no-playlist", "--no-warnings", ...options.cookieArgs, "--list-formats", options.url],
      REPO_ROOT,
      Math.min(options.timeoutMs, 60_000)
    );
    const detail = `${result.stdout}\n${result.stderr}`;

    if (hasOnlyStoryboardFormats(detail)) {
      return buildCookieFormatErrorMessage(options.strategyLabel);
    }
  } catch {
    // Keep the original selector failure if the diagnostic probe also fails.
  }

  return null;
}

function hasOnlyStoryboardFormats(detail: string) {
  const formatRows = detail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("[youtube]") && !line.startsWith("[info]"))
    .filter((line) => !/^ID\s+EXT/i.test(line) && !/^-{3,}$/.test(line));

  return formatRows.length > 0 && formatRows.every((line) => /storyboard/i.test(line));
}

function buildCookieFormatErrorMessage(strategyLabel: string) {
  if (strategyLabel === "cookies-file") {
    return "現在の cookies.txt ではこの動画の動画/音声フォーマットを取得できません。cookies.txt を更新して再試行してください。";
  }

  const browserMatch = strategyLabel.match(/^browser-(.+)$/);
  if (browserMatch) {
    return `${browserMatch[1]} のブラウザ cookies ではこの動画の動画/音声フォーマットを取得できません。ブラウザを閉じて再試行するか、cookies.txt を更新してください。`;
  }

  return "自動取得した cookies ではこの動画の動画/音声フォーマットを取得できません。ブラウザを閉じて再試行するか、cookies.txt を更新してください。";
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createCleanup(jobDir: string) {
  let cleaned = false;

  return async () => {
    if (cleaned) {
      return;
    }

    cleaned = true;
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  };
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

async function resolveExecutablePath(envName: string, fallbackCommand: string) {
  const candidates = [
    process.env[envName]?.trim(),
    await readEnvFileValue(envName),
    fallbackCommand,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await isExecutableCandidateUsable(candidate)) {
      return candidate;
    }
  }

  return fallbackCommand;
}

async function isExecutableCandidateUsable(candidate: string) {
  if (!looksLikeFilePath(candidate)) {
    return true;
  }

  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function looksLikeFilePath(value: string) {
  return (
    value.includes("\\") ||
    value.includes("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.startsWith(".")
  );
}

let envFileEntriesPromise: Promise<Map<string, string>> | null = null;

async function readEnvFileValue(key: string) {
  const entries = await loadEnvFileEntries();
  return entries.get(key)?.trim();
}

async function loadEnvFileEntries() {
  if (!envFileEntriesPromise) {
    envFileEntriesPromise = readEnvFiles();
  }

  return envFileEntriesPromise;
}

async function readEnvFiles() {
  const entries = new Map<string, string>();
  const files = [".env", ".env.production", ".env.local"];

  for (const fileName of files) {
    const filePath = path.join(REPO_ROOT, fileName);
    const content = await fs.readFile(filePath, "utf8").catch(() => null);
    if (!content) continue;

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;

      const name = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      entries.set(name, stripEnvWrappingQuotes(rawValue));
    }
  }

  return entries;
}

function stripEnvWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function isVideoContainer(fileNameOrPath: string) {
  const lowered = fileNameOrPath.toLowerCase();
  if (lowered.endsWith(".part")) return false;
  return VIDEO_EXTENSIONS.has(path.extname(lowered));
}

function getYtDlpCookieStrategies() {
  const strategies: CookieAuthStrategy[] = [];
  const cookiesPath =
    process.env.YT_DLP_COOKIES_PATH?.trim() || process.env.YT_DLP_COOKIES_FILE?.trim();
  const cookiesFromBrowser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();

  if (cookiesFromBrowser && process.env.NODE_ENV === "production") {
    throw new YouTubeImportError(
      "Production では `YT_DLP_COOKIES_FROM_BROWSER` を使えません。`YT_DLP_COOKIES_PATH` を使ってください。",
      { code: "IMPORT_CONFIG", status: 500 }
    );
  }

  if (process.env.NODE_ENV !== "production") {
    for (const browser of getLocalBrowserCookieFallbacks(cookiesFromBrowser)) {
      strategies.push({
        args: ["--cookies-from-browser", browser],
        label: `browser-${browser}`,
      });
    }
  }

  if (cookiesPath) {
    strategies.push({
      args: ["--cookies", cookiesPath],
      label: "cookies-file",
    });
  }

  return dedupeCookieStrategies(strategies);
}

function getLocalBrowserCookieFallbacks(primaryBrowser: string | undefined) {
  const configured =
    process.env.YT_DLP_LOCAL_BROWSER_COOKIE_FALLBACKS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const ordered = [primaryBrowser, ...configured, "edge", "chrome"];
  return ordered.filter(
    (browser, index): browser is string =>
      Boolean(browser) && ordered.indexOf(browser) === index
  );
}

function dedupeCookieStrategies(strategies: CookieAuthStrategy[]) {
  const seen = new Set<string>();
  return strategies.filter((strategy) => {
    const key = strategy.args.join("\u0000");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// Legacy helper kept temporarily to avoid large-scale rewrites while the local-only
// browser-cookie fallback is being phased in.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getYtDlpCookieArgs() {
  const cookiesPath =
    process.env.YT_DLP_COOKIES_PATH?.trim() || process.env.YT_DLP_COOKIES_FILE?.trim();
  if (cookiesPath) {
    return ["--cookies", cookiesPath];
  }

  const cookiesFromBrowser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
  if (cookiesFromBrowser) {
    if (process.env.NODE_ENV === "production") {
      throw new YouTubeImportError(
        "公開環境では `YT_DLP_COOKIES_FROM_BROWSER` は使えません。`YT_DLP_COOKIES_PATH` を使ってください。",
        { code: "IMPORT_CONFIG", status: 500 }
      );
    }
    return ["--cookies-from-browser", cookiesFromBrowser];
  }

  return [];
}

function formatYtDlpError(detail: string) {
  if (/Sign in to confirm you.+not a bot/i.test(detail)) {
    return [
      "yt-dlp の実行に失敗しました: YouTube 側で bot 確認が必要です。",
      "cookies.txt を `YT_DLP_COOKIES_PATH` に設定して再試行してください。",
    ].join(" ");
  }

  if (/Failed to decrypt with DPAPI/i.test(detail)) {
    return [
      "yt-dlp の実行に失敗しました: ブラウザ cookies の復号に失敗しました。",
      "公開環境では browser cookies 自動読み込みは使わず、`YT_DLP_COOKIES_PATH` に cookies.txt を設定してください。",
    ].join(" ");
  }

  if (/Could not copy Chrome cookie database/i.test(detail)) {
    return [
      "yt-dlp の実行に失敗しました: ブラウザの cookie DB を開けませんでした。",
      "`YT_DLP_COOKIES_PATH` に cookies.txt を設定して再試行してください。",
    ].join(" ");
  }

  return `yt-dlp の実行に失敗しました: ${detail}`;
}
