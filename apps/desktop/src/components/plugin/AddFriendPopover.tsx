import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Avatar from '../common/Avatar';
import { api } from '../../lib/api';
import { devWarn } from '../../lib/log';

interface Friend {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email?: string;
}

interface Props {
  friends: Friend[];
  onFriendsUpdated: (next: Friend[]) => void;
}

export default function AddFriendPopover({ friends, onFriendsUpdated }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Friend[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const q = query.toLowerCase();
    const localMatches = friends.filter((f) => f.displayName.toLowerCase().includes(q) || f.email?.toLowerCase().includes(q));
    if (localMatches.length > 0) { setResults(localMatches); return; }
    const timer = setTimeout(() => {
      api.listUsers()
        .then((users) => setResults(users.filter((u) => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))))
        .catch((err) => devWarn('AddFriendPopover.listUsers', err));
    }, 600);
    return () => clearTimeout(timer);
  }, [query, friends]);

  const handleAdd = async (userId: string) => {
    try {
      await api.addFriend(userId);
      const updated = await api.listFriends();
      onFriendsUpdated(updated);
    } catch (err) {
      devWarn('AddFriendPopover.addFriend', err);
    }
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative">
      <motion.button
        onClick={() => { setOpen(!open); setQuery(''); setResults([]); }}
        className="w-11 h-11 rounded-2xl text-white flex items-center justify-center transition-all shadow-[0_2px_8px_rgba(0,0,0,0.3)] hover:rounded-xl hover:shadow-[0_0_16px_rgba(0,255,200,0.3)]"
        style={{ background: '#1a1a2e', border: '2px dashed rgba(255,255,255,0.15)' }}
        whileHover={{ scale: 1.05, borderColor: 'rgba(0,255,200,0.4)' }}
        whileTap={{ scale: 0.95 }}
        title="Add Friend"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </motion.button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-14 bottom-0 z-50 w-64 rounded-xl shadow-xl border border-white/10" style={{ background: '#141422' }}>
            <div className="p-3">
              <input
                ref={inputRef}
                type="text"
                placeholder="Search users..."
                className="w-full px-3 py-2 rounded-lg text-[13px] text-white bg-white/[0.06] border border-white/10 outline-none focus:border-purple-500/50 placeholder-white/30"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {results.length > 0 && (
              <div className="px-2 pb-2 max-h-48 overflow-y-auto">
                {results.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleAdd(u.id)}
                    className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-[13px] text-white/80 hover:bg-white/[0.06] transition-colors"
                  >
                    <Avatar name={u.displayName || u.email || '?'} src={u.avatarUrl} size="sm" userId={u.id} />
                    <span className="truncate">{u.displayName || u.email}</span>
                  </button>
                ))}
              </div>
            )}
            {query.trim() && results.length === 0 && (
              <div className="px-3 pb-3 text-[12px] text-white/30">No users found</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
