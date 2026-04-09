import { NextRequest, NextResponse } from "next/server";
import { logoutCurrentSession } from "@/app/lib/auth";
import { enforceSameOrigin } from "@/app/lib/api-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const sameOriginResponse = enforceSameOrigin(request);
  if (sameOriginResponse) {
    return sameOriginResponse;
  }

  await logoutCurrentSession();
  return NextResponse.json({ ok: true });
}
