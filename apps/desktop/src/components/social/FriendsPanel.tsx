import { useState, useEffect } from 'react';
import { onGlobalOnlineUsers } from '../../lib/socket';
import Avatar from '../common/Avatar';

export default function FriendsPanel({ friends }: { friends: { id: string; displayName: string; avatarUrl: string | null }[] }) {
  const [open, setOpen] = useState(true);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    onGlobalOnlineUsers((users) => {
      setOnlineIds(new Set(users.map(u => u.userId)));
    });
  }, []);

  const onlineFriends = friends.filter(f => onlineIds.has(f.id));
  const offlineFriends = friends.filter(f => !onlineIds.has(f.id));

  return (
    <div className="shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-9 px-3 mx-2 mt-1.5 w-[calc(100%-16px)] flex items-center justify-between rounded-lg glass-subtle hover:bg-white/[0.08] transition-colors cursor-grab active:cursor-grabbing"
      >
        <span className="flex items-center gap-1.5 flex-1">
          <span className="text-[13px] font-bold text-white/80 uppercase tracking-[0.08em]">
            My Friends
          </span>
          {onlineFriends.length > 0 && (
            <span className="text-[10px] font-bold text-ghost-green bg-ghost-green/15 px-1.5 py-0.5 rounded-full">{onlineFriends.length} online</span>
          )}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={`text-ghost-text-muted transition-transform ${open ? 'rotate-90' : ''}`}>
          <polygon points="2,0 8,5 2,10" />
        </svg>
      </button>
      {open && (
        <div className="px-2 pb-1.5 space-y-px">
          {friends.length === 0 ? null : (
            <>
              {onlineFriends.map((f) => (
                <div key={f.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-ghost-surface-hover cursor-pointer group transition-colors">
                  <div className="relative">
                    <Avatar name={f.displayName} src={f.avatarUrl} size="sm" userId={f.id} />
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#23A559] border-[2.5px] border-ghost-surface" />
                  </div>
                  <span className="text-[13px] font-medium text-ghost-text-secondary group-hover:text-white flex-1 truncate transition-colors">{f.displayName}</span>
                </div>
              ))}
              {offlineFriends.map((f) => (
                <div key={f.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-ghost-surface-hover cursor-pointer group transition-colors">
                  <div className="relative">
                    <Avatar name={f.displayName} src={f.avatarUrl} size="sm" userId={f.id} />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-ghost-text-muted/40 border-2 border-ghost-surface" />
                  </div>
                  <span className="text-[13px] font-medium text-ghost-text-muted/50 group-hover:text-ghost-text-primary flex-1 truncate transition-colors">{f.displayName}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
