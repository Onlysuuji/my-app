import "server-only";

import { NextRequest, NextResponse } from "next/server";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitStore = Map<string, RateLimitBucket>;

declare global {
  var __youtubeApiRateLimitStore: RateLimitStore | undefined;
}

const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_LOOKUP_LIMIT = 30;
const DEFAULT_IMPORT_LIMIT = 5;
const ONE_MINUTE_MS = 60_000;

function getRateLimitStore() {
  if (!globalThis.__youtubeApiRateLimitStore) {
    globalThis.__youtubeApiRateLimitStore = new Map<string, RateLimitBucket>();
  }

  return globalThis.__youtubeApiRateLimitStore;
}

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function applyRateLimit(
  request: NextRequest,
  key: string,
  options: {
    limit: number;
    windowMs: number;
  }
) {
  const now = Date.now();
  const store = getRateLimitStore();
  const clientIp = getClientIp(request);
  const bucketKey = `${key}:${clientIp}`;
  const current = store.get(bucketKey);

  if (!current || current.resetAt <= now) {
    store.set(bucketKey, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    cleanupRateLimitStore(store, now);
    return null;
  }

  if (current.count >= options.limit) {
    const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "リクエストが多すぎます。少し待ってから再試行してください。" },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
        },
      }
    );
  }

  current.count += 1;
  store.set(bucketKey, current);
  cleanupRateLimitStore(store, now);
  return null;
}

function cleanupRateLimitStore(store: RateLimitStore, now: number) {
  if (store.size < 500) return;

  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function enforceSearchRateLimit(request: NextRequest) {
  return applyRateLimit(request, "youtube-search", {
    limit: DEFAULT_SEARCH_LIMIT,
    windowMs: ONE_MINUTE_MS,
  });
}

export function enforceLookupRateLimit(request: NextRequest) {
  return applyRateLimit(request, "youtube-lookup", {
    limit: DEFAULT_LOOKUP_LIMIT,
    windowMs: ONE_MINUTE_MS,
  });
}

export function enforceImportRateLimit(request: NextRequest) {
  return applyRateLimit(request, "youtube-import", {
    limit: DEFAULT_IMPORT_LIMIT,
    windowMs: ONE_MINUTE_MS,
  });
}

export function enforceJsonRequest(request: NextRequest, maxContentLength = 8_192) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { error: "JSON リクエストのみ受け付けます。" },
      { status: 415 }
    );
  }

  const contentLength = request.headers.get("content-length");
  if (!contentLength) return null;

  const parsed = Number.parseInt(contentLength, 10);
  if (Number.isFinite(parsed) && parsed > maxContentLength) {
    return NextResponse.json(
      { error: "リクエストが大きすぎます。" },
      { status: 413 }
    );
  }

  return null;
}

export function enforceSameOrigin(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return null;

  const expectedOrigin = request.nextUrl.origin;
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === expectedOrigin
      ? null
      : NextResponse.json({ error: "同一オリジンからのアクセスのみ許可されています。" }, { status: 403 });
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin === expectedOrigin) {
        return null;
      }
    } catch {
      return NextResponse.json(
        { error: "同一オリジンの検証に失敗しました。" },
        { status: 403 }
      );
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "none") {
    return null;
  }

  return NextResponse.json(
    { error: "同一オリジンからのアクセスのみ許可されています。" },
    { status: 403 }
  );
}
