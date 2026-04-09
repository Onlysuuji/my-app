import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/app/lib/db/schema";

function createPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  return new Pool({
    connectionString,
  });
}

function createDb() {
  return drizzle({
    client: getPool(),
    schema,
  });
}

type AppDatabase = ReturnType<typeof createDb>;

declare global {
  var __appDbPool: Pool | undefined;
  var __appDbClient: AppDatabase | undefined;
}

function getPool() {
  const existingPool = globalThis.__appDbPool;
  if (existingPool) {
    return existingPool;
  }

  const pool = createPool();
  if (process.env.NODE_ENV !== "production") {
    globalThis.__appDbPool = pool;
  }

  return pool;
}

function getDbClient() {
  const existingDb = globalThis.__appDbClient;
  if (existingDb) {
    return existingDb;
  }

  const client = createDb();
  if (process.env.NODE_ENV !== "production") {
    globalThis.__appDbClient = client;
  }

  return client;
}

export { getDbClient as getDb, getPool as pool, schema };
