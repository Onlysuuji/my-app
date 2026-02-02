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
  const [debugText, setDebugText] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [ffmpegReady, setFfmpegReady] = useState(false);

  // WebAudio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  // 同期ループ
  const rafRef = useRef<number | null>(null);
  const lastDebugAtRef = useRef(0);

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
      // audioEl.crossOrigin = "anonymous";
      mediaSourceRef.current = ctx.createMediaElementSource(audioEl);

      gainRef.current = ctx.createGain();
      gainRef.current.gain.value = 1.0;

      // audioEl -> gain -> destination
      mediaSourceRef.current.connect(gainRef.current);
      gainRef.current.connect(ctx.destination);
    }
  };

  // 再生/一時停止
  const play = async () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a || !srcUrl) return;

    await ensureAudioGraph();

    // video 側はミュート
    v.muted = true;

    // 再生速度を揃える
    v.playbackRate = playbackRate;
    a.playbackRate = playbackRate;

    // audioTime = videoTime - offsetSec
    const baseOffset = offsetSec;
    const targetAudioTime = clamp(v.currentTime - baseOffset, 0, a.duration || Infinity);
    safeSetCurrentTime(a, targetAudioTime);

    await a.play();
    await v.play();
    setPlaying(true);
  };

  const pause = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    v?.pause();
    a?.pause();
    setPlaying(false);
  };

  const onExport = async () => {
    if (!sourceFile || exporting) return;
    if (!ffmpegReady) {
      setExportError("FFmpeg の読み込み中です。少し待って再度お試しください。");
      return;
    }
    setExportError(null);
    setExportProgress(0);
    setExporting(true);
    try {
      const blob = await exportVideoWithOffset({
        file: sourceFile,
        playbackRate,
        offsetSec,
        onProgress: (p) => setExportProgress(p),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "exported.mp4";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "export failed");
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
    v.playbackRate = playbackRate;
    a.playbackRate = playbackRate;

    safeSetCurrentTime(a, clamp(v.currentTime - offsetSec, 0, a.duration || Infinity));

    await a.play();
    setPlaying(true);
  };

  // seekSync: スライダー操作直後に一度シーク
  useEffect(() => {
    if (!playing) return;
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    const baseOffset = offsetSec;
    safeSetCurrentTime(a, clamp(v.currentTime - baseOffset, 0, a.duration || Infinity));
  }, [offsetSec, playing]);

  // 再生速度反映
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    v.playbackRate = playbackRate;
    a.playbackRate = playbackRate;
  }, [playbackRate]);

  // 同期ループ
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
      // audioTime = videoTime - offsetSec
      const videoTime = v.currentTime;
      const baseOffset = offsetSec;
      const expectedAudio = videoTime - baseOffset;

      const diff = (a.currentTime - expectedAudio);

      // 大きくズレたらジャンプで再同期
        if (Math.abs(diff) > 0.15) {
          safeSetCurrentTime(a, clamp(expectedAudio, 0, a.duration || Infinity));
        } else {
        // 小さいズレは playbackRate を微調整して吸収
        const k = 0.25; // 追従の強さ
          const rate = clamp(1.0 - diff * k, 0.95, 1.05) * playbackRate;
          a.playbackRate = rate;
        }

      const now = performance.now();
      if (now - lastDebugAtRef.current > 250) {
        lastDebugAtRef.current = now;
        const diff = a.currentTime - expectedAudio;
        setDebugText(
          `v=${videoTime.toFixed(3)} a=${a.currentTime.toFixed(3)} exp=${expectedAudio.toFixed(3)} diff=${diff.toFixed(3)}`
        );
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, offsetSec, playbackRate]);

  // シーク時の追従
  const onVideoSeeked = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    const baseOffset = offsetSec;
    safeSetCurrentTime(a, clamp(v.currentTime - baseOffset, 0, a.duration || Infinity));
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
    return () => {};
  }, [srcUrl]);

  // アンマウント時の後始末
  useEffect(() => {
    return () => {
      if (urlForCleanup.current) URL.revokeObjectURL(urlForCleanup.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      // AudioContext を閉じる（任意）
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <Script src="/ffmpeg/ffmpeg.js" strategy="afterInteractive" onLoad={() => setFfmpegReady(true)} />
      <input
        type="file"
        accept="video/mp4"
        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
      />

      <div style={{ display: "grid", gap: 8 }}>
        <video muted
          ref={videoRef}
          controls
          style={{ width: "100%", background: "#000" }}
          onSeeked={onVideoSeeked}
          onPlay={startFromVideo}
          onPause={pause}
          onEnded={pause}
        />
        {/* 音声は UI を出さずに使う */}
        <audio ref={audioRef} style={{ width: "100%" }} />
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>再生速度:</span>
          <span>{playbackRate.toFixed(2)}x</span>
          <button
            type="button"
            onClick={() => setPlaybackRate((r) => clamp(r - 0.05, 0.1, 2.0))}
            disabled={!srcUrl}
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
          >
            +
          </button>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>音声オフセット: {offsetSec.toFixed(3)} 秒（+で遅延 / -で前進）</span>
          <button
            type="button"
            onClick={() => setOffsetSec((v) => clamp(v - 0.005, -1.0, 1.0))}
            disabled={!srcUrl}
          >
            -
          </button>
          <input
            type="range"
            min={-1.0}
            max={1.0}
            step={0.005}
            value={offsetSec}
            onChange={(e) => setOffsetSec(parseFloat(e.target.value))}
            disabled={!srcUrl}
            style={{ flex: 1, minWidth: 260, height: 28 }}
          />
          <button
            type="button"
            onClick={() => setOffsetSec((v) => clamp(v + 0.005, -1.0, 1.0))}
            disabled={!srcUrl}
          >
            +
          </button>
        </div>
        <pre style={{ margin: 0, fontSize: 12, color: "#444" }}>{debugText}</pre>
      </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={onExport} disabled={!srcUrl || exporting}>
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
        音声が早いなら+方向、音声が遅いなら-方向にオフセットを調整してください。<br />
        動画が早いなら-方向、動画が遅いなら+方向にオフセットを調整してください。<br />
      </p>
    </div>
  );
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function safeSetCurrentTime(el: HTMLMediaElement, t: number) {
  try {
    el.currentTime = t;
  } catch {
    // タイミング次第で currentTime 設定が失敗することがあるため握りつぶす
  }
}


