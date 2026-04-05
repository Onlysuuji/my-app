import { promises as fs } from "fs";
import { NextRequest, NextResponse } from "next/server";
import {
  enforceImportRateLimit,
  enforceJsonRequest,
  enforceLookupRateLimit,
  enforceSameOrigin,
} from "@/app/lib/api-security";
import { importYouTubeVideo, YouTubeImportError } from "@/app/lib/youtube-import";
import { getYouTubeApiKey, getYouTubeApiReferer } from "@/app/lib/server-env";
import {
  buildYouTubeWatchUrl,
  createMinimalYouTubeSummary,
  extractYouTubeVideoId,
  pickBestThumbnail,
  type YouTubeVideoSummary,
} from "@/app/lib/youtube";

export const runtime = "nodejs";

type YouTubeVideosResponse = {
  items?: Array<{
    id: string;
    snippet?: {
      title?: string;
      channelTitle?: string;
      description?: string;
      publishedAt?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type ImportRequestBody = {
  url?: string;
  videoId?: string;
  title?: string;
};

export async function GET(request: NextRequest) {
  const rateLimitResponse = enforceLookupRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const searchParams = request.nextUrl.searchParams;
  const inputUrl = searchParams.get("url") ?? "";
  const rawVideoId = searchParams.get("videoId");
  const videoId = extractYouTubeVideoId(rawVideoId ?? "") ?? extractYouTubeVideoId(inputUrl);

  if (!videoId) {
    return NextResponse.json(
      { error: "有効な YouTube URL または videoId を指定してください。" },
      { status: 400 }
    );
  }

  const apiKey = getYouTubeApiKey();
  const referer = getYouTubeApiReferer(request);
  if (!apiKey) {
    return NextResponse.json({
      item: createMinimalYouTubeSummary(videoId),
      warning:
        "`youtube_api_key` または `YOUTUBE_API_KEY` が未設定のため、最低限の情報だけ表示しています。",
    });
  }

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("id", videoId);
  endpoint.searchParams.set("key", apiKey);

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: referer ? { Referer: referer } : undefined,
    });
    const payload = (await response.json()) as YouTubeVideosResponse;

    if (!response.ok) {
      return NextResponse.json(
        {
          item: createMinimalYouTubeSummary(videoId),
          warning: "YouTube API から詳細を取得できなかったため、最低限の情報だけ表示しています。",
        },
        { status: 200 }
      );
    }

    const item = payload.items?.[0];
    if (!item?.snippet) {
      return NextResponse.json(
        { error: "指定した YouTube 動画が見つかりませんでした。" },
        { status: 404 }
      );
    }

    const summary: YouTubeVideoSummary = {
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: item.snippet.title ?? `YouTube video (${videoId})`,
      channelTitle: item.snippet.channelTitle ?? "YouTube",
      description: item.snippet.description ?? "",
      publishedAt: item.snippet.publishedAt,
      thumbnailUrl: pickBestThumbnail(item.snippet.thumbnails, videoId),
    };

    return NextResponse.json({ item: summary });
  } catch {
    return NextResponse.json(
      {
        item: createMinimalYouTubeSummary(videoId),
        warning: "YouTube API への接続に失敗したため、最低限の情報だけ表示しています。",
      },
      { status: 200 }
    );
  }
}

export async function POST(request: NextRequest) {
  const sameOriginResponse = enforceSameOrigin(request);
  if (sameOriginResponse) {
    return sameOriginResponse;
  }

  const rateLimitResponse = enforceImportRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const jsonRequestResponse = enforceJsonRequest(request);
  if (jsonRequestResponse) {
    return jsonRequestResponse;
  }

  const body = (await safeReadJson(request)) as ImportRequestBody | null;
  const rawUrl = body?.url?.trim() ?? "";
  const rawVideoId = body?.videoId?.trim() ?? "";
  const videoId = extractYouTubeVideoId(rawVideoId) ?? extractYouTubeVideoId(rawUrl);
  const title = body?.title?.trim()?.slice(0, 160);

  if (!rawUrl || !videoId) {
    return NextResponse.json(
      { error: "有効な YouTube URL を指定してください。" },
      { status: 400 }
    );
  }

  if (rawUrl.length > 2048) {
    return NextResponse.json({ error: "URL が長すぎます。" }, { status: 400 });
  }

  try {
    const imported = await importYouTubeVideo({
      url: buildYouTubeWatchUrl(videoId),
      videoId,
      title: title || undefined,
    });
    const buffer = await fs.readFile(imported.filePath);
    await imported.cleanup();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": buildContentDisposition(imported.fileName),
        "X-Imported-Video-Id": videoId,
      },
    });
  } catch (error) {
    console.error("youtube resolve failed", {
      url: rawUrl,
      videoId,
      error,
    });

    const message =
      error instanceof Error ? error.message : "YouTube 動画の取り込みに失敗しました。";
    const status = error instanceof YouTubeImportError ? error.status : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

async function safeReadJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function buildContentDisposition(fileName: string) {
  const asciiFallback =
    fileName
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]+/g, "_")
      .replace(/["\\]/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "youtube-import.mp4";

  const encoded = encodeRFC5987ValueChars(fileName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function encodeRFC5987ValueChars(value: string) {
  return encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
}
