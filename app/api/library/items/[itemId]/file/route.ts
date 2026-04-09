import { promises as fs } from "fs";
import { NextResponse } from "next/server";
import { AuthError, requireCurrentUser } from "@/app/lib/auth";
import {
  findLibraryItem,
  isVirtualYouTubeStoredFileName,
} from "@/app/lib/media-library";
import { readMediaFile } from "@/app/lib/media-storage";
import { importYouTubeVideo, YouTubeImportError } from "@/app/lib/youtube-import";
import { buildYouTubeWatchUrl, extractYouTubeVideoId } from "@/app/lib/youtube";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  try {
    const user = await requireCurrentUser();
    const { itemId } = await context.params;
    const item = await findLibraryItem({ userId: user.id, itemId });

    if (!item) {
      return NextResponse.json({ error: "保存済み動画が見つかりません。" }, { status: 404 });
    }

    if (isVirtualYouTubeStoredFileName(item.storedFileName)) {
      const videoId = resolveYouTubeVideoId(item);
      const imported = await importYouTubeVideo({
        url: item.sourceUrl?.trim() || buildYouTubeWatchUrl(videoId),
        videoId,
        title: item.title,
      });

      try {
        const fileBuffer = await fs.readFile(imported.filePath);
        return new NextResponse(fileBuffer, {
          status: 200,
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(imported.contentLength),
            "Content-Disposition": buildContentDisposition(imported.fileName),
            "Cache-Control": "private, no-store",
          },
        });
      } finally {
        await imported.cleanup();
      }
    }

    const fileBuffer = await readMediaFile({
      userId: user.id,
      storedFileName: item.storedFileName,
    });

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": item.mimeType,
        "Content-Length": String(fileBuffer.byteLength),
        "Content-Disposition": buildContentDisposition(item.originalFileName),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof YouTubeImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("read library file failed", error);
    return NextResponse.json(
      { error: "保存済み動画の読み込みに失敗しました。" },
      { status: 500 }
    );
  }
}

function resolveYouTubeVideoId(item: {
  youtubeVideoId: string | null;
  sourceUrl: string | null;
}) {
  const videoId =
    item.youtubeVideoId?.trim() || extractYouTubeVideoId(item.sourceUrl?.trim() ?? "");

  if (!videoId) {
    throw new Error("保存済みの YouTube URL が壊れているため読み込めません。");
  }

  return videoId;
}

function buildContentDisposition(fileName: string) {
  const asciiFallback =
    fileName
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]+/g, "_")
      .replace(/["\\]/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "saved-video.mp4";

  const encoded = encodeURIComponent(fileName)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
