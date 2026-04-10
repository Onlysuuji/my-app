export type PlaybackBookmark = {
  id: string;
  timeSec: number;
};

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export type SavedMediaFolder = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type SavedMediaItem = {
  id: string;
  title: string;
  folderId: string | null;
  sortOrder: number;
  sourceKind: "upload" | "youtube";
  sourceOrigin: "local" | "youtube";
  sourceUrl: string | null;
  youtubeVideoId: string | null;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  offsetSec: number;
  playbackRate: number;
  trimStartSec: number | null;
  trimEndSec: number | null;
  bookmarks: PlaybackBookmark[];
  createdAt: string;
  updatedAt: string;
};
