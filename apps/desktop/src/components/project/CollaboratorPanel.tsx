import Avatar from '../common/Avatar';

export default function CollaboratorPanel({ members, onInvite, isOwner, onRemove }: {
  members: { userId: string; displayName: string; role: string; avatarUrl?: string | null }[];
  onInvite: () => void;
  isOwner: boolean;
  onRemove: (userId: string, name: string) => void;
}) {
  return (
    <div className="mt-1">
      <div className="px-3 py-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-ghost-text-secondary uppercase tracking-wide">
          Collaborators
        </span>
        <button
          onClick={onInvite}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-ghost-text-muted hover:text-ghost-text-primary transition-colors"
        >
          + Invite
        </button>
      </div>
      <div className="px-2 space-y-0.5">
        {[...members].sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0)).map((m) => (
          <div key={m.userId} className="group flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-ghost-surface-hover/50 cursor-pointer">
            <div className="relative">
              <Avatar name={m.displayName} src={m.avatarUrl} size="sm" colour={m.role === 'owner' ? '#F0B232' : '#23A559'} userId={m.userId} />
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-ghost-sidebar" style={{ background: '#23A559' }} />
            </div>
            <span className="text-[14px] text-ghost-text-muted flex-1 truncate hover:text-ghost-text-secondary">{m.displayName}</span>
            {m.role === 'owner' ? (
              <span className="text-[10px] font-semibold text-ghost-host-gold bg-ghost-host-gold/15 px-1.5 py-0.5 rounded">HOST</span>
            ) : isOwner ? (
              <button
                onClick={() => onRemove(m.userId, m.displayName)}
                className="opacity-0 group-hover:opacity-100 text-ghost-text-muted hover:text-ghost-error-red transition-all"
                title={`Remove ${m.displayName}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
