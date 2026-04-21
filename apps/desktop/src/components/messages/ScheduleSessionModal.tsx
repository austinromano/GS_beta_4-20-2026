import { useState, useMemo } from 'react';
import { useBookingsStore } from '../../stores/bookingsStore';

interface Props {
  friend: { id: string; displayName: string };
  initialDate?: Date | null;
  onClose: () => void;
  onCreated?: () => void;
}

const DURATIONS = [30, 60, 90, 120];

function pad2(n: number) { return n.toString().padStart(2, '0'); }

function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export default function ScheduleSessionModal({ friend, initialDate, onClose, onCreated }: Props) {
  const create = useBookingsStore((s) => s.create);
  const seed = useMemo(() => initialDate ?? new Date(), [initialDate]);
  const [dateStr, setDateStr] = useState(toDateInputValue(seed));
  // Default time: next top-of-the-hour, clamped to future.
  const [timeStr, setTimeStr] = useState(() => {
    const d = new Date(seed);
    const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1, 0, 0);
    return `${pad2(nextHour.getHours())}:${pad2(nextHour.getMinutes())}`;
  });
  const [durationMin, setDurationMin] = useState(60);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const scheduledAt = useMemo(() => {
    const [hh, mm] = timeStr.split(':').map(Number);
    const [y, mo, d] = dateStr.split('-').map(Number);
    if (!y || !mo || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return new Date(y, mo - 1, d, hh, mm, 0);
  }, [dateStr, timeStr]);

  const handleSubmit = async () => {
    if (!scheduledAt) { setError('Pick a valid date and time'); return; }
    if (scheduledAt.getTime() < Date.now() - 60_000) { setError('That time is in the past'); return; }
    setSubmitting(true);
    setError('');
    try {
      await create({
        inviteeId: friend.id,
        title: title.trim(),
        scheduledAt: scheduledAt.toISOString(),
        durationMin,
      });
      onCreated?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not create booking');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(10,4,18,0.72)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl glass glass-glow p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <h3 className="text-[16px] font-bold text-white tracking-tight">Book a session</h3>
            <p className="text-[12px] text-white/50 truncate">With {friend.displayName}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <label className="block text-[11px] font-semibold text-white/50 uppercase tracking-wider mb-1">Title (optional)</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Work on the chorus"
          maxLength={120}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-white/30 mb-4 outline-none focus:border-ghost-purple/60 transition-colors"
        />

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-[11px] font-semibold text-white/50 uppercase tracking-wider mb-1">Date</label>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white outline-none focus:border-ghost-purple/60 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-white/50 uppercase tracking-wider mb-1">Time</label>
            <input
              type="time"
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white outline-none focus:border-ghost-purple/60 transition-colors"
            />
          </div>
        </div>

        <label className="block text-[11px] font-semibold text-white/50 uppercase tracking-wider mb-1.5">Duration</label>
        <div className="flex gap-1.5 mb-5">
          {DURATIONS.map((m) => (
            <button
              key={m}
              onClick={() => setDurationMin(m)}
              className={`flex-1 h-9 rounded-lg text-[12px] font-semibold transition-colors ${
                durationMin === m
                  ? 'text-white'
                  : 'text-white/50 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08]'
              }`}
              style={durationMin === m
                ? { background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)', boxShadow: '0 2px 8px rgba(124,58,237,0.4)' }
                : undefined}
            >
              {m < 60 ? `${m}m` : `${m / 60}h`}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg text-[12px] text-red-300" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 h-9 rounded-lg text-[13px] font-semibold text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 h-9 rounded-lg text-[13px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #4C1D95 100%)' }}
          >
            {submitting ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  );
}
