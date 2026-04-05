export type YouTubeVideoSummary = {
  videoId: string;
  url: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnailUrl: string;
  publishedAt?: string;
  durationSec?: number;
  durationText?: string;
};

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

export function extractYouTubeVideoId(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(hostname)) return null;

    if (hostname.endsWith("youtu.be")) {
      return sanitizeVideoId(url.pathname.slice(1));
    }

    const watchId = url.searchParams.get("v");
    if (watchId) return sanitizeVideoId(watchId);

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;

    if (segments[0] === "embed" || segments[0] === "shorts" || segments[0] === "live") {
      return sanitizeVideoId(segments[1]);
    }

    return null;
  } catch {
    return sanitizeVideoId(trimmed);
  }
}

export function buildYouTubeWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function buildYouTubeEmbedUrl(videoId: string) {
  return `https://www.youtube.com/embed/${videoId}?rel=0`;
}

export function buildYouTubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function createMinimalYouTubeSummary(videoId: string): YouTubeVideoSummary {
  return {
    videoId,
    url: buildYouTubeWatchUrl(videoId),
    title: `YouTube video (${videoId})`,
    channelTitle: "YouTube",
    description: "",
    thumbnailUrl: buildYouTubeThumbnailUrl(videoId),
  };
}

export function pickBestThumbnail(
  thumbnails: Record<string, { url?: string } | undefined> | undefined,
  videoId: string
) {
  if (!thumbnails) return buildYouTubeThumbnailUrl(videoId);

  return (
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    buildYouTubeThumbnailUrl(videoId)
  );
}

export function parseYouTubeDuration(input: string | undefined) {
  if (!input) return null;

  const match = input.match(/^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)$/);
  if (!match) return null;

  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const seconds = Number.parseInt(match[3] ?? "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatDurationClock(totalSeconds: number | null | undefined) {
  if (!Number.isFinite(totalSeconds) || totalSeconds === null || totalSeconds === undefined) {
    return null;
  }

  const wholeSeconds = Math.max(0, Math.floor(totalSeconds));
  const seconds = wholeSeconds % 60;
  const minutes = Math.floor(wholeSeconds / 60) % 60;
  const hours = Math.floor(wholeSeconds / 3600);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function sanitizeVideoId(value: string) {
  const cleaned = value.trim().replace(/[?&].*$/, "");
  return /^[A-Za-z0-9_-]{11}$/.test(cleaned) ? cleaned : null;
}
