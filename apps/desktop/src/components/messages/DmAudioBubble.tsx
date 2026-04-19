import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../lib/constants';
import { useAuthStore } from '../../stores/authStore';

interface Props {
  fileId: string;
  fileName: string;
  isOwn: boolean;
}

export default function DmAudioBubble({ fileId, fileName, isOwn }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const startedAtRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(false);
  const [waveData, setWaveData] = useState<Float32Array | null>(null);
  const token = useAuthStore.getState().token;

  useEffect(() => {
    let cancelled = false;
    const url = `${API_BASE}/dm/audio/${fileId}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((buf) => {
        const ctx = new AudioContext();
        return ctx.decodeAudioData(buf.slice(0)).then((decoded) => { ctx.close(); return decoded; });
      })
      .then((decoded) => {
        if (cancelled) return;
        bufferRef.current = decoded;
        setWaveData(decoded.getChannelData(0));
        setDuration(decoded.duration);
        setReady(true);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => {
      cancelled = true;
      if (sourceRef.current) { try { sourceRef.current.stop(); } catch {} }
      if (ctxRef.current) { try { ctxRef.current.close(); } catch {} }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [fileId]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !waveData) return;
    const draw = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      const bars = Math.floor(w / 3);
      const step = Math.max(1, Math.floor(waveData.length / bars));
      const progressBars = Math.floor(bars * progress);
      for (let i = 0; i < bars; i++) {
        let max = 0;
        for (let j = 0; j < step; j++) {
          const idx = i * step + j;
          if (idx < waveData.length) max = Math.max(max, Math.abs(waveData[idx]));
        }
        const barH = Math.max(2, max * h * 0.9);
        ctx.fillStyle = i <= progressBars
          ? (isOwn ? 'rgba(255,255,255,0.95)' : '#00FFC8')
          : (isOwn ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.3)');
        ctx.fillRect(i * 3, (h - barH) / 2, 2, barH);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [waveData, progress, isOwn]);

  const play = () => {
    if (!bufferRef.current) return;
    if (isPlaying) { stop(); return; }
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const source = ctx.createBufferSource();
    source.buffer = bufferRef.current;
    source.connect(ctx.destination);
    source.onended = () => {
      if (ctxRef.current === ctx) {
        setIsPlaying(false);
        setProgress(0);
      }
    };
    source.start(0);
    sourceRef.current = source;
    startedAtRef.current = ctx.currentTime;
    setIsPlaying(true);
    const tick = () => {
      if (!ctxRef.current || ctxRef.current !== ctx) return;
      const elapsed = ctx.currentTime - startedAtRef.current;
      const p = Math.min(1, elapsed / (bufferRef.current?.duration || 1));
      setProgress(p);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (sourceRef.current) { try { sourceRef.current.stop(); } catch {} sourceRef.current = null; }
    if (ctxRef.current) { try { ctxRef.current.close(); } catch {} ctxRef.current = null; }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
    setProgress(0);
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, '0')}`;
  };

  if (error) {
    return <div className="text-[12px] text-red-300/70 italic">Couldn't load audio</div>;
  }

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-[18px] ${isOwn ? 'rounded-br-md' : 'rounded-bl-md'} w-[240px]`}
      style={{ background: isOwn ? '#7C3AED' : 'rgba(255,255,255,0.08)' }}
    >
      <button
        onClick={play}
        disabled={!ready}
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-40"
        style={{
          background: isOwn ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
          color: 'white',
        }}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div ref={containerRef} className="h-7 relative">
          <canvas ref={canvasRef} className="absolute inset-0" />
        </div>
        <div className={`text-[10px] mt-0.5 truncate ${isOwn ? 'text-white/70' : 'text-white/50'}`}>
          {fileName} {ready && `· ${fmt(duration * (isPlaying ? progress : 1) || duration)}`}
        </div>
      </div>
    </div>
  );
}
