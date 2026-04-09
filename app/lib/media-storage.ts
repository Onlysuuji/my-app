import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getAccountMaxUploadBytes, getMediaStorageRoot } from "@/app/lib/env";

export class MediaStorageError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "MediaStorageError";
    this.status = status;
  }
}

export async function storeMediaFile(options: {
  userId: string;
  file: File;
}) {
  assertSupportedMediaFile(options.file);

  const arrayBuffer = await options.file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const maxUploadBytes = getAccountMaxUploadBytes();

  if (buffer.byteLength > maxUploadBytes) {
    throw new MediaStorageError(
      `アップロード上限は ${Math.floor(maxUploadBytes / 1024 / 1024)} MB です。`,
      413
    );
  }

  const directory = getUserMediaDirectory(options.userId);
  await fs.mkdir(directory, { recursive: true });

  const storedFileName = `${randomUUID()}${getFileExtension(options.file.name)}`;
  const filePath = path.join(directory, storedFileName);
  await fs.writeFile(filePath, buffer);

  return {
    storedFileName,
    mimeType: options.file.type || "video/mp4",
    fileSizeBytes: buffer.byteLength,
    originalFileName: options.file.name || storedFileName,
  };
}

export async function storeMediaBuffer(options: {
  userId: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}) {
  assertSupportedMediaInput({
    fileName: options.fileName,
    mimeType: options.mimeType,
  });

  const maxUploadBytes = getAccountMaxUploadBytes();
  if (options.buffer.byteLength > maxUploadBytes) {
    throw new MediaStorageError(
      `アップロード上限は ${Math.floor(maxUploadBytes / 1024 / 1024)} MB です。`,
      413
    );
  }

  const directory = getUserMediaDirectory(options.userId);
  await fs.mkdir(directory, { recursive: true });

  const storedFileName = `${randomUUID()}${getFileExtension(options.fileName)}`;
  const filePath = path.join(directory, storedFileName);
  await fs.writeFile(filePath, options.buffer);

  return {
    storedFileName,
    mimeType: options.mimeType || "video/mp4",
    fileSizeBytes: options.buffer.byteLength,
    originalFileName: options.fileName || storedFileName,
  };
}

export async function readMediaFile(options: {
  userId: string;
  storedFileName: string;
}) {
  const filePath = path.join(getUserMediaDirectory(options.userId), options.storedFileName);
  return fs.readFile(filePath);
}

export async function deleteMediaFile(options: {
  userId: string;
  storedFileName: string;
}) {
  const filePath = path.join(getUserMediaDirectory(options.userId), options.storedFileName);
  await fs.rm(filePath, { force: true });
}

function getUserMediaDirectory(userId: string) {
  return path.join(getMediaStorageRoot(), userId);
}

function assertSupportedMediaFile(file: File) {
  assertSupportedMediaInput({
    fileName: file.name,
    mimeType: file.type,
  });
}

function assertSupportedMediaInput(options: { fileName: string; mimeType: string }) {
  const name = options.fileName?.toLowerCase() ?? "";
  const type = options.mimeType?.toLowerCase() ?? "";

  if (type === "video/mp4" || name.endsWith(".mp4")) {
    return;
  }

  throw new MediaStorageError("保存できるのは MP4 ファイルのみです。", 415);
}

function getFileExtension(fileName: string) {
  const extension = path.extname(fileName);
  if (!extension || extension.length > 10) {
    return ".mp4";
  }

  return extension.toLowerCase();
}
