import "server-only";

import { randomBytes, createHash } from "crypto";
import { compare, hash } from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/app/lib/db";
import { getAuthSessionDays } from "@/app/lib/env";
import { sessions, users } from "@/app/lib/db/schema";
import type { SessionUser } from "@/app/lib/account-types";

const SESSION_COOKIE_NAME = "app_session";
const BCRYPT_ROUNDS = 12;

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export async function registerUser(input: {
  email: string;
  password: string;
  displayName?: string | null;
}) {
  const db = getDb();
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);
  const displayName = normalizeDisplayName(input.displayName);

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  });

  if (existing) {
    throw new AuthError("そのメールアドレスは既に使われています。", 409);
  }

  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  const [createdUser] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      displayName,
    })
    .returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    });

  if (!createdUser) {
    throw new AuthError("アカウント作成に失敗しました。", 500);
  }

  await createSession(createdUser.id);
  return createdUser satisfies SessionUser;
}

export async function loginUser(input: { email: string; password: string }) {
  const db = getDb();
  const email = normalizeEmail(input.email);
  const password = input.password ?? "";

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: {
      id: true,
      email: true,
      displayName: true,
      passwordHash: true,
    },
  });

  if (!user) {
    throw new AuthError("メールアドレスまたはパスワードが違います。", 401);
  }

  const matches = await compare(password, user.passwordHash);
  if (!matches) {
    throw new AuthError("メールアドレスまたはパスワードが違います。", 401);
  }

  await createSession(user.id);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  } satisfies SessionUser;
}

export async function logoutCurrentSession() {
  const db = getDb();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await db
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashSessionToken(token)));
  }

  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser() {
  const db = getDb();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const [result] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  return result ?? null;
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError("ログインが必要です。", 401);
  }

  return user;
}

async function createSession(userId: string) {
  const db = getDb();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + getAuthSessionDays() * 24 * 60 * 60 * 1000
  );

  await db.insert(sessions).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });

  const cookieStore = await cookies();
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!email) {
    throw new AuthError("メールアドレスを入力してください。");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError("有効なメールアドレスを入力してください。");
  }
  if (email.length > 320) {
    throw new AuthError("メールアドレスが長すぎます。");
  }
  return email;
}

function validatePassword(value: string) {
  const password = value ?? "";
  if (password.length < 6) {
    throw new AuthError("パスワードは 6 文字以上にしてください。");
  }
  if (password.length > 200) {
    throw new AuthError("パスワードが長すぎます。");
  }
  return password;
}

function normalizeDisplayName(value: string | null | undefined) {
  const displayName = value?.trim() ?? "";
  if (!displayName) {
    return null;
  }
  if (displayName.length > 80) {
    throw new AuthError("表示名は 80 文字以内にしてください。");
  }
  return displayName;
}
