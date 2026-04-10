import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireCurrentUser } from "@/app/lib/auth";
import {
  createLibraryFolder,
  listLibraryFolders,
  normalizeFolderName,
} from "@/app/lib/media-library";
import { enforceJsonRequest, enforceSameOrigin } from "@/app/lib/api-security";

export const runtime = "nodejs";

type FolderCreateBody = {
  name?: string;
};

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const folders = await listLibraryFolders(user.id);
    return NextResponse.json({ folders });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const sameOriginResponse = enforceSameOrigin(request);
  if (sameOriginResponse) {
    return sameOriginResponse;
  }

  const jsonResponse = enforceJsonRequest(request, 16_384);
  if (jsonResponse) {
    return jsonResponse;
  }

  try {
    const user = await requireCurrentUser();
    const body = (await safeReadJson(request)) as FolderCreateBody | null;
    const folder = await createLibraryFolder({
      userId: user.id,
      name: normalizeFolderName(body?.name),
    });

    return NextResponse.json({ folder }, { status: 201 });
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

function createErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error("create library folder failed", error);
  return NextResponse.json(
    { error: "フォルダの作成に失敗しました。" },
    { status: 500 }
  );
}
