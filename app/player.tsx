"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type SyncMode = "delayNode" | "seekSync"; 
// delayNode: +方向に強い / seekSync: -方向も含めて同期で吸収

export default function Player() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  // オフセット（秒）：+なら音声を遅らせる、-なら音声を早める
  const [offsetSec, setOffsetSec] = useState(0);

  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [syncMode, setSyncMode] = useState<SyncMode>("seekSync");
  const [debugText, setDebugText] = useState("");

  // WebAudio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  // 同期ループ
  const rafRef = useRef<number | null>(null);
  const lastDebugAtRef = useRef(0);

  const urlForCleanup = useRef<string | null>(null);

  // ファイル選択
  const onPickFile = (file: File | null) => {
    if (!file) return;

    // 以前のURL解放
    if (urlForCleanup.current) URL.revokeObjectURL(urlForCleanup.current);

    const url = URL.createObjectURL(file);
    urlForCleanup.current = url;
    setSrcUrl(url);
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

    // Safari等で必要：ユーザー操作後にresume
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (!mediaSourceRef.current) {
      // crossOrigin が必要な場合あり（ObjectURLなら通常OK）
      // audioEl.crossOrigin = "anonymous";
      mediaSourceRef.current = ctx.createMediaElementSource(audioEl);

      delayNodeRef.current = ctx.createDelay(5.0); // 最大5秒遅延可能
      gainRef.current = ctx.createGain();
      gainRef.current.gain.value = 1.0;

      // 経路：audioEl -> delay -> gain -> destination
      mediaSourceRef.current.connect(delayNodeRef.current);
      delayNodeRef.current.connect(gainRef.current);
      gainRef.current.connect(ctx.destination);
    }
  };

  // 再生/停止
  const play = async () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a || !srcUrl) return;

    await ensureAudioGraph();

    // 映像は無音で
    v.muted = true;

    // 再生速度合わせる
    v.playbackRate = playbackRate;
    a.playbackRate = playbackRate;

    // 最初に時刻合わせ
    // 目標：audioTime = videoTime - offsetSec
    // offsetSec=+0.2 → 音声は遅れる → audioTime = videoTime - 0.2
    // offsetSec=-0.2 → 音声は早い → audioTime = videoTime + 0.2
    const baseOffset = syncMode === "delayNode" && offsetSec > 0 ? 0 : offsetSec;
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

  // 動画側の controls から再生された場合の同期開始
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

  // オフセット反映
  useEffect(() => {
    const delayNode = delayNodeRef.current;
    if (!delayNode) return;

    // delayNode は「遅らせる」専用。+ならここで処理。
    // -の場合は delayNode では表現できないので同期ループで吸収。
    const delay = syncMode === "delayNode" && offsetSec > 0 ? offsetSec : 0;
    delayNode.delayTime.setTargetAtTime(delay, audioCtxRef.current?.currentTime ?? 0, 0.01);
  }, [offsetSec, syncMode]);

  // seekSync: スライダー操作直後に一度シークして反映
  useEffect(() => {
    if (syncMode !== "seekSync") return;
    if (!playing) return;
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    const baseOffset = syncMode === "delayNode" && offsetSec > 0 ? 0 : offsetSec;
    safeSetCurrentTime(a, clamp(v.currentTime - baseOffset, 0, a.duration || Infinity));
  }, [offsetSec, syncMode, playing]);

  // 速度反映
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    v.playbackRate = playbackRate;
    a.playbackRate = playbackRate;
  }, [playbackRate]);

  // 同期ループ（重要）
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
      // 目標：audioTime = videoTime - offsetSec
      // ただし offsetSec>0 の遅延は DelayNode が担当してるので、seekSyncは主に(-)や微調整担当
      const videoTime = v.currentTime;
      const baseOffset = syncMode === "delayNode" && offsetSec > 0 ? 0 : offsetSec;
      const expectedAudio = videoTime - baseOffset;

      // audio要素の「内部時刻」はDelayNodeで遅延しても currentTime には反映されない。
      // なので、「+方向はDelayNodeに任せる」場合、expectedAudioはそのまま使うとズレる。
      // ここでは syncMode=seekSync のときだけ強めに追従させる（-方向対応の主目的）
      if (syncMode === "seekSync") {
        const diff = (a.currentTime - expectedAudio);

        // 大きくズレたらジャンプ補正
        if (Math.abs(diff) > 0.15) {
          safeSetCurrentTime(a, clamp(expectedAudio, 0, a.duration || Infinity));
        } else {
          // 小さいズレは playbackRate を微調整して吸収（耳障りになりにくい）
          // diff>0: 音声が進んでる→少し遅くする
          // diff<0: 音声が遅れてる→少し速くする
          const k = 0.25; // 追従の強さ
          const rate = clamp(1.0 - diff * k, 0.95, 1.05) * playbackRate;
          a.playbackRate = rate;
        }
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
  }, [playing, offsetSec, syncMode, playbackRate]);

  // シーク時：音声も追従
  const onVideoSeeked = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    const baseOffset = syncMode === "delayNode" && offsetSec > 0 ? 0 : offsetSec;
    safeSetCurrentTime(a, clamp(v.currentTime - baseOffset, 0, a.duration || Infinity));
  };

  // src URL が変わったらリセット
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

  // アンマウント時の後処理
  useEffect(() => {
    return () => {
      if (urlForCleanup.current) URL.revokeObjectURL(urlForCleanup.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      // AudioContext閉じる（任意）
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <input
        type="file"
        accept="video/mp4"
        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
      />

      <div style={{ display: "grid", gap: 8 }}>
        <video
          ref={videoRef}
          controls
          style={{ width: "100%", background: "#000" }}
          onSeeked={onVideoSeeked}
          onPlay={startFromVideo}
          onPause={pause}
          onEnded={pause}
        />
        {/* 音声はUI上見せなくても良いが、デバッグ用に controls 付けてもOK */}
        <audio ref={audioRef} style={{ width: "100%" }} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {!playing ? (
          <button onClick={play} disabled={!srcUrl}>再生</button>
        ) : (
          <button onClick={pause}>停止</button>
        )}

        <span>速度:</span>
        <span>Playback: {playbackRate.toFixed(2)}x</span>
        <input
          type="range"
          min={0.1}
          max={2.0}
          step={0.05}
          value={playbackRate}
          onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
          disabled={!srcUrl}
        />

        <span style={{ marginLeft: 12 }}>同期方式:</span>
        <select value={syncMode} onChange={(e) => setSyncMode(e.target.value as SyncMode)}>
          <option value="seekSync">seek同期（-も対応）</option>
          <option value="delayNode">DelayNode中心（+向き）</option>
        </select>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label>
          音声オフセット: {offsetSec.toFixed(3)} 秒（+で遅延 / -で前進）
        </label>
        <input
          type="range"
          min={-1.0}
          max={1.0}
          step={0.005}
          value={offsetSec}
          onChange={(e) => setOffsetSec(parseFloat(e.target.value))}
          disabled={!srcUrl}
        />
        <pre style={{ margin: 0, fontSize: 12, color: "#444" }}>{debugText}</pre>
      </div>

      <p style={{ color: "#666", marginTop: 8 }}>
        音声が早いなら+方向、音声が遅いなら-方向にオフセットを調整してください。<br />
        動画が早いなら-方向、動画が遅いなら+方向にオフセットを調整してください。<br />
        注: ブラウザでは「音声の前進（負の遅延）」は本質的に難しいため、seek同期で追従しています。
        高精度にやる場合は mp4 から音声を抽出して AudioBuffer/Worklet で再生する方式に進化させます。
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
    // 端末やタイミングによっては例外になることがあるので握りつぶす
  }
}
