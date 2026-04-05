import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (!shouldEnforceBasicAuth()) {
    return NextResponse.next();
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return createUnauthorizedResponse();
  }

  const [scheme, encoded] = authorization.split(" ");
  if (scheme !== "Basic" || !encoded) {
    return createUnauthorizedResponse();
  }

  let decoded = "";
  try {
    decoded = atob(encoded);
  } catch {
    return createUnauthorizedResponse();
  }

  const separatorIndex = decoded.indexOf(":");
  const user = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

  if (!credentialsMatch(user, password)) {
    return createUnauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

function shouldEnforceBasicAuth() {
  if (process.env.NODE_ENV !== "production") {
    return false;
  }

  return Boolean(process.env.APP_BASIC_AUTH_USER && process.env.APP_BASIC_AUTH_PASSWORD);
}

function credentialsMatch(user: string, password: string) {
  return (
    user === process.env.APP_BASIC_AUTH_USER &&
    password === process.env.APP_BASIC_AUTH_PASSWORD
  );
}

function createUnauthorizedResponse() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Protected", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}
