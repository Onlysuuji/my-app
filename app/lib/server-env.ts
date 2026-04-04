import "server-only";

export function getYouTubeApiKey() {
  const apiKey =
    process.env.youtube_api_key?.trim() || process.env.YOUTUBE_API_KEY?.trim();

  return apiKey || null;
}

export function getYouTubeApiReferer(request: {
  headers: { get(name: string): string | null };
  nextUrl?: { origin: string };
}) {
  const configuredReferer =
    process.env.youtube_api_referer?.trim() ||
    process.env.YOUTUBE_API_REFERER?.trim();

  if (configuredReferer) {
    return normalizeReferer(configuredReferer);
  }

  const incomingReferer =
    request.headers.get("referer") ||
    request.headers.get("origin") ||
    request.nextUrl?.origin;

  return normalizeReferer(incomingReferer);
}

function normalizeReferer(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.pathname === "/" && !url.search && !url.hash
      ? url.toString()
      : `${url.origin}/`;
  } catch {
    return value.endsWith("/") ? value : `${value}/`;
  }
}
