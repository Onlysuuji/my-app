import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/app/lib/db";
import { libraryItems } from "@/app/lib/db/schema";
import { AuthError, requireCurrentUser } from "@/app/lib/auth";
import {
  buildVirtualYouTubeStoredFileName,
  listLibraryItems,
  parseBookmarksInput,
  parseOptionalNumberInput,
  serializeLibraryItem,
} from "@/app/lib/media-library";
import { enforceJsonRequest, enforceSameOrigin } from "@/app/lib/api-security";
import { buildYouTubeWatchUrl, extractYouTubeVideoId } from "@/app/lib/youtube";

export const runtime = "nodejs";

type LibraryCreateBody = {
  title?: string;
  sourceKind?: "youtube" | "upload";
  sourceOrigin?: "youtube" | "local";
  sourceUrl?: string | null;
  youtubeVideoId?: string | null;
  offsetSec?: number | string;
  trimStartSec?: number | null;
  trimEndSec?: number | null;
  bookmarks?: string | null;
};

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const items = await listLibraryItems(user.id);
    return NextResponse.json({ items });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const sameOriginResponse = enforceSameOrigin(request);
  if (sameOriginResponse) {
    return sameOriginResponse;
  }

  const jsonResponse = enforceJsonRequest(request, 32_768);
  if (jsonResponse) {
    return jsonResponse;
  }

  try {
    const db = getDb();
    const user = await requireCurrentUser();
    const body = (await safeReadJson(request)) as LibraryCreateBody | null;
    const sourceUrl = normalizeSourceUrl(body?.sourceUrl ?? null, body?.youtubeVideoId ?? null);
    const youtubeVideoId = normalizeYouTubeVideoId(body?.youtubeVideoId ?? null, sourceUrl);

    if (body?.sourceKind === "upload" || body?.sourceOrigin === "local") {
      throw new Error("ローカルファイルはアカウント保存できません。");
    }

    if (!sourceUrl || !youtubeVideoId) {
      throw new Error("保存できるのは YouTube URL のみです。");
    }

    const title = normalizeTitle(body?.title, youtubeVideoId);
    const values: typeof libraryItems.$inferInsert = {
      userId: user.id,
      title,
      sourceKind: "youtube",
      sourceOrigin: "youtube",
      sourceUrl,
      youtubeVideoId,
      originalFileName: buildVirtualOriginalFileName(title, youtubeVideoId),
      storedFileName: buildVirtualYouTubeStoredFileName(youtubeVideoId),
      mimeType: "video/mp4",
      fileSizeBytes: 0,
      offsetSec: normalizeNumberInput(body?.offsetSec, 0),
      playbackRate: 1,
      trimStartSec: body?.trimStartSec ?? null,
      trimEndSec: body?.trimEndSec ?? null,
      bookmarks: parseBookmarksInput(body?.bookmarks ?? null),
    };

    const [createdItem] = await db.insert(libraryItems).values(values).returning();

    return NextResponse.json({ item: serializeLibraryItem(createdItem) }, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}

async function safeReadJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function normalizeSourceUrl(sourceUrl: string | null, youtubeVideoId: string | null) {
  const trimmedSourceUrl = sourceUrl?.trim() || null;
  if (trimmedSourceUrl) {
    if (trimmedSourceUrl.length > 2048) {
      throw new Error("YouTube URL が長すぎます。");
    }

    return trimmedSourceUrl;
  }

  const videoId = normalizeYouTubeVideoId(youtubeVideoId, null);
  return videoId ? buildYouTubeWatchUrl(videoId) : null;
}

function normalizeYouTubeVideoId(youtubeVideoId: string | null, sourceUrl: string | null) {
  return (
    extractYouTubeVideoId(youtubeVideoId?.trim() || "") ??
    extractYouTubeVideoId(sourceUrl?.trim() || "")
  );
}

function normalizeTitle(value: unknown, youtubeVideoId: string) {
  const title = typeof value === "string" ? value.trim() : "";
  return (title || `YouTube video (${youtubeVideoId})`).slice(0, 160);
}

function buildVirtualOriginalFileName(title: string, youtubeVideoId: string) {
  const sanitized = title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim().slice(0, 80);
  return `${sanitized || `youtube-${youtubeVideoId}`}.mp4`;
}

function normalizeNumberInput(value: number | string | undefined, fallback: number) {
  if (typeof value === "number") {
    return value;
  }

  return parseOptionalNumberInput(typeof value === "string" ? value : null) ?? fallback;
}

function createErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error("create library item failed", error);
  return NextResponse.json(
    { error: "保存済み動画の作成に失敗しました。" },
    { status: 500 }
  );
}
