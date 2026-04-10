"use client";

import Image from "next/image";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import {
  exportVideoWithOffset,
  type ExportResolutionPreset,
} from "./lib/ffmpeg-export";
import {
  buildYouTubeEmbedUrl,
  extractYouTubeVideoId,
  type YouTubeVideoSummary,
} from "./lib/youtube";
import type {
  PlaybackBookmark,
  SavedMediaFolder,
  SavedMediaItem,
  SessionUser,
} from "./lib/account-types";

type SourceMode = "local" | "youtube-url" | "youtube-search";
type SourceOrigin = "local" | "youtube";
type AccountFormMode = "login" | "register";
type SavedFolderSelection = "all" | "unfiled" | string;

type SearchYouTubeResponse = {
  items?: YouTubeVideoSummary[];
  error?: string;
};

type ResolveYouTubeResponse = {
  item?: YouTubeVideoSummary;
  warning?: string;
  error?: string;
};

type AccountSessionResponse = {
  user?: SessionUser | null;
  error?: string;
};

type LibraryItemsResponse = {
  items?: SavedMediaItem[];
  item?: SavedMediaItem;
  folders?: SavedMediaFolder[];
  error?: string;
};

type LibraryFoldersResponse = {
  folders?: SavedMediaFolder[];
  folder?: SavedMediaFolder;
  error?: string;
};

const YOUTUBE_IMPORT_BASELINE_OFFSET_SEC = -0.05;
const UNFILED_FOLDER_SELECTION = "unfiled";

// 同期方式は seekSync のみ使用
const iconButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const exportResolutionOptions: Array<{
  value: ExportResolutionPreset;
  label: string;
  hint: string;
}> = [
  { value: "source", label: "元の解像度", hint: "画質優先・時間長め" },
  { value: "1080p", label: "1080p", hint: "フルHDまで" },
  { value: "720p", label: "720p", hint: "標準" },
  { value: "480p", label: "480p", hint: "軽め" },
  { value: "360p", label: "360p", hint: "最軽量" },
];


