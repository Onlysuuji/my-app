import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const mediaSourceKindEnum = pgEnum("media_source_kind", ["upload", "youtube"]);
export const mediaSourceOriginEnum = pgEnum("media_source_origin", ["local", "youtube"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)]
);

export type SavedBookmark = {
  id: string;
  timeSec: number;
};

export const libraryItems = pgTable(
  "library_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceKind: mediaSourceKindEnum("source_kind").notNull(),
    sourceOrigin: mediaSourceOriginEnum("source_origin").notNull(),
    sourceUrl: text("source_url"),
    youtubeVideoId: text("youtube_video_id"),
    originalFileName: text("original_file_name").notNull(),
    storedFileName: text("stored_file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    offsetSec: real("offset_sec").default(0).notNull(),
    playbackRate: real("playback_rate").default(1).notNull(),
    trimStartSec: real("trim_start_sec"),
    trimEndSec: real("trim_end_sec"),
    bookmarks: jsonb("bookmarks")
      .$type<SavedBookmark[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("library_items_user_id_idx").on(table.userId),
    index("library_items_updated_at_idx").on(table.updatedAt),
  ]
);
