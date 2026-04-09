import { NextRequest, NextResponse } from "next/server";
import { AuthError, registerUser } from "@/app/lib/auth";
import { enforceJsonRequest, enforceSameOrigin } from "@/app/lib/api-security";

export const runtime = "nodejs";

type RegisterBody = {
  email?: string;
  password?: string;
  displayName?: string;
};

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
    const body = (await safeReadJson(request)) as RegisterBody | null;
    const user = await registerUser({
      email: body?.email ?? "",
      password: body?.password ?? "",
      displayName: body?.displayName ?? null,
    });

    return NextResponse.json({ user }, { status: 201 });
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

  console.error("register failed", error);
  return NextResponse.json(
    { error: "アカウント作成に失敗しました。" },
    { status: 500 }
  );
}
