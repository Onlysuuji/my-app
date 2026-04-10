import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db";
import { libraryItems } from "@/app/lib/db/schema";
import { AuthError, requireCurrentUser } from "@/app/lib/auth";
import {
  deleteLibraryItem,
  findLibraryFolder,
  findLibraryItem,
  parseBookmarksInput,
  parseOptionalNumberInput,
  serializeLibraryItem,
} from "@/app/lib/media-library";
import { enforceJsonRequest, enforceSameOrigin } from "@/app/lib/api-security";

export const runtime = "nodejs";

type UpdateBody = {
  title?: string;
  offsetSec?: number | string;
  trimStartSec?: number | null;
  trimEndSec?: number | null;
  bookmarks?: string | null;
  folderId?: string | null;
  sortOrder?: number | string;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
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
    const { itemId } = await context.params;
    const existing = await findLibraryItem({ userId: user.id, itemId });

    if (!existing) {
      return NextResponse.json({ error: "保存済み動画が見つかりません。" }, { status: 404 });
    }

    const body = (await safeReadJson(request)) as UpdateBody | null;
    const title =
      typeof body?.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 160)
        : existing.title;
    const bookmarks = parseBookmarksInput(
      body?.bookmarks === undefined ? JSON.stringify(existing.bookmarks) : body.bookmarks
    );
    const offsetSec =
      typeof body?.offsetSec === "number"
        ? body.offsetSec
        : parseOptionalNumberInput(
            typeof body?.offsetSec === "string" ? body.offsetSec : null
          ) ?? existing.offsetSec;
    const trimStartSec =
      body?.trimStartSec === undefined ? existing.trimStartSec : body.trimStartSec;
    const trimEndSec =
      body?.trimEndSec === undefined ? existing.trimEndSec : body.trimEndSec;
    const folderId = await resolveFolderIdUpdate(user.id, existing.folderId, body);
    const sortOrder =
      typeof body?.sortOrder === "number"
        ? body.sortOrder
        : parseOptionalNumberInput(
            typeof body?.sortOrder === "string" ? body.sortOrder : null
          ) ?? existing.sortOrder;

    const [updated] = await db
      .update(libraryItems)
      .set({
        title,
        folderId,
        sortOrder,
        offsetSec,
        playbackRate: 1,
        trimStartSec,
        trimEndSec,
        bookmarks,
        updatedAt: new Date(),
      })
      .where(eq(libraryItems.id, itemId))
      .returning();

    return NextResponse.json({ item: serializeLibraryItem(updated) });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  const sameOriginResponse = enforceSameOrigin(request);
  if (sameOriginResponse) {
    return sameOriginResponse;
  }

  try {
    const user = await requireCurrentUser();
    const { itemId } = await context.params;
    const deleted = await deleteLibraryItem({ userId: user.id, itemId });

    if (!deleted) {
      return NextResponse.json({ error: "保存済み動画が見つかりません。" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
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

async function resolveFolderIdUpdate(
  userId: string,
  currentFolderId: string | null,
  body: UpdateBody | null
) {
  if (!Object.prototype.hasOwnProperty.call(body ?? {}, "folderId")) {
    return currentFolderId;
  }

  const nextFolderId = body?.folderId?.trim() || null;
  if (!nextFolderId) {
    return null;
  }

  const folder = await findLibraryFolder({ userId, folderId: nextFolderId });
  if (!folder) {
    throw new Error("フォルダが見つかりません。");
  }

  return nextFolderId;
}

function createErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error("update library item failed", error);
  return NextResponse.json(
    { error: "保存済み動画の更新に失敗しました。" },
    { status: 500 }
  );
}
