"use client";

import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";
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

type SourceMode = "local" | "youtube-url" | "youtube-search";

type SearchYouTubeResponse = {
  items?: YouTubeVideoSummary[];
  error?: string;
};

type PlaybackBookmark = {
  id: string;
  timeSec: number;
};

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
  const audioRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [sourceMode, setSourceMode] = useState<SourceMode>("local");
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
  const [youtubeSearchError, setYoutubeSearchError] = useState<string | null>(null);
  const [youtubeSearchLoading, setYoutubeSearchLoading] = useState(false);
  const [youtubeSearchResults, setYoutubeSearchResults] = useState<YouTubeVideoSummary[]>([]);
  const [youtubeImporting, setYoutubeImporting] = useState(false);
  const [youtubeImportError, setYoutubeImportError] = useState<string | null>(null);
  const exportStartedAtRef = useRef(0);
  const exportProgressRef = useRef(0);

  // 同期ループ
  const rafRef = useRef<number | null>(null);
  const lastSyncCheckAtRef = useRef(0);
  const offsetDraggingRef = useRef(false);

  // safeSetCurrentTime の “古いリトライ上書き” 防止トークン
  const seekTokenRef = useRef(0);
  const playStartTokenRef = useRef(0);

  const urlForCleanup = useRef<string | null>(null);
  const localSourceReady = !!srcUrl && !!sourceFile;
  const youtubeSourceReady = sourceMode !== "local" && youtubeSource !== null;
  const localControlsDisabled = !localSourceReady;
  const usesDetachedAudio = localSourceReady;

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
    videoRef.current?.pause();
    audioRef.current?.pause();
    setPlaying(false);
  };

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
    setYoutubeSource(null);
    setYoutubeWarning(null);
    setYoutubeImportError(null);
    setBookmarks([]);

    // 任意：表示リセット
    setExportError(null);
    setExportProgress(0);
  };

  const saveBookmarkAtCurrentTime = () => {
    const video = videoRef.current;
    if (!video || !localSourceReady) return;

    const timeSec = roundBookmarkTime(video.currentTime);
    setBookmarks((current) =>
      [...current, { id: createBookmarkId(), timeSec }].sort((a, b) => a.timeSec - b.timeSec)
    );
  };

  const jumpToBookmark = (timeSec: number) => {
    const video = videoRef.current;
    if (!video || !localSourceReady) return;

    video.currentTime = clamp(timeSec, 0, video.duration || Infinity);
  };

  const deleteBookmark = (bookmarkId: string) => {
    setBookmarks((current) => current.filter((bookmark) => bookmark.id !== bookmarkId));
  };

  const onVideoPause = () => {
    playStartTokenRef.current += 1;
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
        offsetSec,
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
        Math.abs(offsetSec) > 1e-6 ? `_offset${offsetSec.toFixed(3)}` : "";
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

  // 動画の controls から再生された場合の同期開始
  const startFromVideo = async () => {
    const startToken = ++playStartTokenRef.current;
    const v = videoRef.current;
    const a = audioRef.current;
    if (!localSourceReady || !v || !a || !srcUrl) return;
    if (!a.paused) return;

    v.muted = false;
    v.volume = usesDetachedAudio ? 0 : 1;
    a.muted = false;
    a.volume = 1;

    v.playbackRate = playbackRate;
    a.playbackRate = playbackRate;

    // まず合わせる
    safeSetCurrentTime(
      a,
      clamp(v.currentTime - offsetSec, 0, a.duration || Infinity),
      seekTokenRef
    );

    // onPlay で呼ばれるため video.play() は不要。audio.play() だけ同期して開始。
    const playPromise = a.play();
    void playPromise
      .then(() => {
        if (startToken !== playStartTokenRef.current) return;

        // 次フレームでもう一回合わせる（初期ズレ潰し）
        requestAnimationFrame(() => {
          if (startToken !== playStartTokenRef.current) return;
          const vNow = videoRef.current;
          const aNow = audioRef.current;
          if (!vNow || !aNow) return;
          safeSetCurrentTime(
            aNow,
            clamp(vNow.currentTime - offsetSec, 0, aNow.duration || Infinity),
            seekTokenRef
          );
        });

        setPlaying(true);
      })
      .catch((err) => {
      // 再生中断（pause 競合）による AbortError は想定内として握りつぶす
        if (!isPlayInterruptedError(err)) {
          console.error("audio play failed:", err);
        }
      });
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
    setYoutubeWarning(null);
    setYoutubeSource(null);
    setYoutubeImportError(null);

    try {
      await importYouTubeIntoLocal({
        url: trimmed,
        videoId: extractYouTubeVideoId(trimmed) ?? undefined,
      });
    } catch (err) {
      setYoutubeUrlError(err instanceof Error ? err.message : "YouTube 動画の取得に失敗しました。");
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

      onPickFile(importedFile, { keepCurrentTab: true });
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

  // seekSync: offset変更が確定したら1回だけシーク（ドラッグ中はしない）
  useEffect(() => {
    if (!localSourceReady || !playing || !usesDetachedAudio) return;
    if (offsetDraggingRef.current) return;

    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    safeSetCurrentTime(
      a,
      clamp(v.currentTime - offsetSec, 0, a.duration || Infinity),
      seekTokenRef
    );
  }, [localSourceReady, offsetSec, playing, usesDetachedAudio]);

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

  // 同期ループ（ドラッグ中は補正しない / 100ms判定でジャンプ補正のみ）
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
      if (offsetDraggingRef.current) {
        a.playbackRate = playbackRate;

        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // audioTime = videoTime - offsetSec
      const expectedAudio = v.currentTime - offsetSec;
      const diff = a.currentTime - expectedAudio;

      // 100msごとにズレを判定して、大きい時だけジャンプ補正
      if (now - lastSyncCheckAtRef.current > 100) {
        lastSyncCheckAtRef.current = now;

        if (Math.abs(diff) > 0.12) {
          safeSetCurrentTime(a, clamp(expectedAudio, 0, a.duration || Infinity), seekTokenRef);
        }

        // うねり防止：常に基準速度へ戻す
        a.playbackRate = playbackRate;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [localSourceReady, playing, offsetSec, playbackRate, usesDetachedAudio]);

  // シーク時の追従（ドラッグ中は無視）
  const onVideoSeeked = () => {
    if (!localSourceReady || !usesDetachedAudio) return;
    if (offsetDraggingRef.current) return;

    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    safeSetCurrentTime(
      a,
      clamp(v.currentTime - offsetSec, 0, a.duration || Infinity),
      seekTokenRef
    );
  };

  const onOffsetCommit = () => {
    offsetDraggingRef.current = false;
    if (!localSourceReady || !playing || !usesDetachedAudio) return;

    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    safeSetCurrentTime(
      a,
      clamp(v.currentTime - offsetSec, 0, a.duration || Infinity),
      seekTokenRef
    );
  };

  // src URL 更新
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    if (localSourceReady && srcUrl) {
      v.src = srcUrl;
      v.muted = false;
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

    v.removeAttribute("src");
    a.removeAttribute("src");
    v.load();
    a.load();
  }, [localSourceReady, srcUrl, usesDetachedAudio]);

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

    v.muted = false;
    v.volume = usesDetachedAudio ? 0 : 1;
    if (playing && a.paused) {
      const token = ++playStartTokenRef.current;

      a.muted = false;
      a.volume = 1;
      a.playbackRate = playbackRate;
      safeSetCurrentTime(
        a,
        clamp(v.currentTime - offsetSec, 0, a.duration || Infinity),
        seekTokenRef
      );
      void a.play().catch((err) => {
        if (token !== playStartTokenRef.current) return;
        if (!isPlayInterruptedError(err)) {
          console.error("audio play failed:", err);
        }
      });
    }
  }, [localSourceReady, offsetSec, playbackRate, playing, usesDetachedAudio]);

  // アンマウント時の後始末
  useEffect(() => {
    return () => {
      if (urlForCleanup.current) URL.revokeObjectURL(urlForCleanup.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
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

      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          <ModeButton
            active={sourceMode === "local"}
            label="ローカルファイル"
            onClick={() => onSourceModeChange("local")}
          />
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
        </div>
      </div>

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

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="grid gap-8">
          <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <video
              ref={videoRef}
              preload="auto"
              controls
              style={{
                width: "100%",
                height: "auto",
                background: "#000",
                objectFit: "contain",
              }}
              onSeeked={onVideoSeeked}
              onPlay={startFromVideo}
              onPause={onVideoPause}
              onEnded={onVideoPause}
            />
            <video
              ref={audioRef}
              preload="auto"
              playsInline
              style={{ display: "none" }}
            />
          </div>

          <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  v.currentTime = clamp(v.currentTime - 10, 0, v.duration || Infinity);
                }}
                disabled={localControlsDisabled}
              >
                -10秒
              </button>
              <button
                type="button"
                onClick={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  v.currentTime = clamp(v.currentTime - 5, 0, v.duration || Infinity);
                }}
                disabled={localControlsDisabled}
              >
                -5秒
              </button>
              <button
                type="button"
                onClick={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  v.currentTime = clamp(v.currentTime + 5, 0, v.duration || Infinity);
                }}
                disabled={localControlsDisabled}
              >
                +5秒
              </button>
              <button
                type="button"
                onClick={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  v.currentTime = clamp(v.currentTime + 10, 0, v.duration || Infinity);
                }}
                disabled={localControlsDisabled}
              >
                +10秒
              </button>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span>再生速度:</span>
                <span>{playbackRate.toFixed(2)}x</span>
                <button
                  type="button"
                  aria-label="再生速度を下げる"
                  onClick={() => setPlaybackRate((r) => clamp(r - 0.05, 0.1, 2.0))}
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
                  onClick={() => setPlaybackRate(1.0)}
                  disabled={localControlsDisabled}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:border-slate-400 disabled:opacity-60"
                >
                  リセット
                </button>
                <button
                  type="button"
                  aria-label="再生速度を上げる"
                  onClick={() => setPlaybackRate((r) => clamp(r + 0.05, 0.1, 2.0))}
                  disabled={localControlsDisabled}
                  style={iconButtonStyle}
                >
                  <PlusIcon />
                </button>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span>音声オフセット: {offsetSec.toFixed(3)} 秒</span>
                  <button
                    type="button"
                    aria-label="音声オフセットを下げる"
                    onClick={() => setOffsetSec((v) => clamp(v - 0.005, -0.3, 0.3))}
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
                    onClick={() => setOffsetSec(0)}
                    disabled={localControlsDisabled}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:border-slate-400 disabled:opacity-60"
                  >
                    リセット
                  </button>
                  <button
                    type="button"
                    aria-label="音声オフセットを上げる"
                    onClick={() => setOffsetSec((v) => clamp(v + 0.005, -0.3, 0.3))}
                    disabled={localControlsDisabled}
                    style={iconButtonStyle}
                  >
                    <PlusIcon />
                  </button>
                </div>
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
            <div className="text-sm font-semibold text-slate-900">再生時間ブックマーク</div>
            <p className="text-xs text-slate-500">
              現在位置を保存して、クリックでその時間へ移動できます。
            </p>
          </div>
          <button
            type="button"
            onClick={saveBookmarkAtCurrentTime}
            disabled={localControlsDisabled}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            保存
          </button>
          {bookmarks.length > 0 ? (
            <div className="grid gap-2">
              {bookmarks.map((bookmark, index) => (
                <div key={bookmark.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => jumpToBookmark(bookmark.timeSec)}
                    className="grid flex-1 gap-1 rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-slate-400"
                  >
                    <span className="text-xs text-slate-500">#{index + 1}</span>
                    <span className="font-mono text-sm text-slate-900">
                      {formatBookmarkTime(bookmark.timeSec)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteBookmark(bookmark.id)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:border-slate-400"
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
              まだブックマークはありません。
            </div>
          )}
        </aside>
      </section>

      {sourceMode === "youtube-search" && (
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

function parseFileNameFromContentDisposition(header: string | null) {
  if (!header) return null;

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const simpleMatch = header.match(/filename="([^"]+)"/i);
  return simpleMatch?.[1] ?? null;
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
