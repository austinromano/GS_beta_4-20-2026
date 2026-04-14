import { useState, useRef, useEffect, memo } from 'react';
import { motion } from 'framer-motion';
import { useAudioStore } from '../../stores/audioStore';
import { api } from '../../lib/api';
import { audioBufferCache, cacheBuffer, formatDate } from '../../lib/audio';
import Waveform from './Waveform';

export default memo(function StemRow({
  name, type, onDelete, onRename, fileId, projectId, trackId, createdAt, compact, widthPercent,
}: {
  name: string; type: string;
  onDelete: () => void;
  onRename: (newName: string) => void;
  fileId?: string | null; projectId?: string; trackId: string;
  createdAt?: string | null;
  compact?: boolean;
  widthPercent?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [isPlaying, setIsPlaying] = useState(false);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const isMuted = useAudioStore((s) => s.loadedTracks.get(trackId)?.muted ?? false);
  const setTrackMuted = useAudioStore((s) => s.setTrackMuted);
  const trackPitch = useAudioStore((s) => s.loadedTracks.get(trackId)?.pitch ?? 0);
  const setTrackPitch = useAudioStore((s) => s.setTrackPitch);
  const [showPitch, setShowPitch] = useState(false);
  const pitchRef = useRef<HTMLDivElement>(null);

  const downloadUrl = fileId && projectId ? api.getDirectDownloadUrl(projectId, fileId) : null;

  const [ready, setReady] = useState(fileId ? audioBufferCache.has(fileId) : false);
  const precachedRef = useRef(false);
  useEffect(() => {
    if (!fileId || ready) return;
    const id = setInterval(() => {
      if (audioBufferCache.has(fileId)) { setReady(true); clearInterval(id); }
    }, 200);
    return () => clearInterval(id);
  }, [fileId, ready]);

  // Pre-cache stem to C++ temp dir so drag-to-DAW is instant
  useEffect(() => {
    if (!ready || !downloadUrl || precachedRef.current) return;
    precachedRef.current = true;
    const ghostUrl = `ghost://precache-stem?url=${encodeURIComponent(downloadUrl)}&fileName=${encodeURIComponent(name + '.wav')}`;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = ghostUrl;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 1000);
  }, [ready, downloadUrl, name]);

  const startTimeRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);

  const handlePlay = () => {
    if (isPlaying && sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current = null;
      setIsPlaying(false);
      useAudioStore.setState({ soloPlayingTrackId: null, soloCurrentTime: 0, soloDuration: 0 });
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }
    const buffer = fileId ? audioBufferCache.get(fileId) : null;
    if (!buffer) return;
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    startTimeRef.current = ctx.currentTime;
    source.onended = () => {
      setIsPlaying(false);
      sourceRef.current = null;
      useAudioStore.setState({ soloPlayingTrackId: null, soloCurrentTime: 0, soloDuration: 0 });
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
    source.start(0);
    sourceRef.current = source;
    setIsPlaying(true);
    useAudioStore.setState({ soloPlayingTrackId: trackId, soloDuration: buffer.duration });

    const updatePlayhead = () => {
      if (!sourceRef.current) return;
      const elapsed = ctx.currentTime - startTimeRef.current;
      useAudioStore.setState({ soloCurrentTime: elapsed });
      animFrameRef.current = requestAnimationFrame(updatePlayhead);
    };
    updatePlayhead();
  };

  const handleDownload = async () => {
    if (!downloadUrl) return;
    const fileName = name + '.wav';
    const isPlugin = !!(window as any).chrome?.webview;

    if (isPlugin) {
      // Inside JUCE WebView — use ghost:// protocol so C++ downloads to disk
      const ghostUrl = `ghost://download-stem?url=${encodeURIComponent(downloadUrl)}&fileName=${encodeURIComponent(fileName)}`;
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = ghostUrl;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 1000);
    } else {
      // Normal browser — fetch as blob and trigger download
      if (!fileId || !projectId) return;
      try {
        const arrayBuffer = await api.downloadFile(projectId, fileId);
        const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch (err) {
        console.error('Download failed:', err);
      }
    }
  };

  // Drag-to-DAW: on mousedown, fire ghost:// so C++ starts native drag
  // while the mouse button is still held down
  const handleDragGrip = (e: React.MouseEvent) => {
    if (!downloadUrl || !ready) return;
    e.preventDefault();
    e.stopPropagation();
    const ghostUrl = `ghost://drag-to-daw?url=${encodeURIComponent(downloadUrl)}&fileName=${encodeURIComponent(name + '.wav')}`;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = ghostUrl;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 1000);
  };

  const displayName = name.replace(/\.(wav|mp3|flac|aiff|ogg|m4a)$/i, '').replace(/_/g, ' ');

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.6 }}
      className="relative rounded-xl overflow-visible border border-white/[0.06] hover:border-ghost-purple/40 hover:shadow-[0_4px_20px_rgba(139,92,246,0.15)] transition-[border-color,box-shadow] duration-200"
    >
    <div
      className={`group relative flex items-center rounded-xl overflow-hidden ${compact ? 'h-[48px]' : 'h-[95px]'}`}
      style={widthPercent !== undefined && widthPercent < 100 ? { width: `${widthPercent}%` } : undefined}
    >
      <div className="flex-1 h-full overflow-hidden bg-[#0A0412] relative">
        <Waveform seed={name + type} height={compact ? 48 : 95} fileId={fileId} projectId={projectId} trackId={trackId} showPlayhead={true} />
        <div className="absolute inset-y-0 left-0 w-[35%] pointer-events-none" style={{ background: 'linear-gradient(90deg, rgba(10,4,18,0.92) 0%, rgba(10,4,18,0.5) 70%, transparent 100%)' }} />
        <div className="absolute left-3 top-2 z-10 max-w-[40%]">
          {editing ? (
            <input
              autoFocus
              className="text-[13px] font-semibold text-white bg-black/60 border border-ghost-green/50 rounded px-1.5 py-0.5 outline-none focus:border-ghost-green w-full"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => {
                if (editName.trim() && editName !== name) onRename(editName.trim());
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') { setEditName(name); setEditing(false); }
              }}
            />
          ) : (
            <p
              className="text-[13px] font-semibold text-white/90 truncate cursor-pointer hover:text-white transition-colors tracking-tight"
              onClick={() => { setEditName(name); setEditing(true); }}
              title={name}
            >
              {displayName}
            </p>
          )}
          <p className="text-[9px] text-white/35 uppercase font-medium mt-0.5 tracking-[0.1em]">{type === 'audio' ? 'stem' : type === 'fullmix' ? 'mix' : type}</p>
        </div>
        {createdAt && (
          <div className="absolute left-3 bottom-2 z-10">
            <p className="text-[11px] text-ghost-green font-medium" title={new Date(createdAt).toLocaleString()}>
              {formatDate(createdAt)}
            </p>
          </div>
        )}
        {/* Unified hover toolbar — all buttons same style */}
        <div className="absolute top-1/2 -translate-y-1/2 right-2 z-20 flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg overflow-hidden" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
          <button onClick={handlePlay} disabled={!ready} title={isPlaying ? 'Pause' : 'Play'} className={`w-8 h-8 flex items-center justify-center transition-colors ${ready ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-white/20'}`}>
            {isPlaying ? (
              <svg width="10" height="10" viewBox="0 0 12 14" fill="currentColor"><rect x="1" y="1" width="3.5" height="12" rx="1" /><rect x="7.5" y="1" width="3.5" height="12" rx="1" /></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 12" fill="currentColor"><polygon points="0,0 10,6 0,12" /></svg>
            )}
          </button>
          <button onClick={() => setTrackMuted(trackId, !isMuted)} title={isMuted ? 'Unmute' : 'Mute'} className={`w-8 h-8 flex items-center justify-center transition-colors ${isMuted ? 'text-red-400 hover:text-red-300' : 'text-white/80 hover:text-white'} hover:bg-white/10`}>
            {isMuted ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
            )}
          </button>
          <button onClick={async () => {
            if (!fileId || !projectId) return;
            try {
              await api.addTrack(projectId, { name: name + ' (copy)', type: type, fileId, fileName: name } as any);
              // Trigger refresh — find the fetchProject from parent
              window.dispatchEvent(new CustomEvent('ghost-refresh-project'));
            } catch(e) { console.error('Duplicate failed', e); }
          }} title="Duplicate" className="w-8 h-8 flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          </button>
          <button onClick={onDelete} title="Delete" className="w-8 h-8 flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
          </button>
          <button onClick={handleDownload} title="Download" className="w-8 h-8 flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          </button>
        </div>
      </div>
    </div>
    </motion.div>
  );
});
