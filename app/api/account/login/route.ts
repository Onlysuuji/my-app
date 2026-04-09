import { NextRequest, NextResponse } from "next/server";
import { AuthError, loginUser } from "@/app/lib/auth";
import { enforceJsonRequest, enforceSameOrigin } from "@/app/lib/api-security";

export const runtime = "nodejs";

type LoginBody = {
  email?: string;
  password?: string;
};

export async function POST(request: NextRequest) {
  const sameOriginResponse = enforceSameOrigin(request);
  if (sameOriginResponse) {
    return sameOriginResponse;
  }

  const jsonResponse = enforceJsonRequest(request, 8_192);
  if (jsonResponse) {
    return jsonResponse;
  }

  try {
    const body = (await safeReadJson(request)) as LoginBody | null;
    const user = await loginUser({
      email: body?.email ?? "",
      password: body?.password ?? "",
    });

    return NextResponse.json({ user });
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

  console.error("login failed", error);
  return NextResponse.json(
    { error: "ログインに失敗しました。" },
    { status: 500 }
  );
}
