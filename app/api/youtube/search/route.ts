import { NextRequest, NextResponse } from "next/server";
import {
  buildYouTubeWatchUrl,
  formatDurationClock,
  parseYouTubeDuration,
  pickBestThumbnail,
  type YouTubeVideoSummary,
} from "@/app/lib/youtube";
import { getYouTubeApiKey, getYouTubeApiReferer } from "@/app/lib/server-env";
import { enforceSearchRateLimit } from "@/app/lib/api-security";

type YouTubeSearchResponse = {
  items?: Array<{
    id?: {
      videoId?: string;
    };
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

type YouTubeVideosResponse = {
  items?: Array<{
    id?: string;
    contentDetails?: {
      duration?: string;
    };
  }>;
};

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const rateLimitResponse = enforceSearchRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ error: "検索キーワードを入力してください。" }, { status: 400 });
  }
  if (query.length > 120) {
    return NextResponse.json(
      { error: "検索キーワードが長すぎます。" },
      { status: 400 }
    );
  }

  const apiKey = getYouTubeApiKey();
  const referer = getYouTubeApiReferer(request);
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "`youtube_api_key` または `YOUTUBE_API_KEY` が未設定のため、YouTube 検索を利用できません。",
      },
      { status: 500 }
    );
  }

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("type", "video");
  endpoint.searchParams.set("maxResults", "8");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("key", apiKey);

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: referer ? { Referer: referer } : undefined,
    });
    const payload = (await response.json()) as YouTubeSearchResponse;

    if (!response.ok) {
      return NextResponse.json(
        { error: "YouTube 検索に失敗しました。" },
        { status: response.status }
      );
    }

    const items = (payload.items ?? []).reduce<YouTubeVideoSummary[]>((acc, item) => {
      const videoId = item.id?.videoId;
      if (!videoId || !item.snippet) return acc;

      acc.push({
        videoId,
        url: buildYouTubeWatchUrl(videoId),
        title: item.snippet.title ?? `YouTube video (${videoId})`,
        channelTitle: item.snippet.channelTitle ?? "YouTube",
        description: item.snippet.description ?? "",
        publishedAt: item.snippet.publishedAt,
        thumbnailUrl: pickBestThumbnail(item.snippet.thumbnails, videoId),
      });

      return acc;
    }, []);

    if (items.length > 0) {
      const durations = await fetchVideoDurations({
        apiKey,
        referer,
        videoIds: items.map((item) => item.videoId),
      });

      for (const item of items) {
        const durationSec = durations.get(item.videoId);
        if (durationSec === undefined) continue;
        item.durationSec = durationSec;
        item.durationText = formatDurationClock(durationSec) ?? undefined;
      }
    }

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json(
      { error: "YouTube API への接続に失敗しました。" },
      { status: 502 }
    );
  }
}

async function fetchVideoDurations(options: {
  apiKey: string;
  referer: string | null;
  videoIds: string[];
}) {
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "contentDetails");
  endpoint.searchParams.set("id", options.videoIds.join(","));
  endpoint.searchParams.set("key", options.apiKey);

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: options.referer ? { Referer: options.referer } : undefined,
    });

    if (!response.ok) {
      return new Map<string, number>();
    }

    const payload = (await response.json()) as YouTubeVideosResponse;
    const durations = new Map<string, number>();

    for (const item of payload.items ?? []) {
      if (!item.id) continue;
      const durationSec = parseYouTubeDuration(item.contentDetails?.duration);
      if (durationSec === null) continue;
      durations.set(item.id, durationSec);
    }

    return durations;
  } catch {
    return new Map<string, number>();
  }
}
