export type YouTubeVideoSummary = {
  videoId: string;
  url: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnailUrl: string;
  publishedAt?: string;
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

function sanitizeVideoId(value: string) {
  const cleaned = value.trim().replace(/[?&].*$/, "");
  return /^[A-Za-z0-9_-]{11}$/.test(cleaned) ? cleaned : null;
}
