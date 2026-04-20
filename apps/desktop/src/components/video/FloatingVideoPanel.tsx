import { useRef, useState, useEffect } from 'react';
import { motion, useDragControls } from 'framer-motion';
import VideoGrid from './VideoGrid';

interface WebRtcHandles {
  remoteStreams: Map<string, MediaStream>;
  remoteScreenStreams: Map<string, MediaStream>;
  publishStream: (stream: MediaStream, userIds: string[]) => Promise<void>;
  replaceStream: (stream: MediaStream) => void;
  stopStream: () => void;
  publishScreen: (stream: MediaStream, userIds: string[]) => Promise<void>;
  stopScreen: () => void;
}

interface Props {
  members: any[];
  userId?: string;
  onClose: () => void;
  webrtc: WebRtcHandles;
}

const STORAGE_KEY = 'ghost_video_panel_pos';

interface Pos { x: number; y: number; minimized: boolean }

function readPos(): Pos {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        x: typeof parsed.x === 'number' ? parsed.x : 0,
        y: typeof parsed.y === 'number' ? parsed.y : 0,
        minimized: !!parsed.minimized,
      };
    }
  } catch {}
  return { x: 0, y: 0, minimized: false };
}

export default function FloatingVideoPanel({ members, userId, onClose, webrtc }: Props) {
  const [pos, setPos] = useState<Pos>(() => readPos());
  const dragControls = useDragControls();
  const containerRef = useRef<HTMLDivElement>(null);

  const persist = (next: Pos) => {
    setPos(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  };

  // Re-clamp position on window resize so the panel never sits off-screen.
  useEffect(() => {
    const onResize = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 8;
      const maxX = 0; // right-anchored — x is delta from initial right edge (0 = as-is)
      const minX = -(window.innerWidth - rect.width - margin * 2);
      const maxY = window.innerHeight - rect.height - margin;
      const clamped: Pos = {
        x: Math.min(Math.max(pos.x, minX), maxX),
        y: Math.min(Math.max(pos.y, 0), maxY),
        minimized: pos.minimized,
      };
      if (clamped.x !== pos.x || clamped.y !== pos.y) persist(clamped);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos.x, pos.y, pos.minimized]);

  return (
    <motion.div
      ref={containerRef}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      animate={{ x: pos.x, y: pos.y }}
      transition={{ type: 'spring', stiffness: 420, damping: 38 }}
      onDragEnd={(_, info) => persist({ ...pos, x: pos.x + info.offset.x, y: pos.y + info.offset.y })}
      className="fixed z-[60] rounded-2xl overflow-hidden"
      style={{
        top: 72,
        right: 20,
        background: 'rgba(20,10,35,0.95)',
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 10px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset',
      }}
    >
      {/* Drag handle / header */}
      <div
        onPointerDown={(e) => dragControls.start(e)}
        className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing select-none"
        style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-1.5">
          <motion.div
            className="w-1.5 h-1.5 rounded-full bg-red-500"
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="text-[10px] font-bold tracking-[0.12em] text-white/60 uppercase">Live</span>
          <span className="text-[10px] text-white/25 ml-1">· drag me</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => persist({ ...pos, minimized: !pos.minimized })}
            className="w-6 h-6 flex items-center justify-center rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            title={pos.minimized ? 'Expand' : 'Minimize'}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              {pos.minimized ? <polyline points="6 9 12 15 18 9" /> : <line x1="5" y1="12" x2="19" y2="12" />}
            </svg>
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-white/40 hover:text-red-400 hover:bg-white/10 transition-colors"
            title="Close"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {!pos.minimized && (
        <div className="p-2">
          <VideoGrid members={members} userId={userId} variant="row" webrtc={webrtc} />
        </div>
      )}
    </motion.div>
  );
}
