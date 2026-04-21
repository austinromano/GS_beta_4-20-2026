import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBookingsStore } from '../../stores/bookingsStore';
import Avatar from '../common/Avatar';

const AUTO_DISMISS_MS = 15_000;

function fmtWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today · ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${time}`;
}

/**
 * Xbox-style invite toast. Mounted once at the app root; renders the head of
 * the bookings-store invite queue over every view with a high z-index.
 * Auto-dismisses after 15s if untouched (paused while hovered). Accepting
 * takes the user into the auto-created shared project.
 */
export default function BookingInviteToast() {
  const invite = useBookingsStore((s) => s.inviteQueue[0] ?? null);
  const accept = useBookingsStore((s) => s.accept);
  const decline = useBookingsStore((s) => s.decline);
  const dismiss = useBookingsStore((s) => s.dismissInvite);
  const [hovered, setHovered] = useState(false);
  const [busy, setBusy] = useState(false);

  // Auto-dismiss timer. Resets whenever the current invite changes or the
  // user moves their mouse off the toast (so hovering "pins" it).
  useEffect(() => {
    if (!invite || hovered) return;
    const t = setTimeout(() => dismiss(invite.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [invite?.id, hovered, dismiss]);

  const handleAccept = async () => {
    if (!invite || busy) return;
    setBusy(true);
    try {
      await accept(invite.id);
      // Route the user into the auto-created project. fetchProjects ran
      // inside accept(), so the project is already in the sidebar.
      const updated = useBookingsStore.getState().bookings.find((b) => b.id === invite.id);
      const projectId = updated?.projectId;
      if (projectId) {
        window.dispatchEvent(new CustomEvent('ghost-open-project', { detail: { projectId } }));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (!invite || busy) return;
    setBusy(true);
    try { await decline(invite.id); } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed top-4 right-4 z-[100] pointer-events-none"
      style={{ width: 320 }}
    >
      <AnimatePresence>
        {invite && (
          <motion.div
            key={invite.id}
            initial={{ opacity: 0, x: 80, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 80, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28, mass: 0.7 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="pointer-events-auto rounded-xl overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(30, 15, 60, 0.92) 0%, rgba(15, 5, 30, 0.96) 100%)',
              border: '1px solid rgba(168, 85, 247, 0.35)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(168,85,247,0.18), 0 0 24px rgba(124,58,237,0.25)',
              backdropFilter: 'blur(8px)',
            }}
          >
            {/* Header strip with avatar + inviter name */}
            <div className="flex items-center gap-3 px-4 pt-3.5 pb-2.5">
              <Avatar name={invite.creator?.displayName || 'Friend'} src={invite.creator?.avatarUrl || null} size="sm" userId={invite.creator?.id || null} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-ghost-green font-bold">Session invite</p>
                <p className="text-[13px] font-bold text-white truncate leading-tight">
                  {invite.creator?.displayName || 'Someone'}
                </p>
              </div>
              <button
                onClick={() => dismiss(invite.id)}
                title="Dismiss"
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-4 pb-3">
              <p className="text-[13px] text-white/90 font-medium leading-snug mb-1 truncate">
                {invite.title || 'Untitled session'}
              </p>
              <p className="text-[11px] text-white/50">
                {fmtWhen(invite.scheduledAt)} · {invite.durationMin}m
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 px-4 pb-3.5">
              <button
                onClick={handleAccept}
                disabled={busy}
                className="flex-1 h-9 rounded-lg text-[13px] font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:brightness-110 active:scale-[0.97]"
                style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #4C1D95 100%)', boxShadow: '0 2px 8px rgba(124,58,237,0.4)' }}
              >
                {busy ? '…' : 'Accept'}
              </button>
              <button
                onClick={handleDecline}
                disabled={busy}
                className="flex-1 h-9 rounded-lg text-[13px] font-bold text-white/70 bg-white/[0.05] hover:bg-white/[0.1] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Decline
              </button>
            </div>

            {/* Auto-dismiss countdown bar (paused on hover) */}
            {!hovered && (
              <motion.div
                key={`${invite.id}-bar`}
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: AUTO_DISMISS_MS / 1000, ease: 'linear' }}
                className="h-[2px] origin-left"
                style={{ background: 'linear-gradient(90deg, #7C3AED, #EC4899)' }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
