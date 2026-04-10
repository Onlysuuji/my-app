import "server-only";

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db";
import { libraryFolders, libraryItems } from "@/app/lib/db/schema";
import { deleteMediaFile } from "@/app/lib/media-storage";
import type {
  PlaybackBookmark,
  SavedMediaFolder,
  SavedMediaItem,
} from "@/app/lib/account-types";

const VIRTUAL_YOUTUBE_STORED_FILE_PREFIX = "youtube:";

export async function listLibraryItems(userId: string) {
  const db = getDb();
  const rows = await db.query.libraryItems.findMany({
    where: eq(libraryItems.userId, userId),
    orderBy: [desc(libraryItems.sortOrder), desc(libraryItems.createdAt)],
  });

  return rows.map(serializeLibraryItem);
}

export async function listLibraryFolders(userId: string) {
  const db = getDb();
  const rows = await db.query.libraryFolders.findMany({
    where: eq(libraryFolders.userId, userId),
    orderBy: [desc(libraryFolders.sortOrder), desc(libraryFolders.createdAt)],
  });

  return rows.map(serializeLibraryFolder);
}

export async function createLibraryFolder(options: { userId: string; name: string }) {
  const db = getDb();
  const normalizedName = normalizeFolderName(options.name);
  const [folder] = await db
    .insert(libraryFolders)
    .values({
      userId: options.userId,
      name: normalizedName,
      sortOrder: Date.now(),
    })
    .returning();

  return serializeLibraryFolder(folder);
}

export async function findLibraryItem(options: { userId: string; itemId: string }) {
  const db = getDb();
  const row = await db.query.libraryItems.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.id, options.itemId), eq(table.userId, options.userId)),
  });

  return row ?? null;
}

export async function findLibraryFolder(options: { userId: string; folderId: string }) {
  const db = getDb();
  const row = await db.query.libraryFolders.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.id, options.folderId), eq(table.userId, options.userId)),
  });

  return row ?? null;
}

export async function deleteLibraryItem(options: { userId: string; itemId: string }) {
  const db = getDb();
  const existing = await findLibraryItem(options);
  if (!existing) {
    return false;
  }

  await db.delete(libraryItems).where(eq(libraryItems.id, options.itemId));
  if (!isVirtualYouTubeStoredFileName(existing.storedFileName)) {
    await deleteMediaFile({
      userId: options.userId,
      storedFileName: existing.storedFileName,
    });
  }
  return true;
}

export function serializeLibraryItem(
  item: typeof libraryItems.$inferSelect
): SavedMediaItem {
  return {
    id: item.id,
    title: item.title,
    folderId: item.folderId,
    sortOrder: item.sortOrder,
    sourceKind: item.sourceKind,
    sourceOrigin: item.sourceOrigin,
    sourceUrl: item.sourceUrl,
    youtubeVideoId: item.youtubeVideoId,
    originalFileName: item.originalFileName,
    mimeType: item.mimeType,
    fileSizeBytes: item.fileSizeBytes,
    offsetSec: item.offsetSec,
    playbackRate: item.playbackRate,
    trimStartSec: item.trimStartSec,
    trimEndSec: item.trimEndSec,
    bookmarks: normalizeBookmarks(item.bookmarks),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function serializeLibraryFolder(
  folder: typeof libraryFolders.$inferSelect
): SavedMediaFolder {
  return {
    id: folder.id,
    name: folder.name,
    sortOrder: folder.sortOrder,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

export function normalizeFolderName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) {
    throw new Error("フォルダ名を入力してください。");
  }

  return name.slice(0, 80);
}

export function parseBookmarksInput(value: string | null): PlaybackBookmark[] {
  if (!value) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("ブックマークの形式が不正です。");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("ブックマークの形式が不正です。");
  }

  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const id = "id" in entry ? entry.id : null;
      const timeSec = "timeSec" in entry ? entry.timeSec : null;
      if (typeof id !== "string" || typeof timeSec !== "number" || !Number.isFinite(timeSec)) {
        return null;
      }

      return {
        id,
        timeSec,
      } satisfies PlaybackBookmark;
    })
    .filter((bookmark): bookmark is PlaybackBookmark => bookmark !== null);
}

export function parseOptionalNumberInput(value: string | null) {
  if (value === null || value === "") {
    return null;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("数値の形式が不正です。");
  }

  return parsed;
}

function normalizeBookmarks(value: PlaybackBookmark[] | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (bookmark) =>
      typeof bookmark?.id === "string" &&
      typeof bookmark?.timeSec === "number" &&
      Number.isFinite(bookmark.timeSec)
  );
}

export function buildVirtualYouTubeStoredFileName(videoId: string) {
  return `${VIRTUAL_YOUTUBE_STORED_FILE_PREFIX}${videoId}`;
}

export function isVirtualYouTubeStoredFileName(storedFileName: string) {
  return storedFileName.startsWith(VIRTUAL_YOUTUBE_STORED_FILE_PREFIX);
}
