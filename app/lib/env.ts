import "server-only";

import path from "path";

export function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

export function getDatabaseUrl() {
  return getRequiredEnv("DATABASE_URL");
}

export function getAuthSessionDays() {
  const value = process.env.AUTH_SESSION_DAYS?.trim();
  if (!value) {
    return 30;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("AUTH_SESSION_DAYS must be a positive integer.");
  }

  return parsed;
}

export function getMediaStorageRoot() {
  const configured = process.env.MEDIA_STORAGE_ROOT?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), configured);
  }

  return path.join(process.cwd(), ".data", "media");
}

export function getAccountMaxUploadBytes() {
  const rawValue = process.env.ACCOUNT_MAX_UPLOAD_MB?.trim();
  const maxMegabytes = rawValue ? Number.parseInt(rawValue, 10) : 300;

  if (!Number.isFinite(maxMegabytes) || maxMegabytes <= 0) {
    throw new Error("ACCOUNT_MAX_UPLOAD_MB must be a positive integer.");
  }

  return maxMegabytes * 1024 * 1024;
}
