import { useState, useRef, useEffect } from 'react';
import { api } from '../../lib/api';
import Avatar from './Avatar';

export default function InviteModal({ open, onClose, projectId, onInvited }: { open: boolean; onClose: () => void; projectId: string; onInvited?: () => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [suggestions, setSuggestions] = useState<{ id: string; displayName: string; email: string; avatarUrl: string | null }[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: string; displayName: string; email: string; avatarUrl: string | null }[]>([]);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      api.listUsers().then(setAllUsers).catch((err) => { if (import.meta.env.DEV) console.warn('[InviteModal] listUsers failed:', err); });
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return; }
    const q = query.toLowerCase();
    const matches = allUsers.filter(
      (u) => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
    setSuggestions(matches.slice(0, 5));
  }, [query, allUsers]);

  if (!open) return null;

  const handleInvite = async (emailOrName: string) => {
    if (!emailOrName.trim()) return;
    try {
      const isEmail = emailOrName.includes('@');
      if (isEmail) {
        await api.inviteMember(projectId, emailOrName.trim());
      } else {
        await api.inviteMember(projectId, '', emailOrName.trim());
      }
      setStatus('Invited!');
      setQuery('');
      setSuggestions([]);
      if (onInvited) onInvited();
      setTimeout(() => { setStatus(''); onClose(); }, 1000);
    } catch (err: any) {
      setStatus(err.message || 'Invite failed');
    }
  };

  return (
    <div className="absolute right-2 top-12 w-72 bg-[#111214] rounded-lg shadow-popup animate-popup z-50 p-4 border border-white/5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] font-semibold text-ghost-text-secondary uppercase tracking-wide">Invite Collaborator</span>
        <button onClick={onClose} className="text-ghost-text-muted hover:text-ghost-text-primary text-sm">X</button>
      </div>
      <div className="relative">
        <input
          className="ghost-input w-full text-sm mb-0"
          placeholder="Search by name or email..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleInvite(query)}
          autoFocus
        />
        {suggestions.length > 0 && (
          <div ref={suggestionsRef} className="mt-1 bg-[#0a0a12] rounded-lg border border-white/5 overflow-hidden">
            {suggestions.map((u) => (
              <button
                key={u.id}
                onClick={() => handleInvite(u.email)}
                className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-ghost-surface-hover transition-colors text-left"
              >
                <div className="shrink-0">
                  <Avatar name={u.displayName || u.email} src={u.avatarUrl} size="sm" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-white truncate">{u.displayName}</p>
                  <p className="text-[12px] text-ghost-text-muted truncate">{u.email}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {suggestions.length === 0 && query.trim() && (
        <button onClick={() => handleInvite(query)} className="w-full mt-2 px-3 py-2 text-[13px] font-medium bg-ghost-purple text-white rounded hover:bg-[#4752C4] transition-colors">
          Send Invite
        </button>
      )}
      {status && <p className={`text-xs mt-2 ${status === 'Invited!' ? 'text-ghost-green' : 'text-ghost-error-red'}`}>{status}</p>}
    </div>
  );
}
