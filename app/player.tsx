"use client";

import React, { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { exportVideoWithOffset } from "./lib/ffmpeg-export";

// 同期方式は seekSync のみ使用


export default function Player() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [playing, setPlaying] = useState(false);

  // 音声オフセット（+で遅延 / -で前進）
  const [offsetSec, setOffsetSec] = useState(0);

  const [playbackRate, setPlaybackRate] = useState(1.0);
  const debugRef = useRef<HTMLPreElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [trimStartSec, setTrimStartSec] = useState<number | null>(null);
  const [trimEndSec, setTrimEndSec] = useState<number | null>(null);
  const exportStartedAtRef = useRef(0);
  const exportProgressRef = useRef(0);

  // WebAudio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  // 同期ループ
  const rafRef = useRef<number | null>(null);
  const lastDebugAtRef = useRef(0);
  const lastSyncCheckAtRef = useRef(0);
  const offsetDraggingRef = useRef(false);

  // safeSetCurrentTime の “古いリトライ上書き” 防止トークン
  const seekTokenRef = useRef(0);

  const urlForCleanup = useRef<string | null>(null);

  // ファイル選択
  const onPickFile = (file: File | null) => {
    if (!file) return;

    // 既存の objectURL を破棄
    if (urlForCleanup.current) URL.revokeObjectURL(urlForCleanup.current);

    const url = URL.createObjectURL(file);
    urlForCleanup.current = url;
    setSrcUrl(url);
    setSourceFile(file);
    setPlaying(false);

    // 任意：表示リセット
    setExportError(null);
    setExportProgress(0);
    if (debugRef.current) debugRef.current.textContent = "";
  };

  // AudioContext 初期化
  const ensureAudioGraph = async () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;

    // Safari などで AudioContext が止まっている場合は resume
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (!mediaSourceRef.current) {
      // objectURL なので crossOrigin は不要
      mediaSourceRef.current = ctx.createMediaElementSource(audioEl);

      gainRef.current = ctx.createGain();
      gainRef.current.gain.value = 1.0;

      // audioEl -> gain -> destination
      mediaSourceRef.current.connect(gainRef.current);
      gainRef.current.connect(ctx.destination);
    }
  };

  const onVideoPause = () => {
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
    if (!ffmpegReady) {
      setExportError("FFmpeg の読み込み中です。少し待って再度お試しください。");
      return;
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
      const fileName = `${originalName}${rateTag}${offsetTag}.mp4`;

      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "export failed");
      // eslint-disable-next-line no-console
      console.error("export failed:", err);
      setExportError(message);
    } finally {
      setExporting(false);
    }
  };

  // 動画の controls から再生された場合の同期開始
  const startFromVideo = async () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a || !srcUrl) return;
    if (!a.paused) return;

    await ensureAudioGraph();

    v.muted = true;
    a.muted = false;

    v.playbackRate = playbackRate;
    a.playbackRate = playbackRate;

    // まず合わせる
    safeSetCurrentTime(
      a,
      clamp(v.currentTime - offsetSec, 0, a.duration || Infinity),
      seekTokenRef
    );

    // video → audio の順で開始（安定しやすい）
    await v.play();
    await a.play();

    // 次フレームでもう一回合わせる（初期ズレ潰し）
    requestAnimationFrame(() => {
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
  };

  // seekSync: offset変更が確定したら1回だけシーク（ドラッグ中はしない）
  useEffect(() => {
    if (!playing) return;
    if (offsetDraggingRef.current) return;

    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    safeSetCurrentTime(
      a,
      clamp(v.currentTime - offsetSec, 0, a.duration || Infinity),
      seekTokenRef
    );
  }, [offsetSec, playing]);

  // 再生速度反映
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    v.playbackRate = playbackRate;
    a.playbackRate = playbackRate;
  }, [playbackRate]);

  // 同期ループ（ドラッグ中は補正しない / 100ms判定でジャンプ補正のみ）
  useEffect(() => {
    if (!playing) {
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

        if (now - lastDebugAtRef.current > 250) {
          lastDebugAtRef.current = now;
          const expectedAudio = v.currentTime - offsetSec;
          const diff = a.currentTime - expectedAudio;
          if (debugRef.current) {
            debugRef.current.textContent =
              `v=${v.currentTime.toFixed(3)} a=${a.currentTime.toFixed(3)} exp=${expectedAudio.toFixed(3)} diff=${diff.toFixed(3)} (dragging)`;
          }
        }

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

      // デバッグ表示（DOM直接）
      if (now - lastDebugAtRef.current > 250) {
        lastDebugAtRef.current = now;
        if (debugRef.current) {
          debugRef.current.textContent =
            `v=${v.currentTime.toFixed(3)} a=${a.currentTime.toFixed(3)} exp=${expectedAudio.toFixed(3)} diff=${diff.toFixed(3)}`;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, offsetSec, playbackRate]);

  // シーク時の追従（ドラッグ中は無視）
  const onVideoSeeked = () => {
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
    if (!playing) return;

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

    if (srcUrl) {
      v.src = srcUrl;
      a.src = srcUrl;
      v.currentTime = 0;
      a.currentTime = 0;
    }
  }, [srcUrl]);

  // アンマウント時の後始末
  useEffect(() => {
    return () => {
      if (urlForCleanup.current) URL.revokeObjectURL(urlForCleanup.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      audioCtxRef.current?.close().catch(() => { });
    };
  }, []);

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <Script
        src="/ffmpeg/ffmpeg.js"
        strategy="afterInteractive"
        onLoad={() => setFfmpegReady(true)}
      />

      <div className="flex flex-row gap-3 items-center">
        <label className="cursor-pointer">
          <input
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
        <span className="text-slate-800">
          {sourceFile ? sourceFile.name : "未選択"}
        </span>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <video
          muted
          ref={videoRef}
          controls
          style={{ width: "100%", background: "#000" }}
          onSeeked={onVideoSeeked}
          onPlay={startFromVideo}
          onPause={onVideoPause}
          onEnded={onVideoPause}
        />
        {/* 音声は UI を出さずに使う */}
        <audio ref={audioRef} style={{ width: "100%" }} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            v.currentTime = clamp(v.currentTime - 10, 0, v.duration || Infinity);
          }}
          disabled={!srcUrl}
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
          disabled={!srcUrl}
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
          disabled={!srcUrl}
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
          disabled={!srcUrl}
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
            onClick={() => setPlaybackRate((r) => clamp(r - 0.05, 0.1, 2.0))}
            disabled={!srcUrl}
            className="text-2xl"
          >
            -
          </button>
          <input
            type="range"
            min={0.1}
            max={2.0}
            step={0.05}
            value={playbackRate}
            onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
            disabled={!srcUrl}
            style={{ flex: 1, minWidth: 260, height: 28 }}
          />
          <button
            type="button"
            onClick={() => setPlaybackRate((r) => clamp(r + 0.05, 0.1, 2.0))}
            disabled={!srcUrl}
            className="text-2xl"
          >
            +
          </button>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>音声オフセット: {offsetSec.toFixed(3)} 秒</span>
            <button
              type="button"
              onClick={() => setOffsetSec((v) => clamp(v - 0.005, -1.0, 1.0))}
              disabled={!srcUrl}
              className="text-2xl"
            >
              -
            </button>
            <input
              type="range"
              min={-1.0}
              max={1.0}
              step={0.005}
              value={offsetSec}
              onPointerDown={() => (offsetDraggingRef.current = true)}
              onPointerUp={onOffsetCommit}
              onPointerCancel={onOffsetCommit}
              onChange={(e) => setOffsetSec(parseFloat(e.target.value))}
              onMouseUp={onOffsetCommit}
              onTouchEnd={onOffsetCommit}
              disabled={!srcUrl}
              style={{ flex: 1, minWidth: 260, height: 28 }}
            />
            <button
              type="button"
              onClick={() => setOffsetSec((v) => clamp(v + 0.005, -1.0, 1.0))}
              disabled={!srcUrl}
              className="text-2xl"
            >
              +
            </button>
          </div>
          <pre ref={debugRef} style={{ margin: 0, fontSize: 12, color: "#444" }} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>選択範囲:</span>
          <span>
            {trimStartSec !== null ? trimStartSec.toFixed(3) : "--"} ~{" "}
            {trimEndSec !== null ? trimEndSec.toFixed(3) : "--"}
          </span>
          <button
            type="button"
            disabled={!srcUrl}
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
            disabled={!srcUrl}
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
            disabled={!srcUrl}
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
          <button
            onClick={onExport}
            disabled={
              !srcUrl ||
              exporting ||
              (trimStartSec !== null &&
                trimEndSec !== null &&
                trimStartSec >= trimEndSec)
            }
          >
            {exporting ? "書き出し中…" : "書き出し（速度/オフセット反映）"}
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
    </div>
  );
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
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