export default function Player() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const playerShellRef = useRef<HTMLDivElement | null>(null);

  const [sourceMode, setSourceMode] = useState<SourceMode>("youtube-url");
  const [sourceOrigin, setSourceOrigin] = useState<SourceOrigin>("local");
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [youtubeSource, setYoutubeSource] = useState<YouTubeVideoSummary | null>(null);
  const [youtubeWarning, setYoutubeWarning] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  // 音声オフセット（+で遅延 / -で前進）
  const [offsetSec, setOffsetSec] = useState(0);

  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [exportResolution, setExportResolution] =
    useState<ExportResolutionPreset>("720p");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [trimStartSec, setTrimStartSec] = useState<number | null>(null);
  const [trimEndSec, setTrimEndSec] = useState<number | null>(null);
  const [bookmarks, setBookmarks] = useState<PlaybackBookmark[]>([]);
  const [youtubeUrlInput, setYoutubeUrlInput] = useState("");
  const [youtubeUrlError, setYoutubeUrlError] = useState<string | null>(null);
  const [youtubeSearchInput, setYoutubeSearchInput] = useState("");
  const [youtubeSearchSelectedUrl, setYoutubeSearchSelectedUrl] = useState<string | null>(null);
  const [youtubeSearchError, setYoutubeSearchError] = useState<string | null>(null);
  const [youtubeSearchLoading, setYoutubeSearchLoading] = useState(false);
  const [youtubeSearchResults, setYoutubeSearchResults] = useState<YouTubeVideoSummary[]>([]);
  const [youtubeImporting, setYoutubeImporting] = useState(false);
  const [youtubeImportError, setYoutubeImportError] = useState<string | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountFormMode, setAccountFormMode] = useState<AccountFormMode>("login");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountDisplayName, setAccountDisplayName] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [savedItems, setSavedItems] = useState<SavedMediaItem[]>([]);
  const [savedItemsLayout, setSavedItemsLayout] = useState<"scroll" | "grid">("scroll");
  const [savedItemsSearchQuery, setSavedItemsSearchQuery] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [librarySaving, setLibrarySaving] = useState(false);
  const [libraryTitle, setLibraryTitle] = useState("");
  const [savedFolders, setSavedFolders] = useState<SavedMediaFolder[]>([]);
  const [selectedSavedFolderId, setSelectedSavedFolderId] =
    useState<SavedFolderSelection>("all");
  const [activeSavedItemId, setActiveSavedItemId] = useState<string | null>(null);
  const [loadingSavedItemId, setLoadingSavedItemId] = useState<string | null>(null);
  const [deletingSavedItemId, setDeletingSavedItemId] = useState<string | null>(null);
  const [renamingSavedItemId, setRenamingSavedItemId] = useState<string | null>(null);
  const [movingSavedItemId, setMovingSavedItemId] = useState<string | null>(null);
  const [assigningSavedItemId, setAssigningSavedItemId] = useState<string | null>(null);
  const [folderCreating, setFolderCreating] = useState(false);
  const [currentSourceUrl, setCurrentSourceUrl] = useState<string | null>(null);
  const [currentYouTubeVideoId, setCurrentYouTubeVideoId] = useState<string | null>(null);
  const [fullscreenMode, setFullscreenMode] = useState<"off" | "native" | "pseudo">("off");
  const [fullscreenControlsOpen, setFullscreenControlsOpen] = useState(false);
  const [screenLocked, setScreenLocked] = useState(false);
  const [mediaReadyForPlayback, setMediaReadyForPlayback] = useState(false);
  const exportStartedAtRef = useRef(0);
  const exportProgressRef = useRef(0);

  // 同期ループ
  const rafRef = useRef<number | null>(null);
  const lastSyncCheckAtRef = useRef(0);
  const offsetDraggingRef = useRef(false);
  const surfaceClickTimeoutRef = useRef<number | null>(null);
  const isVideoSeekingRef = useRef(false);
  const resumeAudioAfterSeekRef = useRef(false);
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const lastSavedLibraryStateRef = useRef<string | null>(null);

  // safeSetCurrentTime の “古いリトライ上書き” 防止トークン
  const seekTokenRef = useRef(0);
  const playStartTokenRef = useRef(0);
  const boundMediaSourceKeyRef = useRef<string | null>(null);
  const mediaReadyWaitTokenRef = useRef(0);

  const urlForCleanup = useRef<string | null>(null);
  const localSourceReady = !!srcUrl && !!sourceFile;
  const youtubeSourceReady = sourceMode !== "local" && youtubeSource !== null;
  const localControlsDisabled = !localSourceReady || !mediaReadyForPlayback;
  const usesDetachedAudio = localSourceReady;
  const effectiveOffsetSec = offsetSec + getSourceBaselineOffsetSec(sourceOrigin);
  const canSaveYouTubeMedia = sourceOrigin === "youtube" && !!currentSourceUrl;
  const isPlayerFullscreen = fullscreenMode !== "off";
  const isPseudoFullscreen = fullscreenMode === "pseudo";
  const normalizedSavedItemsSearchQuery = savedItemsSearchQuery.trim().toLocaleLowerCase();
  const folderFilteredSavedItems = savedItems.filter((item) => {
    if (selectedSavedFolderId === "all") {
      return true;
    }

    if (selectedSavedFolderId === UNFILED_FOLDER_SELECTION) {
      return !item.folderId;
    }

    return item.folderId === selectedSavedFolderId;
  });
  const filteredSavedItems =
    normalizedSavedItemsSearchQuery.length === 0
      ? folderFilteredSavedItems
      : folderFilteredSavedItems.filter((item) => {
          const searchTargets = [item.title, item.sourceUrl, item.originalFileName];
          return searchTargets.some((value) =>
            (value ?? "").toLocaleLowerCase().includes(normalizedSavedItemsSearchQuery)
          );
        });

  const syncLocalFileInput = (file: File | null) => {
    const input = fileInputRef.current;
    if (!input) return;

    if (!file) {
      input.value = "";
      return;
    }

    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    } catch {
      // Some browsers do not allow programmatic file assignment.
    }
  };

  const stopLocalPlayback = () => {
    playStartTokenRef.current += 1;
    mediaReadyWaitTokenRef.current += 1;
    isVideoSeekingRef.current = false;
    resumeAudioAfterSeekRef.current = false;
    if (autoSaveTimeoutRef.current !== null) {
      window.clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    videoRef.current?.pause();
    audioRef.current?.pause();
    setPlaying(false);
    setMediaReadyForPlayback(false);
  };

  const seekVideoBy = useCallback((deltaSec: number) => {
    const video = videoRef.current;
    if (!video || localControlsDisabled) return;

    video.currentTime = clamp(video.currentTime + deltaSec, 0, video.duration || Infinity);
  }, [localControlsDisabled]);

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video || localControlsDisabled) return;

    if (video.paused) {
      await video.play().catch(() => {});
      return;
    }

    video.pause();
  }, [localControlsDisabled]);

  const onVideoSurfaceClick = () => {
    if (screenLocked) return;
    if (localControlsDisabled) return;

    if (surfaceClickTimeoutRef.current !== null) {
      window.clearTimeout(surfaceClickTimeoutRef.current);
    }

    surfaceClickTimeoutRef.current = window.setTimeout(() => {
      if (isPlayerFullscreen) {
        setFullscreenControlsOpen(true);
      }

      void togglePlayback();
      surfaceClickTimeoutRef.current = null;
    }, 220);
  };

  const onVideoSurfaceDoubleClick = (event: React.MouseEvent<HTMLVideoElement>) => {
    if (screenLocked) return;
    if (localControlsDisabled) return;

    if (surfaceClickTimeoutRef.current !== null) {
      window.clearTimeout(surfaceClickTimeoutRef.current);
      surfaceClickTimeoutRef.current = null;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const delta = event.clientX < midpoint ? -5 : 5;

    if (isPlayerFullscreen) {
      setFullscreenControlsOpen(true);
    }

    seekVideoBy(delta);
  };

  const adjustPlaybackRate = useCallback((delta: number) => {
    setPlaybackRate((value) => clamp(value + delta, 0.1, 2.0));
  }, []);

  const adjustOffset = useCallback((delta: number) => {
    setOffsetSec((value) => clamp(value + delta, -0.3, 0.3));
  }, []);

  const exitPlayerFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;

    const playerShell = playerShellRef.current;
    if (playerShell && document.fullscreenElement === playerShell) {
      await document.exitFullscreen().catch(() => {});
    }

    setFullscreenMode("off");
    setFullscreenControlsOpen(false);
    setScreenLocked(false);
  }, []);

  const enterPlayerFullscreen = useCallback(async () => {
    const playerShell = playerShellRef.current;
    if (!playerShell) return;

    setFullscreenControlsOpen(true);
    setScreenLocked(false);

    if (typeof playerShell.requestFullscreen === "function") {
      try {
        await playerShell.requestFullscreen();
        setFullscreenMode("native");
        return;
      } catch {
        // Fallback to pseudo fullscreen below.
      }
    }

    setFullscreenMode("pseudo");
  }, []);

  const togglePlayerFullscreen = useCallback(async () => {
    if (isPlayerFullscreen) {
      await exitPlayerFullscreen();
      return;
    }

    await enterPlayerFullscreen();
  }, [enterPlayerFullscreen, exitPlayerFullscreen, isPlayerFullscreen]);

  const buildCurrentLibrarySaveState = useCallback(() => {
    const normalizedTitle = normalizeLibraryTitleForSave(
      libraryTitle,
      currentYouTubeVideoId,
      currentSourceUrl
    );

    return {
      title: normalizedTitle,
      offsetSec,
      trimStartSec,
      trimEndSec,
      bookmarks,
    };
  }, [bookmarks, currentSourceUrl, currentYouTubeVideoId, libraryTitle, offsetSec, trimEndSec, trimStartSec]);

  const currentLibrarySaveSignature = useCallback(() => {
    return createLibrarySaveSignature(buildCurrentLibrarySaveState());
  }, [buildCurrentLibrarySaveState]);

  const syncMediaReadyState = useCallback(() => {
    const video = videoRef.current;
    const ready = isMediaReadyForPlayback(video, 1);

    setMediaReadyForPlayback(ready);
    return ready;
  }, []);

  const syncDetachedAudioToVideo = useCallback(() => {
    if (!localSourceReady || !usesDetachedAudio) return null;

    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return null;

    audio.playbackRate = playbackRate;
    safeSetCurrentTime(
      audio,
      clamp(video.currentTime - effectiveOffsetSec, 0, audio.duration || Infinity),
      seekTokenRef
    );

    return { video, audio };
  }, [effectiveOffsetSec, localSourceReady, playbackRate, usesDetachedAudio]);

  const resumeDetachedAudio = useCallback(() => {
    if (!localSourceReady || !usesDetachedAudio || !srcUrl || !mediaReadyForPlayback) return;

    const syncedMedia = syncDetachedAudioToVideo();
    if (!syncedMedia) return;

    const { video, audio } = syncedMedia;
    if (video.paused) return;

    video.muted = true;
    video.volume = 0;
    audio.muted = false;
    audio.volume = 1;

    const startToken = ++playStartTokenRef.current;
    void audio
      .play()
      .then(() => {
        if (startToken !== playStartTokenRef.current) return;

        requestAnimationFrame(() => {
          if (startToken !== playStartTokenRef.current) return;
          syncDetachedAudioToVideo();
        });

        setPlaying(true);
      })
      .catch((err) => {
        if (startToken !== playStartTokenRef.current) return;
        if (!isPlayInterruptedError(err)) {
          console.error("audio play failed:", err);
        }
      });
  }, [localSourceReady, mediaReadyForPlayback, srcUrl, syncDetachedAudioToVideo, usesDetachedAudio]);

  const onSourceModeChange = (nextMode: SourceMode) => {
    if (nextMode === sourceMode) return;

    stopLocalPlayback();
    setSourceMode(nextMode);
    setExportError(null);

    if (nextMode !== "youtube-url") {
      setYoutubeUrlInput("");
      setYoutubeUrlError(null);
    }

    if (nextMode !== "youtube-search") {
      setYoutubeSearchInput("");
      setYoutubeSearchError(null);
      setYoutubeSearchResults([]);
      setYoutubeSearchSelectedUrl(null);
    }

    setYoutubeSource(null);
    setYoutubeWarning(null);
    setYoutubeImportError(null);
  };

  // ファイル選択
  const onPickFile = (
    file: File | null,
    options?: {
      keepCurrentTab?: boolean;
      sourceOrigin?: SourceOrigin;
      libraryTitle?: string;
      savedItemId?: string | null;
      sourceUrl?: string | null;
      youtubeVideoId?: string | null;
      resetBookmarks?: boolean;
    }
  ) => {
    if (!file) return;

    stopLocalPlayback();
    syncLocalFileInput(file);

    // 既存の objectURL を破棄
    if (urlForCleanup.current) URL.revokeObjectURL(urlForCleanup.current);

    const url = URL.createObjectURL(file);
    urlForCleanup.current = url;
    if (!options?.keepCurrentTab) {
      setSourceMode("local");
    }
    setSrcUrl(url);
    setSourceFile(file);
    setSourceOrigin(options?.sourceOrigin ?? "local");
    setLibraryTitle(options?.libraryTitle ?? getDefaultLibraryTitle(file.name));
    setActiveSavedItemId(options?.savedItemId ?? null);
    setCurrentSourceUrl(options?.sourceUrl ?? null);
    setCurrentYouTubeVideoId(options?.youtubeVideoId ?? null);
    if (!options?.savedItemId) {
      setOffsetSec(0);
      setPlaybackRate(1);
    }
    if (!options?.keepCurrentTab) {
      setYoutubeSearchSelectedUrl(null);
    }
    setYoutubeSource(null);
    setYoutubeWarning(null);
    setYoutubeImportError(null);
    if (options?.resetBookmarks ?? true) {
      setBookmarks([]);
    }
    setTrimStartSec(null);
    setTrimEndSec(null);
    if (!options?.savedItemId) {
      lastSavedLibraryStateRef.current = null;
    }

    // 任意：表示リセット
    setExportError(null);
    setExportProgress(0);
  };

  const saveBookmarkAtCurrentTime = () => {
    const video = videoRef.current;
    if (!video || localControlsDisabled) return;

    const timeSec = roundBookmarkTime(video.currentTime);
    setBookmarks((current) =>
      [...current, { id: createBookmarkId(), timeSec }].sort((a, b) => a.timeSec - b.timeSec)
    );
  };

  const jumpToBookmark = (timeSec: number) => {
    const video = videoRef.current;
    if (!video || localControlsDisabled) return;

    video.currentTime = clamp(timeSec, 0, video.duration || Infinity);
  };

  const deleteBookmark = (bookmarkId: string) => {
    setBookmarks((current) => current.filter((bookmark) => bookmark.id !== bookmarkId));
  };

  const onVideoPause = () => {
    playStartTokenRef.current += 1;
    isVideoSeekingRef.current = false;
    resumeAudioAfterSeekRef.current = false;
    const a = audioRef.current;
    a?.pause();
    setPlaying(false);
  };

  const onExport = async () => {
    if (!sourceFile || exporting) return;
    if (
      trimStartSec !== null &&
      trimEndSec !== null &&
      trimStartSec >= trimEndSec
    ) {
      setExportError("始点は終点より前にしてください。");
      return;
    }
    if (!ffmpegReady && !window.FFmpegWASM?.FFmpeg) {
      setExportError("FFmpeg の読み込み中です。少し待って再度お試しください。");
      return;
    }
    if (!ffmpegReady && window.FFmpegWASM?.FFmpeg) {
      setFfmpegReady(true);
    }
    setExportError(null);
    setExportProgress(0);
    exportProgressRef.current = 0;
    exportStartedAtRef.current = performance.now();
    setExporting(true);

    try {
      const blob = await exportVideoWithOffset({
        file: sourceFile,
        playbackRate,
        offsetSec: effectiveOffsetSec,
        trimStartSec,
        trimEndSec,
        exportResolution,
        onProgress: (p) => {
          if (!Number.isFinite(p)) return;
          const now = performance.now();
          if (p >= 0.999 && now - exportStartedAtRef.current < 800) return;
          const safe = Math.min(1, Math.max(0, p));
          if (safe < exportProgressRef.current) return;
          exportProgressRef.current = safe;
          setExportProgress(safe);
        },
      });

      const url = URL.createObjectURL(blob);
      const originalName = sourceFile.name.replace(/\.[^/.]+$/, "");
      const rateTag =
        Math.abs(playbackRate - 1.0) > 1e-6 ? `_rate${playbackRate.toFixed(2)}` : "";
      const offsetTag =
        Math.abs(effectiveOffsetSec) > 1e-6 ? `_offset${effectiveOffsetSec.toFixed(3)}` : "";
      const resolutionTag =
        exportResolution === "source" ? "_source" : `_${exportResolution}`;
      const fileName = `${originalName}${rateTag}${offsetTag}${resolutionTag}.mp4`;

      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "export failed");
      console.error("export failed:", err);
      setExportError(message);
    } finally {
      setExporting(false);
    }
  };

  const refreshSession = async () => {
    setAccountLoading(true);

    try {
      const response = await fetch("/api/account/session", {
        cache: "no-store",
      });
      const data = (await response.json()) as AccountSessionResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "セッション確認に失敗しました。");
      }

      setSessionUser(data.user ?? null);
      setAccountError(null);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "セッション確認に失敗しました。");
      setSessionUser(null);
    } finally {
      setAccountLoading(false);
    }
  };

  const refreshSavedItems = useCallback(async () => {
    if (!sessionUser) {
      setSavedItems([]);
      setSavedFolders([]);
      setLibraryLoading(false);
      return;
    }

    setLibraryLoading(true);

    try {
      const response = await fetch("/api/library/items", {
        cache: "no-store",
      });
      const data = (await response.json()) as LibraryItemsResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "保存済み動画の取得に失敗しました。");
      }

      setSavedItems(sortSavedItems(data.items ?? []));
      setSavedFolders(sortSavedFolders(data.folders ?? []));
      setLibraryError(null);
    } catch (err) {
      setLibraryError(
        err instanceof Error ? err.message : "保存済み動画の取得に失敗しました。"
      );
    } finally {
      setLibraryLoading(false);
    }
  }, [sessionUser]);

  const submitAccountForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setAccountSubmitting(true);
    setAccountError(null);

    try {
      const endpoint =
        accountFormMode === "register" ? "/api/account/register" : "/api/account/login";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: accountEmail,
          password: accountPassword,
          displayName: accountDisplayName,
        }),
      });
      const data = (await response.json()) as AccountSessionResponse;

      if (!response.ok || !data.user) {
        throw new Error(data.error ?? "認証に失敗しました。");
      }

      setSessionUser(data.user);
      setAccountPassword("");
      setAccountError(null);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "認証に失敗しました。");
    } finally {
      setAccountSubmitting(false);
    }
  };

  const logoutAccount = async () => {
    setAccountSubmitting(true);
    setAccountError(null);

    try {
      const response = await fetch("/api/account/logout", {
        method: "POST",
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "ログアウトに失敗しました。");
      }

      setSessionUser(null);
      setSavedItems([]);
      setSavedFolders([]);
      setSelectedSavedFolderId("all");
      setActiveSavedItemId(null);
      setLibraryError(null);
      lastSavedLibraryStateRef.current = null;
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "ログアウトに失敗しました。");
    } finally {
      setAccountSubmitting(false);
    }
  };

  const saveCurrentMediaToAccount = useCallback(async () => {
    if (!sessionUser || !canSaveYouTubeMedia) return;

    const currentSaveState = buildCurrentLibrarySaveState();
    const newItemFolderId =
      selectedSavedFolderId !== "all" && selectedSavedFolderId !== UNFILED_FOLDER_SELECTION
        ? selectedSavedFolderId
        : null;
    setLibrarySaving(true);
    setLibraryError(null);

    try {
      let response: Response;
      let savedItem: SavedMediaItem | null = null;

      if (activeSavedItemId) {
        response = await fetch(`/api/library/items/${activeSavedItemId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...currentSaveState,
            bookmarks: JSON.stringify(currentSaveState.bookmarks),
          }),
        });

        const data = (await response.json()) as LibraryItemsResponse;
        if (!response.ok || !data.item) {
          throw new Error(data.error ?? "保存に失敗しました。");
        }

        savedItem = data.item;
      } else {
        response = await fetch("/api/library/items", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: currentSaveState.title,
            sourceKind: "youtube",
            sourceOrigin: "youtube",
            sourceUrl: currentSourceUrl,
            youtubeVideoId: currentYouTubeVideoId,
            offsetSec: currentSaveState.offsetSec,
            trimStartSec: currentSaveState.trimStartSec,
            trimEndSec: currentSaveState.trimEndSec,
            bookmarks: JSON.stringify(currentSaveState.bookmarks),
            folderId: newItemFolderId,
          }),
        });

        const createData = (await response.json()) as LibraryItemsResponse;
        if (!response.ok || !createData.item) {
          throw new Error(createData.error ?? "保存に失敗しました。");
        }
        savedItem = createData.item;
      }

      if (!savedItem) {
        throw new Error("保存に失敗しました。");
      }

      lastSavedLibraryStateRef.current = createLibrarySaveSignature({
        title: savedItem.title,
        offsetSec: savedItem.offsetSec,
        trimStartSec: savedItem.trimStartSec,
        trimEndSec: savedItem.trimEndSec,
        bookmarks: savedItem.bookmarks,
      });
      setActiveSavedItemId(savedItem.id);
      setLibraryTitle(savedItem.title);
      setSavedItems((current) => upsertSavedItem(current, savedItem));
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : "保存に失敗しました。");
    } finally {
      setLibrarySaving(false);
    }
  }, [
    activeSavedItemId,
    buildCurrentLibrarySaveState,
    canSaveYouTubeMedia,
    currentSourceUrl,
    currentYouTubeVideoId,
    selectedSavedFolderId,
    sessionUser,
  ]);

  const loadSavedItem = async (item: SavedMediaItem) => {
    setLoadingSavedItemId(item.id);
    setLibraryError(null);

    try {
      const response = await fetch(`/api/library/items/${item.id}/file`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "保存済み動画の読み込みに失敗しました。");
      }

      const blob = await response.blob();
      const fileName =
        parseFileNameFromContentDisposition(response.headers.get("Content-Disposition")) ??
        item.originalFileName;
      const mimeType =
        response.headers.get("Content-Type")?.split(";")[0]?.trim() ||
        item.mimeType ||
        blob.type ||
        "video/mp4";
      const file = new File([blob], fileName, {
        type: mimeType,
      });

      lastSavedLibraryStateRef.current = createLibrarySaveSignature({
        title: item.title,
        offsetSec: item.offsetSec,
        trimStartSec: item.trimStartSec,
        trimEndSec: item.trimEndSec,
        bookmarks: item.bookmarks,
      });
      onPickFile(file, {
        sourceOrigin: item.sourceOrigin,
        libraryTitle: item.title,
        savedItemId: item.id,
        sourceUrl: item.sourceUrl,
        youtubeVideoId: item.youtubeVideoId,
        resetBookmarks: false,
      });
      setOffsetSec(item.offsetSec);
      setPlaybackRate(1);
      setTrimStartSec(item.trimStartSec);
      setTrimEndSec(item.trimEndSec);
      setBookmarks(item.bookmarks);
    } catch (err) {
      setLibraryError(
        err instanceof Error ? err.message : "保存済み動画の読み込みに失敗しました。"
      );
    } finally {
      setLoadingSavedItemId(null);
    }
  };

  const deleteSavedItemById = async (itemId: string) => {
    if (activeSavedItemId === itemId) {
      setLibraryError("読み込んでいる動画は削除できません。別の動画を読み込んでから削除してください。");
      return;
    }

    if (!window.confirm("この保存済み動画を削除しますか？")) {
      return;
    }

    setDeletingSavedItemId(itemId);
    setLibraryError(null);

    try {
      const response = await fetch(`/api/library/items/${itemId}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "保存済み動画の削除に失敗しました。");
      }

      setSavedItems((current) => current.filter((item) => item.id !== itemId));
    } catch (err) {
      setLibraryError(
        err instanceof Error ? err.message : "保存済み動画の削除に失敗しました。"
      );
    } finally {
      setDeletingSavedItemId(null);
    }
  };

  const renameSavedItem = async (item: SavedMediaItem) => {
    const nextTitle = window.prompt("保存済み動画の名前を変更", item.title);
    if (nextTitle === null) {
      return;
    }

    const normalizedTitle = nextTitle.trim().slice(0, 160);
    if (!normalizedTitle || normalizedTitle === item.title) {
      return;
    }

    setRenamingSavedItemId(item.id);
    setLibraryError(null);

    try {
      const response = await fetch(`/api/library/items/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: normalizedTitle,
        }),
      });
      const data = (await response.json()) as LibraryItemsResponse;

      if (!response.ok || !data.item) {
        throw new Error(data.error ?? "名前変更に失敗しました。");
      }

      const updatedItem = data.item;
      if (activeSavedItemId === updatedItem.id) {
        setLibraryTitle(updatedItem.title);
        lastSavedLibraryStateRef.current = createLibrarySaveSignature({
          title: updatedItem.title,
          offsetSec,
          trimStartSec,
          trimEndSec,
          bookmarks,
        });
      }
      setSavedItems((current) => upsertSavedItem(current, updatedItem));
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : "名前変更に失敗しました。");
    } finally {
      setRenamingSavedItemId(null);
    }
  };

  const createSavedFolder = async () => {
    const folderName = window.prompt("新しいフォルダ名");
    if (folderName === null) {
      return;
    }

    const normalizedName = folderName.trim().slice(0, 80);
    if (!normalizedName) {
      setLibraryError("フォルダ名を入力してください。");
      return;
    }

    setFolderCreating(true);
    setLibraryError(null);

    try {
      const response = await fetch("/api/library/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: normalizedName }),
      });
      const data = (await response.json()) as LibraryFoldersResponse;

      if (!response.ok || !data.folder) {
        throw new Error(data.error ?? "フォルダ作成に失敗しました。");
      }

      setSavedFolders((current) => sortSavedFolders([...current, data.folder!]));
      setSelectedSavedFolderId(data.folder.id);
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : "フォルダ作成に失敗しました。");
    } finally {
      setFolderCreating(false);
    }
  };

  const updateSavedItemFolder = async (item: SavedMediaItem, folderId: string | null) => {
    if (item.folderId === folderId) {
      return;
    }

    setAssigningSavedItemId(item.id);
    setLibraryError(null);

    try {
      const response = await fetch(`/api/library/items/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ folderId }),
      });
      const data = (await response.json()) as LibraryItemsResponse;

      if (!response.ok || !data.item) {
        throw new Error(data.error ?? "フォルダ移動に失敗しました。");
      }

      setSavedItems((current) => upsertSavedItem(current, data.item!));
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : "フォルダ移動に失敗しました。");
    } finally {
      setAssigningSavedItemId(null);
    }
  };

  const moveSavedItem = async (item: SavedMediaItem, direction: -1 | 1) => {
    const currentIndex = filteredSavedItems.findIndex((candidate) => candidate.id === item.id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= filteredSavedItems.length) {
      return;
    }

    const reorderedItems = [...filteredSavedItems];
    const [movedItem] = reorderedItems.splice(currentIndex, 1);
    reorderedItems.splice(nextIndex, 0, movedItem);

    const baseSortOrder = Date.now();
    const updates = reorderedItems.map((entry, index) => ({
      item: entry,
      sortOrder: baseSortOrder - index,
    }));

    setMovingSavedItemId(item.id);
    setLibraryError(null);

    try {
      const updatedItems = await Promise.all(
        updates.map(async (entry) => {
          const response = await fetch(`/api/library/items/${entry.item.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ sortOrder: entry.sortOrder }),
          });
          const data = (await response.json()) as LibraryItemsResponse;

          if (!response.ok || !data.item) {
            throw new Error(data.error ?? "並び替えに失敗しました。");
          }

          return data.item;
        })
      );

      setSavedItems((current) =>
        sortSavedItems(
          current.map((currentItem) => {
            const updatedItem = updatedItems.find((entry) => entry.id === currentItem.id);
            return updatedItem ?? currentItem;
          })
        )
      );
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : "並び替えに失敗しました。");
    } finally {
      setMovingSavedItemId(null);
    }
  };

  // 動画の controls から再生された場合の同期開始
  const startFromVideo = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!localSourceReady || !mediaReadyForPlayback || !v || !a || !srcUrl) return;
    if (!a.paused) return;

    isVideoSeekingRef.current = false;
    resumeAudioAfterSeekRef.current = false;
    v.muted = usesDetachedAudio;
    v.volume = usesDetachedAudio ? 0 : 1;
    a.muted = false;
    a.volume = 1;

    v.playbackRate = playbackRate;
    a.playbackRate = playbackRate;

    resumeDetachedAudio();
  };

  const resolveYouTubeUrl = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = youtubeUrlInput.trim();
    if (!trimmed) {
      setYoutubeUrlError("YouTube URL を入力してください。");
      return;
    }

    if (!extractYouTubeVideoId(trimmed)) {
      setYoutubeUrlError("有効な YouTube URL を入力してください。");
      return;
    }

    stopLocalPlayback();
    setYoutubeUrlError(null);
    setYoutubeSearchSelectedUrl(null);
    setYoutubeWarning(null);
    setYoutubeSource(null);
    setYoutubeImportError(null);

    try {
      const summary = await fetchYouTubeSummary({
        url: trimmed,
        videoId: extractYouTubeVideoId(trimmed) ?? undefined,
      });

      await importYouTubeIntoLocal({
        url: trimmed,
        videoId: extractYouTubeVideoId(trimmed) ?? undefined,
        title: summary?.title,
      });
    } catch (err) {
      setYoutubeUrlError(
        err instanceof Error ? err.message : "YouTube 動画の取得に失敗しました。"
      );
    }
  };

  const searchYouTube = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = youtubeSearchInput.trim();
    if (!trimmed) {
      setYoutubeSearchError("検索キーワードを入力してください。");
      return;
    }

    stopLocalPlayback();
    setYoutubeSearchLoading(true);
    setYoutubeSearchError(null);
    setYoutubeWarning(null);
    setYoutubeSource(null);
    setYoutubeImportError(null);

    try {
      const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(trimmed)}`);
      const data = (await response.json()) as SearchYouTubeResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "YouTube 検索に失敗しました。");
      }

      const items = data.items ?? [];
      setYoutubeSearchResults(items);
      if (items.length === 0) {
        setYoutubeSearchError("該当する動画が見つかりませんでした。");
      }
    } catch (err) {
      setYoutubeSearchResults([]);
      setYoutubeSearchError(err instanceof Error ? err.message : "YouTube 検索に失敗しました。");
    } finally {
      setYoutubeSearchLoading(false);
    }
  };

  const selectYouTubeSource = async (item: YouTubeVideoSummary) => {
    stopLocalPlayback();
    setYoutubeSource(item);
    setYoutubeSearchSelectedUrl(item.url);
    setYoutubeWarning(null);
    setYoutubeUrlInput(item.url);
    setYoutubeUrlError(null);
    setYoutubeImportError(null);
    setYoutubeSearchError(null);

    try {
      await importYouTubeIntoLocal({
        url: item.url,
        videoId: item.videoId,
        title: item.title,
      });
    } catch {
      // Error state is already rendered in the preview panel for retry.
    }
  };

  const importYouTubeIntoLocal = async (options: {
    url: string;
    videoId?: string;
    title?: string;
  }) => {
    stopLocalPlayback();
    setYoutubeImporting(true);
    setYoutubeImportError(null);

    try {
      const response = await fetch("/api/youtube/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: options.url,
          videoId: options.videoId,
          title: options.title,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "YouTube 動画の取り込みに失敗しました。");
      }

      const blob = await response.blob();
      const fileName =
        parseFileNameFromContentDisposition(response.headers.get("Content-Disposition")) ??
        `${options.videoId ?? "youtube-import"}.mp4`;
      const importedFile = new File([blob], fileName, {
        type: blob.type || "video/mp4",
      });

      onPickFile(importedFile, {
        keepCurrentTab: true,
        sourceOrigin: "youtube",
        libraryTitle: options.title ?? getDefaultLibraryTitle(importedFile.name),
        sourceUrl: options.url,
        youtubeVideoId: options.videoId ?? null,
      });
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("YouTube 動画の取り込みに失敗しました。");
      setYoutubeImportError(error.message);
      throw error;
    } finally {
      setYoutubeImporting(false);
    }
  };

  const importSelectedYouTubeSource = async () => {
    if (!youtubeSource) return;

    try {
      await importYouTubeIntoLocal({
        url: youtubeSource.url,
        videoId: youtubeSource.videoId,
        title: youtubeSource.title,
      });
    } catch {
      // Error state is already set near the action button.
    }
  };

  const fetchYouTubeSummary = async (options: { url: string; videoId?: string }) => {
    const searchParams = new URLSearchParams();
    searchParams.set("url", options.url);
    if (options.videoId) {
      searchParams.set("videoId", options.videoId);
    }

    const response = await fetch(`/api/youtube/resolve?${searchParams.toString()}`, {
      cache: "no-store",
    });
    const data = (await response.json()) as ResolveYouTubeResponse;

    if (!response.ok) {
      throw new Error(data.error ?? "YouTube 動画情報の取得に失敗しました。");
    }

    if (data.item) {
      setYoutubeSource(data.item);
    }
    setYoutubeWarning(data.warning ?? null);

    return data.item ?? null;
  };

  // seekSync: offset変更が確定したら1回だけシーク（ドラッグ中はしない）
  useEffect(() => {
    if (!localSourceReady || !playing || !usesDetachedAudio) return;
    if (offsetDraggingRef.current) return;
    if (isVideoSeekingRef.current) return;

    syncDetachedAudioToVideo();
  }, [
    effectiveOffsetSec,
    localSourceReady,
    playing,
    syncDetachedAudioToVideo,
    usesDetachedAudio,
  ]);

  // 再生速度反映
  useEffect(() => {
    if (!localSourceReady) return;
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    v.playbackRate = playbackRate;
    if (usesDetachedAudio && a) {
      a.playbackRate = playbackRate;
    }
  }, [localSourceReady, playbackRate, usesDetachedAudio]);

  // 同期ループ（小さいズレは速度補正、大きいズレだけシーク）
  useEffect(() => {
    if (!localSourceReady || !playing || !usesDetachedAudio) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    const tick = () => {
      const now = performance.now();

      // ドラッグ中は “補正しない”。音は基準速度に固定。
      if (offsetDraggingRef.current || isVideoSeekingRef.current) {
        a.playbackRate = playbackRate;

        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const expectedAudio = clamp(
        v.currentTime - effectiveOffsetSec,
        0,
        a.duration || Infinity
      );
      const diff = a.currentTime - expectedAudio;

      if (now - lastSyncCheckAtRef.current > 160) {
        lastSyncCheckAtRef.current = now;

        if (Math.abs(diff) > 0.45) {
          safeSetCurrentTime(a, expectedAudio, seekTokenRef);
          a.playbackRate = playbackRate;
        } else if (Math.abs(diff) > 0.045) {
          const correction = clamp(-diff * 0.08, -0.035, 0.035);
          a.playbackRate = clamp(playbackRate + correction, 0.1, 2.0);
        } else {
          a.playbackRate = playbackRate;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [effectiveOffsetSec, localSourceReady, playbackRate, playing, usesDetachedAudio]);

  const onVideoSeeking = () => {
    if (!localSourceReady || !usesDetachedAudio) return;
    if (offsetDraggingRef.current) return;

    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    isVideoSeekingRef.current = true;
    resumeAudioAfterSeekRef.current = !v.paused;
    playStartTokenRef.current += 1;
    a.pause();
    syncDetachedAudioToVideo();
  };

  // シーク時の追従（ドラッグ中は無視）
  const onVideoSeeked = () => {
    if (!localSourceReady || !usesDetachedAudio) return;
    if (offsetDraggingRef.current) return;

    isVideoSeekingRef.current = false;

    const syncedMedia = syncDetachedAudioToVideo();
    if (!syncedMedia) return;

    const shouldResume = resumeAudioAfterSeekRef.current && !syncedMedia.video.paused;
    resumeAudioAfterSeekRef.current = false;

    if (shouldResume) {
      resumeDetachedAudio();
    }
  };

  const onOffsetCommit = () => {
    offsetDraggingRef.current = false;
    if (!localSourceReady || !playing || !usesDetachedAudio) return;
    if (isVideoSeekingRef.current) return;

    syncDetachedAudioToVideo();
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    if (!sessionUser) {
      setSavedItems([]);
      setSavedFolders([]);
      setSelectedSavedFolderId("all");
      setLibraryLoading(false);
      setActiveSavedItemId(null);
      lastSavedLibraryStateRef.current = null;
      return;
    }

    void refreshSavedItems();
  }, [refreshSavedItems, sessionUser]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (autoSaveTimeoutRef.current !== null) {
      window.clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }

    if (
      !sessionUser ||
      !canSaveYouTubeMedia ||
      !localSourceReady ||
      !!loadingSavedItemId ||
      !!deletingSavedItemId ||
      !!renamingSavedItemId ||
      librarySaving
    ) {
      return;
    }

    const nextSignature = currentLibrarySaveSignature();
    if (nextSignature === lastSavedLibraryStateRef.current) {
      return;
    }

    autoSaveTimeoutRef.current = window.setTimeout(() => {
      autoSaveTimeoutRef.current = null;
      void saveCurrentMediaToAccount();
    }, 700);

    return () => {
      if (autoSaveTimeoutRef.current !== null) {
        window.clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    };
  }, [
    activeSavedItemId,
    canSaveYouTubeMedia,
    currentLibrarySaveSignature,
    deletingSavedItemId,
    librarySaving,
    loadingSavedItemId,
    localSourceReady,
    renamingSavedItemId,
    saveCurrentMediaToAccount,
    sessionUser,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const onFullscreenChange = () => {
      const playerShell = playerShellRef.current;
      if (playerShell && document.fullscreenElement === playerShell) {
        setFullscreenMode("native");
        setFullscreenControlsOpen(true);
        setScreenLocked(false);
        return;
      }

      setFullscreenMode((current) => (current === "native" ? "off" : current));
      setFullscreenControlsOpen((current) =>
        document.fullscreenElement ? current : false
      );
      if (!document.fullscreenElement) {
        setScreenLocked(false);
      }
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || !isPseudoFullscreen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isPseudoFullscreen]);

  useEffect(() => {
    if (!localSourceReady && isPlayerFullscreen) {
      void exitPlayerFullscreen();
    }
  }, [exitPlayerFullscreen, isPlayerFullscreen, localSourceReady]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isPseudoFullscreen) {
        event.preventDefault();
        void exitPlayerFullscreen();
        return;
      }

      if (!localSourceReady) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (isEditableElement(event.target)) return;

      const lowerKey = event.key.toLowerCase();
      if (lowerKey === "q") {
        event.preventDefault();
        adjustOffset(-0.005);
        return;
      }
      if (lowerKey === "w") {
        event.preventDefault();
        setOffsetSec(0);
        return;
      }
      if (lowerKey === "e") {
        event.preventDefault();
        adjustOffset(0.005);
        return;
      }
      if (lowerKey === "a") {
        event.preventDefault();
        adjustPlaybackRate(-0.05);
        return;
      }
      if (lowerKey === "s") {
        event.preventDefault();
        setPlaybackRate(1.0);
        return;
      }
      if (lowerKey === "d") {
        event.preventDefault();
        adjustPlaybackRate(0.05);
        return;
      }
      if (lowerKey === "f") {
        event.preventDefault();
        void togglePlayerFullscreen();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        void togglePlayback();
        return;
      }
      if (lowerKey === "k") {
        event.preventDefault();
        void togglePlayback();
        return;
      }
      if (lowerKey === "b") {
        if (localControlsDisabled) return;
        const video = videoRef.current;
        if (!video) return;

        event.preventDefault();
        const timeSec = roundBookmarkTime(video.currentTime);
        setBookmarks((current) =>
          [...current, { id: createBookmarkId(), timeSec }].sort((a, b) => a.timeSec - b.timeSec)
        );
        return;
      }
      if (lowerKey === "j" || lowerKey === "l") {
        if (localControlsDisabled) return;
        event.preventDefault();
        seekVideoBy(lowerKey === "j" ? -10 : 10);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (localControlsDisabled) return;
        event.preventDefault();
        seekVideoBy(event.key === "ArrowLeft" ? -5 : 5);
        return;
      }

      const bookmarkIndex = getBookmarkIndexFromShortcut(event);
      if (bookmarkIndex === null) return;

      const bookmark = bookmarks[bookmarkIndex];
      const video = videoRef.current;
      if (!bookmark || !video || localControlsDisabled) return;

      event.preventDefault();
      video.currentTime = clamp(bookmark.timeSec, 0, video.duration || Infinity);
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    adjustOffset,
    adjustPlaybackRate,
    bookmarks,
    exitPlayerFullscreen,
    isPseudoFullscreen,
    localControlsDisabled,
    localSourceReady,
    seekVideoBy,
    togglePlayback,
    togglePlayerFullscreen,
  ]);

  // src URL 更新
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    const mediaSourceKey =
      localSourceReady && srcUrl
        ? `${srcUrl}::${usesDetachedAudio ? "detached" : "inline"}`
        : null;

    if (mediaSourceKey && boundMediaSourceKeyRef.current === mediaSourceKey) {
      return;
    }

    if (localSourceReady && srcUrl) {
      boundMediaSourceKeyRef.current = mediaSourceKey;
      setMediaReadyForPlayback(false);
      v.src = srcUrl;
      v.muted = usesDetachedAudio;
      v.volume = usesDetachedAudio ? 0 : 1;
      v.load();

      if (usesDetachedAudio) {
        a.src = srcUrl;
        a.muted = false;
        a.volume = 1;
        a.currentTime = 0;
        a.load();
      } else {
        a.pause();
        a.removeAttribute("src");
        a.load();
      }

      v.currentTime = 0;
      return;
    }

    boundMediaSourceKeyRef.current = null;
    setMediaReadyForPlayback(false);
    v.removeAttribute("src");
    a.removeAttribute("src");
    v.load();
    a.load();
  }, [localSourceReady, srcUrl, usesDetachedAudio]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;

    if (!localSourceReady || !srcUrl || !video) {
      setMediaReadyForPlayback(false);
      return;
    }

    const token = ++mediaReadyWaitTokenRef.current;
    if (syncMediaReadyState()) {
      return;
    }

    setMediaReadyForPlayback(false);

    let cancelled = false;
    const waitForReady = async () => {
      try {
        await waitForPlayableMedia(video, mediaReadyWaitTokenRef, token, {
          minimumReadyState: 1,
          fallbackReadyState: 1,
          timeoutMs: 2_500,
        });
        if (!cancelled && token === mediaReadyWaitTokenRef.current) {
          setMediaReadyForPlayback(true);
        }
        if (usesDetachedAudio && audio) {
          void waitForPlayableMedia(audio, mediaReadyWaitTokenRef, token, {
            minimumReadyState: 1,
            fallbackReadyState: 0,
            timeoutMs: 2_500,
          }).catch(() => {});
        }
      } catch {
        if (!cancelled && token === mediaReadyWaitTokenRef.current) {
          setMediaReadyForPlayback(true);
        }
      }
    };

    void waitForReady();

    return () => {
      cancelled = true;
      if (token === mediaReadyWaitTokenRef.current) {
        mediaReadyWaitTokenRef.current += 1;
      }
    };
  }, [localSourceReady, srcUrl, syncMediaReadyState, usesDetachedAudio]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.FFmpegWASM?.FFmpeg) {
      setFfmpegReady(true);
      return;
    }

    let timeoutId: number | null = null;
    let cancelled = false;

    const poll = () => {
      if (cancelled) return;
      if (window.FFmpegWASM?.FFmpeg) {
        setFfmpegReady(true);
        return;
      }
      timeoutId = window.setTimeout(poll, 200);
    };

    poll();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a || !localSourceReady) return;

    v.muted = usesDetachedAudio;
    v.volume = usesDetachedAudio ? 0 : 1;
    if (playing && mediaReadyForPlayback && a.paused && !isVideoSeekingRef.current) {
      resumeDetachedAudio();
    }
  }, [
    localSourceReady,
    mediaReadyForPlayback,
    playing,
    resumeDetachedAudio,
    usesDetachedAudio,
  ]);

  // アンマウント時の後始末
  useEffect(() => {
    return () => {
      if (urlForCleanup.current) URL.revokeObjectURL(urlForCleanup.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (surfaceClickTimeoutRef.current !== null) {
        window.clearTimeout(surfaceClickTimeoutRef.current);
      }
      if (autoSaveTimeoutRef.current !== null) {
        window.clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div style={{ display: "grid", gap: 16, width: "100%" }}>
      <Script
        src="/ffmpeg/ffmpeg.js"
        strategy="afterInteractive"
        onLoad={() => setFfmpegReady(true)}
        onError={() =>
          setExportError("FFmpeg スクリプトの読み込みに失敗しました。ページを再読み込みしてください。")
        }
      />

      <section className="grid gap-4">
        <div className="flex flex-col gap-3 xl:flex-row-reverse xl:items-start xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
              {accountLoading
                ? "セッション確認中..."
                : sessionUser
                  ? sessionUser.displayName || "ログイン中"
                  : "ゲスト"}
            </div>
            {!accountLoading && sessionUser && (
              <button
                type="button"
                onClick={() => void logoutAccount()}
                disabled={accountSubmitting}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
              >
                ログアウト
              </button>
            )}
            {!accountLoading && !sessionUser && (
              <>
                <button
                  type="button"
                  onClick={() => setAccountFormMode("login")}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    accountFormMode === "login"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                  }`}
                >
                  ログイン
                </button>
                <button
                  type="button"
                  onClick={() => setAccountFormMode("register")}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    accountFormMode === "register"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                  }`}
                >
                  新規登録
                </button>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <ModeButton
              active={sourceMode === "youtube-url"}
              label="YouTube URL"
              onClick={() => onSourceModeChange("youtube-url")}
            />
            <ModeButton
              active={sourceMode === "youtube-search"}
              label="YouTube 検索"
              onClick={() => onSourceModeChange("youtube-search")}
            />
            <ModeButton
              active={sourceMode === "local"}
              label="ローカルファイル"
              onClick={() => onSourceModeChange("local")}
            />
          </div>
        </div>

        {!accountLoading && !sessionUser && (
          <form className="grid gap-3" onSubmit={submitAccountForm}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">メールアドレス</span>
                <input
                  type="email"
                  value={accountEmail}
                  onChange={(event) => setAccountEmail(event.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                  placeholder="name@example.com"
                  autoComplete="email"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">パスワード</span>
                <input
                  type="password"
                  value={accountPassword}
                  onChange={(event) => setAccountPassword(event.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                  placeholder="6文字以上"
                  autoComplete={
                    accountFormMode === "register" ? "new-password" : "current-password"
                  }
                />
              </label>
            </div>
            {accountFormMode === "register" && (
              <label className="grid gap-2 md:max-w-sm">
                <span className="text-sm font-medium text-slate-700">表示名</span>
                <input
                  type="text"
                  value={accountDisplayName}
                  onChange={(event) => setAccountDisplayName(event.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                  placeholder="任意"
                  autoComplete="nickname"
                />
              </label>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={accountSubmitting}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {accountSubmitting
                  ? "送信中..."
                  : accountFormMode === "register"
                    ? "アカウントを作成"
                    : "ログイン"}
              </button>
              <span className="text-xs text-slate-500">
                ログインすると、YouTube 動画の URL と調整値を保存できます。
              </span>
            </div>
          </form>
        )}

        {accountError && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {accountError}
          </p>
        )}
      </section>

      {sourceMode === "local" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-row items-center gap-3">
            <label className="cursor-pointer">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4"
                className="sr-only"
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
              <span className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap">
                ファイルを選択
              </span>
            </label>
            <span className="text-xs text-slate-500">（MP4のみ対応）</span>
            {sourceFile && (
              <span className="truncate text-sm text-slate-700">{sourceFile.name}</span>
            )}
          </div>
        </section>
      )}

      {sourceMode === "youtube-url" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <form className="grid gap-3" onSubmit={resolveYouTubeUrl}>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">
                YouTube URL を入力
              </span>
              <input
                type="url"
                value={youtubeUrlInput}
                onChange={(e) => setYoutubeUrlInput(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={youtubeImporting}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {youtubeImporting ? "読み込み中…" : "読み込んで使う"}
              </button>
              <span className="text-xs text-slate-500">
                対応形式: `youtube.com/watch?v=...`, `youtu.be/...`
              </span>
            </div>
            {youtubeUrlError && <p className="text-sm text-red-700">{youtubeUrlError}</p>}
          </form>
        </section>
      )}

      {sourceMode === "youtube-search" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <form className="grid gap-3" onSubmit={searchYouTube}>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">
                YouTube を検索
              </span>
              <input
                type="search"
                value={youtubeSearchInput}
                onChange={(e) => setYoutubeSearchInput(e.target.value)}
                placeholder="曲名、アーティスト名、動画タイトルなど"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={youtubeSearchLoading || youtubeImporting}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {youtubeSearchLoading ? "検索中…" : youtubeImporting ? "取り込み中…" : "検索する"}
              </button>
              <span className="text-xs text-slate-500">
                検索結果をクリックすると `yt-dlp` で取り込みます。
              </span>
              {youtubeSearchSelectedUrl && (
                <div className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <div className="font-medium text-slate-700">現在の動画 URL</div>
                  <a
                    href={youtubeSearchSelectedUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={youtubeSearchSelectedUrl}
                    className="block truncate text-slate-900 hover:underline"
                  >
                    {youtubeSearchSelectedUrl}
                  </a>
                </div>
              )}
            </div>
            {youtubeSearchError && (
              <p className="text-sm text-red-700">{youtubeSearchError}</p>
            )}
          </form>

          {youtubeSearchResults.length > 0 && (
            <div className="mt-4 grid gap-3">
              {youtubeSearchResults.map((item) => {
                const isSelected = youtubeSource?.videoId === item.videoId;
                const isImportingThisItem = youtubeImporting && isSelected;

                return (
                  <button
                    key={item.videoId}
                    type="button"
                    onClick={() => {
                      void selectYouTubeSource(item);
                    }}
                    disabled={youtubeImporting || youtubeSearchLoading}
                    className={`grid gap-3 rounded-lg border p-3 text-left md:grid-cols-[160px_1fr] ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-slate-200 hover:border-slate-400"
                    } disabled:cursor-wait disabled:opacity-70`}
                  >
                    <div className="relative overflow-hidden rounded-md bg-slate-100">
                      <Image
                        src={item.thumbnailUrl}
                        alt={item.title}
                        width={320}
                        height={180}
                        className="h-auto w-full"
                      />
                      {item.durationText && (
                        <span className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-1 text-xs font-semibold text-white">
                          {item.durationText}
                        </span>
                      )}
                    </div>
                    <div className="grid gap-2">
                      <div className="font-medium text-slate-900">{item.title}</div>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        <span>{item.channelTitle}</span>
                        {item.durationText && <span>・{item.durationText}</span>}
                        {isImportingThisItem && (
                          <span className="font-semibold text-emerald-700">取り込み中…</span>
                        )}
                      </div>
                      {item.description && (
                        <p
                          className="text-sm text-slate-500"
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {item.description}
                        </p>
                      )}
                      <p className="text-xs text-slate-500">クリックで取り込み</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {sessionUser && (
        <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">保存済み動画</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={savedItemsSearchQuery}
                onChange={(event) => setSavedItemsSearchQuery(event.target.value)}
                placeholder="タイトルや URL で検索"
                aria-label="保存済み動画を検索"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 md:w-80"
              />
              <div className="flex overflow-hidden rounded-md border border-slate-300">
                <button
                  type="button"
                  onClick={() => setSavedItemsLayout("scroll")}
                  className={`px-3 py-2 text-sm font-semibold transition ${
                    savedItemsLayout === "scroll"
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  横スクロール
                </button>
                <button
                  type="button"
                  onClick={() => setSavedItemsLayout("grid")}
                  className={`border-l border-slate-300 px-3 py-2 text-sm font-semibold transition ${
                    savedItemsLayout === "grid"
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  敷き詰め
                </button>
              </div>
              <button
                type="button"
                onClick={() => void refreshSavedItems()}
                disabled={libraryLoading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                {libraryLoading ? "更新中..." : "再読み込み"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SavedFolderButton
              label={`すべて ${savedItems.length}`}
              active={selectedSavedFolderId === "all"}
              onClick={() => setSelectedSavedFolderId("all")}
            />
            <SavedFolderButton
              label={`未分類 ${savedItems.filter((item) => !item.folderId).length}`}
              active={selectedSavedFolderId === UNFILED_FOLDER_SELECTION}
              onClick={() => setSelectedSavedFolderId(UNFILED_FOLDER_SELECTION)}
            />
            {savedFolders.map((folder) => (
              <SavedFolderButton
                key={folder.id}
                label={`${folder.name} ${
                  savedItems.filter((item) => item.folderId === folder.id).length
                }`}
                active={selectedSavedFolderId === folder.id}
                onClick={() => setSelectedSavedFolderId(folder.id)}
              />
            ))}
            <button
              type="button"
              onClick={() => void createSavedFolder()}
              disabled={folderCreating}
              className="rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {folderCreating ? "作成中..." : "フォルダ作成"}
            </button>
          </div>

          {libraryError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {libraryError}
            </p>
          )}

          {filteredSavedItems.length > 0 ? (
            <div
              className={
                savedItemsLayout === "scroll" ? "overflow-x-auto pb-2" : ""
              }
            >
              <div
                className={
                  savedItemsLayout === "scroll"
                    ? "flex min-w-max gap-3"
                    : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                }
              >
              {filteredSavedItems.map((item, index) => {
                const isActive = item.id === activeSavedItemId;
                const isLoading = item.id === loadingSavedItemId;
                const isDeleting = item.id === deletingSavedItemId;
                const isRenaming = item.id === renamingSavedItemId;
                const isMoving = item.id === movingSavedItemId;
                const isAssigning = item.id === assigningSavedItemId;
                const itemActionsDisabled =
                  !!loadingSavedItemId ||
                  !!deletingSavedItemId ||
                  !!renamingSavedItemId ||
                  !!movingSavedItemId ||
                  !!assigningSavedItemId;

                return (
                  <div
                    key={item.id}
                    className={`grid gap-3 rounded-lg border p-4 ${
                      savedItemsLayout === "scroll" ? "w-80 shrink-0" : "w-full"
                    } ${
                      isActive
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="grid gap-1">
                      <div className="font-semibold text-slate-900">{item.title}</div>
                      <div className="truncate text-xs text-slate-500">
                        {item.sourceUrl || item.originalFileName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatSavedItemStorage(item)} ・ 更新 {formatRelativeDate(item.updatedAt)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {getSavedFolderLabel(savedFolders, item.folderId)}
                      </div>
                    </div>
                    <div className="grid gap-1 text-xs text-slate-600">
                      <div>オフセット {item.offsetSec.toFixed(3)} 秒</div>
                      <div>ブックマーク {item.bookmarks.length} 件</div>
                    </div>
                    <select
                      value={item.folderId ?? ""}
                      onChange={(event) =>
                        void updateSavedItemFolder(item, event.target.value || null)
                      }
                      disabled={itemActionsDisabled}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700 disabled:opacity-60"
                      aria-label="保存先フォルダ"
                    >
                      <option value="">未分類</option>
                      {savedFolders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void moveSavedItem(item, -1)}
                        disabled={itemActionsDisabled || index === 0}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                      >
                        {isMoving ? "移動中..." : "← 左へ"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void moveSavedItem(item, 1)}
                        disabled={itemActionsDisabled || index === filteredSavedItems.length - 1}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                      >
                        {isMoving ? "移動中..." : "右へ →"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void loadSavedItem(item)}
                        disabled={itemActionsDisabled}
                        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {isLoading ? "読み込み中..." : "読み込む"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void renameSavedItem(item)}
                        disabled={itemActionsDisabled}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                      >
                        {isRenaming ? "変更中..." : "名前変更"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteSavedItemById(item.id)}
                        disabled={itemActionsDisabled || isActive}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                      >
                        {isDeleting ? "削除中..." : isActive ? "読込中は削除不可" : "削除"}
                      </button>
                    </div>
                    {isAssigning && (
                      <div className="text-xs font-semibold text-slate-500">フォルダ移動中...</div>
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              {libraryLoading
                ? "読み込み中..."
                : savedItems.length > 0
                  ? "検索条件に一致する保存済み動画はありません。"
                  : "まだ保存済み動画はありません。"}
            </div>
          )}
        </section>
      )}

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="grid gap-8">
          <div
            ref={playerShellRef}
            className={
              isPseudoFullscreen
                ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-black"
                : isPlayerFullscreen
                  ? "relative flex h-full w-full flex-col overflow-hidden bg-black"
                  : "grid gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            }
            style={isPlayerFullscreen ? { height: "100dvh" } : undefined}
          >
            <div
              className={
                isPlayerFullscreen
                  ? "relative min-h-0 flex-1 overflow-hidden bg-black"
                  : "relative overflow-hidden rounded-xl bg-black"
              }
            >
              {localSourceReady && !isPlayerFullscreen && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end p-3">
                  <button
                    type="button"
                    onClick={() => void togglePlayerFullscreen()}
                    className="pointer-events-auto rounded-full bg-slate-950/80 px-4 py-2 text-sm font-semibold text-white backdrop-blur"
                  >
                    全画面操作
                  </button>
                </div>
              )}
              <video
                ref={videoRef}
                preload="auto"
                controls={mediaReadyForPlayback && !screenLocked}
                playsInline
                controlsList="nofullscreen noremoteplayback"
                disablePictureInPicture
                onClick={onVideoSurfaceClick}
                onDoubleClick={onVideoSurfaceDoubleClick}
                style={{
                  width: "100%",
                  height: isPlayerFullscreen ? "100%" : "auto",
                  background: "#000",
                  objectFit: "contain",
                  cursor: localSourceReady && !screenLocked ? "pointer" : "default",
                }}
                onSeeking={onVideoSeeking}
                onSeeked={onVideoSeeked}
                onPlay={startFromVideo}
                onPause={onVideoPause}
                onEnded={onVideoPause}
              />

              {localSourceReady && !mediaReadyForPlayback && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/78 px-6 text-center text-white">
                  <div className="rounded-full border border-white/20 bg-black/50 px-5 py-3 text-sm font-medium backdrop-blur">
                    動画と音声を読み込み中…
                  </div>
                </div>
              )}

              {isPlayerFullscreen && (
                <>
                  {!screenLocked && (
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-1">
                      <div className="pointer-events-auto rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
                        速度 {playbackRate.toFixed(2)}x / オフセット {offsetSec.toFixed(3)} 秒
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setFullscreenControlsOpen((current) => !current)}
                          className="pointer-events-auto rounded-full bg-black/60 px-3 py-2 text-xs font-semibold text-white backdrop-blur"
                        >
                          {fullscreenControlsOpen ? "操作を隠す" : "操作を表示"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void exitPlayerFullscreen()}
                          className="pointer-events-auto rounded-full bg-white px-3 py-2 text-xs font-semibold text-slate-900"
                        >
                          閉じる
                        </button>
                      </div>
                    </div>
                  )}

                  <div
                    className={`pointer-events-none absolute inset-x-0 bottom-0 top-12 z-20 px-0.5 pb-0.5 transition duration-200 ${
                      fullscreenControlsOpen && !screenLocked
                        ? "translate-y-0 opacity-100"
                        : "translate-y-4 opacity-0"
                    }`}
                  >
                    <div className="flex h-full items-stretch justify-between gap-1">
                      <div className="pointer-events-auto flex h-full w-[min(8.5rem,20vw)] flex-col rounded-[1.25rem] border border-white/10 bg-slate-950/88 p-3 text-white shadow-2xl backdrop-blur">
                        <div className="grid gap-3">
                          <div className="flex min-h-11 items-center px-1">
                            <button
                              type="button"
                              onClick={() => adjustPlaybackRate(-0.05)}
                              disabled={localControlsDisabled}
                              className="rounded-full border border-white/15 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              -0.05
                            </button>
                          </div>

                          <div className="flex min-h-11 items-center px-1">
                            <button
                              type="button"
                              onClick={() => adjustOffset(-0.005)}
                              disabled={localControlsDisabled}
                              className="rounded-full border border-white/15 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              -0.005
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                            ブクマ{bookmarks.length}件
                          </div>
                        </div>
                        <div className="mt-2 min-h-0 flex-1 overflow-auto">
                          {bookmarks.length > 0 ? (
                            <div className="grid gap-2">
                              {bookmarks.map((bookmark, index) => (
                                <div
                                  key={bookmark.id}
                                  className="grid gap-2 rounded-2xl border border-white/10 bg-white/5 p-3"
                                >
                                  <button
                                    type="button"
                                    onClick={() => jumpToBookmark(bookmark.timeSec)}
                                    className="grid gap-1 text-left"
                                  >
                                    <span className="text-xs text-slate-400">
                                      #{index + 1}
                                      {index < 10 ? ` / ${index === 9 ? 0 : index + 1}` : ""}
                                    </span>
                                    <span className="font-mono text-sm text-white">
                                      {formatBookmarkTime(bookmark.timeSec)}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteBookmark(bookmark.id)}
                                    className="rounded-full border border-white/10 px-2 py-1.5 text-[11px] font-semibold text-slate-200"
                                  >
                                    削除
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-400">
                              まだブックマークはありません。
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="pointer-events-auto flex h-full w-[min(9.5rem,22vw)] flex-col rounded-[1.25rem] border border-white/10 bg-slate-950/88 p-3 text-white shadow-2xl backdrop-blur">
                        <div className="grid gap-3">
                          <div className="flex min-h-11 items-center justify-end px-1">
                            <button
                              type="button"
                              onClick={() => adjustPlaybackRate(0.05)}
                              disabled={localControlsDisabled}
                              className="rounded-full border border-white/15 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              +0.05
                            </button>
                          </div>

                          <div className="flex min-h-11 items-center justify-end px-1">
                            <button
                              type="button"
                              onClick={() => adjustOffset(0.005)}
                              disabled={localControlsDisabled}
                              className="rounded-full border border-white/15 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              +0.005
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-2">
                          <button
                            type="button"
                            onClick={() => void togglePlayback()}
                            disabled={localControlsDisabled}
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50"
                          >
                            <FullscreenButtonIcon src={playing ? "/stop.svg" : "/start.svg"} />
                            {playing ? "一時停止" : "再生"}
                          </button>
                          <button
                            type="button"
                            onClick={saveBookmarkAtCurrentTime}
                            disabled={localControlsDisabled}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-50"
                          >
                            <FullscreenButtonIcon src="/bookmark.svg" />
                            保存
                          </button>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => seekVideoBy(-5)}
                              disabled={localControlsDisabled}
                              className="rounded-full border border-white/15 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              -5
                            </button>
                            <button
                              type="button"
                              onClick={() => seekVideoBy(5)}
                              disabled={localControlsDisabled}
                              className="rounded-full border border-white/15 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              +5
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => seekVideoBy(-10)}
                              disabled={localControlsDisabled}
                              className="rounded-full border border-white/15 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              -10
                            </button>
                            <button
                              type="button"
                              onClick={() => seekVideoBy(10)}
                              disabled={localControlsDisabled}
                              className="rounded-full border border-white/15 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              +10
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setScreenLocked(true);
                              setFullscreenControlsOpen(false);
                            }}
                            disabled={localControlsDisabled}
                            className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            画面ロック
                          </button>
                        </div>

                      </div>
                    </div>
                  </div>
                  {screenLocked && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 top-12 z-30 px-0.5 pb-0.5">
                      <div className="flex h-full items-end justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setScreenLocked(false);
                            setFullscreenControlsOpen(true);
                          }}
                          className="pointer-events-auto mb-3 mr-3 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-2xl"
                        >
                          画面ロック解除
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            {localSourceReady && !isPlayerFullscreen && (
              <AudioWaveform active={playing && mediaReadyForPlayback} />
            )}
            <audio
              ref={audioRef}
              preload="auto"
              style={{ display: "none" }}
            />
          </div>

          <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {bookmarks.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {bookmarks.map((bookmark, index) => (
                        <div
                          key={bookmark.id}
                          className="grid min-w-32 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <button
                            type="button"
                            onClick={() => jumpToBookmark(bookmark.timeSec)}
                            className="grid gap-1 text-left"
                          >
                            <span className="text-xs text-slate-500">
                              #{index + 1}
                              {index < 10 ? ` / ${index === 9 ? 0 : index + 1}` : ""}
                            </span>
                            <span className="font-mono text-sm text-slate-900">
                              {formatBookmarkTime(bookmark.timeSec)}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteBookmark(bookmark.id)}
                            className="rounded-full border border-slate-300 px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-slate-400"
                          >
                            削除
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                      まだブックマークはありません。
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={saveBookmarkAtCurrentTime}
                  disabled={localControlsDisabled}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  ブックマーク保存
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span>再生速度:</span>
                <button
                  type="button"
                  aria-label="再生速度を下げる"
                  onClick={() => adjustPlaybackRate(-0.05)}
                  disabled={localControlsDisabled}
                  style={iconButtonStyle}
                >
                  <MinusIcon />
                </button>
                <input
                  type="range"
                  min={0.1}
                  max={2.0}
                  step={0.05}
                  value={playbackRate}
                  onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                  disabled={localControlsDisabled}
                  style={{ flex: 1, minWidth: 260, height: 28 }}
                />
                <button
                  type="button"
                  aria-label="再生速度を上げる"
                  onClick={() => adjustPlaybackRate(0.05)}
                  disabled={localControlsDisabled}
                  style={iconButtonStyle}
                >
                  <PlusIcon />
                </button>
                <span className="min-w-20 text-right font-semibold">
                  {playbackRate.toFixed(2)}x
                </span>
                <button
                  type="button"
                  onClick={() => setPlaybackRate(1)}
                  disabled={localControlsDisabled}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-60"
                >
                  リセット
                </button>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span>音声オフセット:</span>
                  <button
                    type="button"
                    aria-label="音声オフセットを下げる"
                    onClick={() => adjustOffset(-0.005)}
                    disabled={localControlsDisabled}
                    style={iconButtonStyle}
                  >
                    <MinusIcon />
                  </button>
                  <input
                    type="range"
                    min={-0.3}
                    max={0.3}
                    step={0.005}
                    value={offsetSec}
                    onPointerDown={() => (offsetDraggingRef.current = true)}
                    onPointerUp={onOffsetCommit}
                    onPointerCancel={onOffsetCommit}
                    onChange={(e) => setOffsetSec(parseFloat(e.target.value))}
                    onMouseUp={onOffsetCommit}
                    onTouchEnd={onOffsetCommit}
                    disabled={localControlsDisabled}
                    style={{ flex: 1, minWidth: 260, height: 28 }}
                  />
                  <button
                    type="button"
                    aria-label="音声オフセットを上げる"
                    onClick={() => adjustOffset(0.005)}
                    disabled={localControlsDisabled}
                    style={iconButtonStyle}
                  >
                    <PlusIcon />
                  </button>
                  <span className="min-w-24 text-right font-semibold">
                    {offsetSec.toFixed(3)} 秒
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      offsetDraggingRef.current = false;
                      setOffsetSec(0);
                      requestAnimationFrame(() => {
                        syncDetachedAudioToVideo();
                      });
                    }}
                    disabled={localControlsDisabled}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-60"
                  >
                    リセット
                  </button>
                </div>
                {sourceOrigin === "youtube" && (
                  <p className="text-xs text-slate-500">
                    YouTube 取り込み時は基準補正 {YOUTUBE_IMPORT_BASELINE_OFFSET_SEC.toFixed(3)} 秒を自動適用しています。
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span>選択範囲:</span>
                <span>
                  {trimStartSec !== null ? trimStartSec.toFixed(3) : "--"} ~{" "}
                  {trimEndSec !== null ? trimEndSec.toFixed(3) : "--"}
                </span>
                <button
                  type="button"
                  disabled={localControlsDisabled}
                  onClick={() => {
                    const v = videoRef.current;
                    if (!v) return;
                    setTrimStartSec(v.currentTime);
                  }}
                  className="text-green-300"
                >
                  始点を現在位置に設定
                </button>
                <button
                  type="button"
                  disabled={localControlsDisabled}
                  onClick={() => {
                    const v = videoRef.current;
                    if (!v) return;
                    setTrimEndSec(v.currentTime);
                  }}
                  className="text-red-300"
                >
                  終点を現在位置に設定
                </button>
                <button
                  type="button"
                  disabled={localControlsDisabled}
                  onClick={() => {
                    setTrimStartSec(null);
                    setTrimEndSec(null);
                  }}
                >
                  クリア
                </button>
                {trimStartSec !== null &&
                  trimEndSec !== null &&
                  trimStartSec >= trimEndSec && (
                    <span style={{ color: "#b00" }}>始点は終点より前にしてください</span>
                  )}
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label
                  style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                >
                  <span>書き出し画質:</span>
                  <select
                    value={exportResolution}
                    onChange={(e) =>
                      setExportResolution(e.target.value as ExportResolutionPreset)
                    }
                    disabled={localControlsDisabled || exporting}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {exportResolutionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} ({option.hint})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  onClick={onExport}
                  disabled={
                    localControlsDisabled ||
                    exporting ||
                    (trimStartSec !== null &&
                      trimEndSec !== null &&
                      trimStartSec >= trimEndSec)
                  }
                >
                  {exporting ? "ダウンロード中…" : "ダウンロード（速度/オフセット反映）"}
                </button>
                {exporting && <span>{Math.round(exportProgress * 100)}%</span>}
                {exportError && (
                  <pre style={{ color: "#b00", margin: 0, whiteSpace: "pre-wrap" }}>
                    {exportError}
                  </pre>
                )}
              </div>
            </div>

            <p style={{ color: "#666", marginTop: 8 }}>
              ・音声が早いなら+方向、音声が遅いなら-方向にオフセットを調整してください。<br />
              　動画が早いなら-方向、動画が遅いなら+方向にオフセットを調整してください。<br />
              ・動画自体の音声は変更されてないので動画のほうはミュートにしてください。<br />
            </p>
          </section>
        </div>

        <aside className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-4">
          <div className="grid gap-2">
            <div className="text-sm font-semibold text-slate-900">操作メモ</div>
            <p className="text-xs text-slate-500">
              ブックマークは左側の一覧から選んで移動できます。
            </p>
            <p className="text-xs text-slate-500">
              `1` から `9`、`0` で 10 件目へ移動できます。
            </p>
            <p className="text-xs text-slate-500">
              `q/e` でオフセット、`a/d` で再生速度を調整できます。
            </p>
            <p className="text-xs text-slate-500">`f` でフルスクリーン切替ができます。</p>
            <p className="text-xs text-slate-500">
              スマホでは動画右上の「全画面操作」を使うと、全画面中も下の操作パネルを触れます。
            </p>
            <p className="text-xs text-slate-500">動画をクリックして再生 / 一時停止できます。</p>
            <p className="text-xs text-slate-500">`Space / k` で再生 / 一時停止できます。</p>
            <p className="text-xs text-slate-500">`b` で現在位置をブックマーク保存できます。</p>
            <p className="text-xs text-slate-500">左右矢印で 5 秒前 / 5 秒後へ移動できます。</p>
            <p className="text-xs text-slate-500">`j/l` で 10 秒前 / 10 秒後へ移動できます。</p>
          </div>
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
            ブックマークは下の操作パネルに移動しました。
          </div>
        </aside>
      </section>

      {(youtubeWarning || youtubeSourceReady || youtubeImportError) && (
        <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-600">
            YouTube ソースは `yt-dlp` で MP4 として取り込むと、下のローカル再生フローに移ります。
            オフセット調整、トリム、ダウンロード書き出しは取り込み後のローカルファイルに対して使えます。
          </p>

          {youtubeWarning && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {youtubeWarning}
            </p>
          )}

          {youtubeSourceReady ? (
            <>
              <div className="grid gap-4 md:grid-cols-[240px_1fr]">
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                  <Image
                    src={youtubeSource.thumbnailUrl}
                    alt={youtubeSource.title}
                    width={480}
                    height={270}
                    className="h-auto w-full"
                  />
                </div>
                <div className="grid gap-2">
                  <div className="text-xl font-semibold text-slate-900">
                    {youtubeSource.title}
                  </div>
                  <div className="text-sm text-slate-600">{youtubeSource.channelTitle}</div>
                  {youtubeSource.description && (
                    <p
                      className="text-sm text-slate-500"
                      style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                    >
                      {youtubeSource.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={importSelectedYouTubeSource}
                      disabled={youtubeImporting}
                      className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {youtubeImporting
                        ? "取り込み中…"
                        : youtubeImportError
                          ? "再試行する"
                          : "この動画を取り込む"}
                    </button>
                    <a
                      href={youtubeSource.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                    >
                      YouTube で開く
                    </a>
                  </div>
                  {youtubeImportError && (
                    <p className="text-sm text-red-700">{youtubeImportError}</p>
                  )}
                </div>
              </div>

              <div
                style={{
                  position: "relative",
                  width: "100%",
                  paddingTop: "56.25%",
                  overflow: "hidden",
                  borderRadius: 16,
                  background: "#000",
                }}
              >
                <iframe
                  src={buildYouTubeEmbedUrl(youtubeSource.videoId)}
                  title={youtubeSource.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    border: 0,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              検索結果をクリックすると `yt-dlp` で取り込みます。失敗した場合はここにプレビューと再試行ボタンを表示します。
            </div>
          )}
        </section>
      )}

      <section className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <a
          href="https://maimai.sega.jp/song/new/"
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-slate-900 underline underline-offset-4"
        >
          maimai 新曲
        </a>
        <a
          href="https://qman11010101.github.io/constant-table/maimai.html"
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-slate-900 underline underline-offset-4"
        >
          maimai 曲リスト
        </a>
      </section>
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
      }`}
    >
      {label}
    </button>
  );
}

function SavedFolderButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
      }`}
    >
      {label}
    </button>
  );
}

function FullscreenButtonIcon({ src }: { src: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      style={{
        backgroundColor: "currentColor",
        mask: `url(${src}) center / contain no-repeat`,
        WebkitMask: `url(${src}) center / contain no-repeat`,
      }}
    />
  );
}

function AudioWaveform({ active }: { active: boolean }) {
  const bars = Array.from({ length: 64 }, (_, index) => {
    const height = 10 + Math.round(Math.abs(Math.sin(index * 0.58)) * 26);
    return { height, delay: index * 28 };
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-950 px-3 py-3">
      <div className="flex h-12 items-center gap-1 overflow-hidden">
        {bars.map((bar, index) => (
          <span
            key={index}
            className={`w-1 shrink-0 rounded-full bg-cyan-300/80 ${
              active ? "animate-pulse" : "opacity-45"
            }`}
            style={{
              height: bar.height,
              animationDelay: `${bar.delay}ms`,
              animationDuration: "900ms",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function createBookmarkId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundBookmarkTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function formatBookmarkTime(value: number) {
  const totalMilliseconds = Math.max(0, Math.round(value * 1000));
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const base = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${base}`;
  }

  return base;
}

function getSourceBaselineOffsetSec(sourceOrigin: SourceOrigin) {
  return sourceOrigin === "youtube" ? YOUTUBE_IMPORT_BASELINE_OFFSET_SEC : 0;
}

function getDefaultLibraryTitle(fileName: string) {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "保存動画";
  }

  return trimmed.replace(/\.[^/.]+$/, "") || trimmed;
}

function normalizeLibraryTitleForSave(
  title: string,
  youtubeVideoId: string | null,
  sourceUrl: string | null
) {
  const normalizedVideoId =
    youtubeVideoId ?? extractYouTubeVideoId(sourceUrl ?? "") ?? "youtube-video";
  const trimmed = title.trim().slice(0, 160);

  return trimmed || `YouTube video (${normalizedVideoId})`;
}

function createLibrarySaveSignature(input: {
  title: string;
  offsetSec: number;
  trimStartSec: number | null;
  trimEndSec: number | null;
  bookmarks: PlaybackBookmark[];
}) {
  return JSON.stringify({
    title: input.title,
    offsetSec: input.offsetSec,
    trimStartSec: input.trimStartSec,
    trimEndSec: input.trimEndSec,
    bookmarks: input.bookmarks,
  });
}

function upsertSavedItem(current: SavedMediaItem[], nextItem: SavedMediaItem) {
  return sortSavedItems([...current.filter((item) => item.id !== nextItem.id), nextItem]);
}

function sortSavedItems(items: SavedMediaItem[]) {
  return [...items].sort(
    (left, right) => getSavedItemSortOrder(right) - getSavedItemSortOrder(left)
  );
}

function sortSavedFolders(folders: SavedMediaFolder[]) {
  return [...folders].sort(
    (left, right) => getSavedFolderSortOrder(right) - getSavedFolderSortOrder(left)
  );
}

function getSavedItemSortOrder(item: SavedMediaItem) {
  if (Number.isFinite(item.sortOrder)) {
    return item.sortOrder;
  }

  const createdAt = Date.parse(item.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function getSavedFolderSortOrder(folder: SavedMediaFolder) {
  if (Number.isFinite(folder.sortOrder)) {
    return folder.sortOrder;
  }

  const createdAt = Date.parse(folder.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function getSavedFolderLabel(folders: SavedMediaFolder[], folderId: string | null) {
  if (!folderId) {
    return "未分類";
  }

  return folders.find((folder) => folder.id === folderId)?.name ?? "不明なフォルダ";
}

function formatSavedItemStorage(item: SavedMediaItem) {
  if (item.sourceOrigin === "youtube" && item.sourceUrl && item.fileSizeBytes <= 0) {
    return "YouTube 保存";
  }

  return formatFileSize(item.fileSizeBytes);
}

function formatFileSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 ? 0 : size >= 100 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function MinusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function isPlayInterruptedError(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

function isMediaReadyForPlayback(media: HTMLMediaElement | null, minimumReadyState = 3) {
  return Boolean(media && media.readyState >= minimumReadyState);
}

function waitForPlayableMedia(
  media: HTMLMediaElement,
  tokenRef: { current: number },
  token: number,
  options?: {
    minimumReadyState?: number;
    fallbackReadyState?: number;
    timeoutMs?: number;
  }
) {
  const minimumReadyState = options?.minimumReadyState ?? 3;
  const fallbackReadyState = options?.fallbackReadyState ?? minimumReadyState;
  const timeoutMs = options?.timeoutMs ?? 4_000;

  if (isMediaReadyForPlayback(media, minimumReadyState)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      if (token !== tokenRef.current) {
        finish(() => reject(new Error("stale media load wait")));
        return;
      }

      if (isMediaReadyForPlayback(media, fallbackReadyState)) {
        finish(resolve);
        return;
      }

      finish(() => reject(new Error("media load timed out")));
    }, timeoutMs);

    const finish = (callback: () => void) => {
      cleanup();
      callback();
    };

    const handleReady = () => {
      if (token !== tokenRef.current) {
        finish(() => reject(new Error("stale media load wait")));
        return;
      }

      if (isMediaReadyForPlayback(media, minimumReadyState)) {
        finish(resolve);
      }
    };

    const handleError = () => {
      finish(() => reject(new Error("media failed to become playable")));
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      media.removeEventListener("canplay", handleReady);
      media.removeEventListener("canplaythrough", handleReady);
      media.removeEventListener("loadeddata", handleReady);
      media.removeEventListener("loadedmetadata", handleReady);
      media.removeEventListener("error", handleError);
      media.removeEventListener("emptied", handleError);
    };

    media.addEventListener("canplay", handleReady);
    media.addEventListener("canplaythrough", handleReady);
    media.addEventListener("loadeddata", handleReady);
    media.addEventListener("loadedmetadata", handleReady);
    media.addEventListener("error", handleError);
    media.addEventListener("emptied", handleError);

    handleReady();
  });
}

function parseFileNameFromContentDisposition(header: string | null) {
  if (!header) return null;

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const simpleMatch = header.match(/filename="([^"]+)"/i);
  return simpleMatch?.[1] ?? null;
}

function getBookmarkIndexFromShortcut(event: KeyboardEvent) {
  const key = event.key;
  if (!/^\d$/.test(key)) return null;

  const numeric = Number.parseInt(key, 10);
  if (!Number.isFinite(numeric)) return null;

  return numeric === 0 ? 9 : numeric - 1;
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

/**
 * currentTime はタイミング次第で例外になることがある
 * - 失敗したら次フレームに1回だけリトライ
 * - ただし “古いリトライ” が新しい seek を上書きしないよう token でガード
 */
function safeSetCurrentTime(
  el: HTMLMediaElement,
  t: number,
  tokenRef?: { current: number }
) {
  const token = tokenRef ? ++tokenRef.current : 0;

  try {
    el.currentTime = t;
  } catch {
    requestAnimationFrame(() => {
      if (tokenRef && token !== tokenRef.current) return; // 新しいseekが来ていたら中止
      try {
        el.currentTime = t;
      } catch {
        // 再試行でも失敗したら諦める
      }
    });
  }
}
