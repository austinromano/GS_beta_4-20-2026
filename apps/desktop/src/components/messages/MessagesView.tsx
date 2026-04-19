import { useEffect, useRef, useState, useMemo } from 'react';
import Avatar from '../common/Avatar';
import { useDmStore } from '../../stores/dmStore';
import { useAuthStore } from '../../stores/authStore';

interface Friend {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

interface Props {
  friends: Friend[];
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtBubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function MessagesView({ friends }: Props) {
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id;
  const {
    conversations, messagesByUser, activeUserId,
    bootstrap, openConversation, send, setActive,
  } = useDmStore();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentUserId) return;
    const cleanup = bootstrap(currentUserId);
    return cleanup;
  }, [currentUserId]);

  const activeMessages = activeUserId ? (messagesByUser.get(activeUserId) || []) : [];
  const activeFriend = useMemo(() => {
    if (!activeUserId) return null;
    const conv = conversations.find((c) => c.userId === activeUserId);
    if (conv) return { id: conv.userId, displayName: conv.displayName, avatarUrl: conv.avatarUrl };
    const f = friends.find((f) => f.id === activeUserId);
    return f ? { id: f.id, displayName: f.displayName, avatarUrl: f.avatarUrl } : null;
  }, [activeUserId, conversations, friends]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeMessages.length, activeUserId]);

  // Merge friends without an existing conversation so they still appear in the left column.
  const sidebarEntries = useMemo(() => {
    const seen = new Set(conversations.map((c) => c.userId));
    const extraFriends = friends
      .filter((f) => !seen.has(f.id) && f.id !== currentUserId)
      .map((f) => ({
        userId: f.id,
        displayName: f.displayName,
        avatarUrl: f.avatarUrl,
        lastText: '',
        lastAt: '',
        lastFromMe: false,
        unread: 0,
      }));
    return [...conversations, ...extraFriends];
  }, [conversations, friends, currentUserId]);

  const handleSend = () => {
    if (!activeUserId || !draft.trim()) return;
    send(activeUserId, draft);
    setDraft('');
  };

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden rounded-2xl glass glass-glow">
      {/* Left column: conversations + friends */}
      <div className="w-[260px] shrink-0 flex flex-col border-r border-white/[0.06] min-h-0">
        <div className="px-4 pt-4 pb-3">
          <h2 className="text-[17px] font-bold text-white tracking-tight">Messages</h2>
          <p className="text-[12px] text-white/40 mt-0.5">Direct producer chats</p>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-2">
          {sidebarEntries.length === 0 && (
            <p className="px-3 py-6 text-[13px] text-white/40 italic text-center">
              Add friends to start a conversation.
            </p>
          )}
          {sidebarEntries.map((c) => {
            const isActive = c.userId === activeUserId;
            return (
              <button
                key={c.userId}
                onClick={() => { setActive(c.userId); openConversation(c.userId); }}
                className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-left mb-0.5 ${
                  isActive ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                }`}
              >
                <div className="shrink-0 relative">
                  <Avatar name={c.displayName} src={c.avatarUrl} size="sm" />
                  {c.unread > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {c.unread > 9 ? '9+' : c.unread}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className={`text-[13px] font-semibold truncate ${isActive ? 'text-white' : 'text-white/80'}`}>
                      {c.displayName}
                    </span>
                    {c.lastAt && <span className="text-[10px] text-white/30 shrink-0">{fmtDay(c.lastAt)}</span>}
                  </div>
                  <div className="text-[12px] text-white/40 truncate mt-0.5">
                    {c.lastText ? (c.lastFromMe ? `You: ${c.lastText}` : c.lastText) : <span className="italic">Say hi</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right column: selected conversation */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {activeFriend ? (
          <>
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-3 shrink-0">
              <Avatar name={activeFriend.displayName} src={activeFriend.avatarUrl} size="sm" />
              <div className="min-w-0">
                <div className="text-[14px] font-bold text-white truncate">{activeFriend.displayName}</div>
                <div className="text-[11px] text-white/40">Direct message</div>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
              {activeMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center">
                  <div>
                    <p className="text-[14px] font-semibold text-white/70 mb-1">No messages yet</p>
                    <p className="text-[12px] text-white/40">Send the first message below.</p>
                  </div>
                </div>
              ) : activeMessages.map((msg, idx) => {
                const isOwn = msg.fromUserId === currentUserId;
                const prev = idx > 0 ? activeMessages[idx - 1] : null;
                const sameAsPrev = prev && prev.fromUserId === msg.fromUserId
                  && (Date.parse(msg.createdAt) - Date.parse(prev.createdAt)) < 5 * 60 * 1000;
                return (
                  <div key={msg.id} className={`flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'} ${sameAsPrev ? 'mt-0.5' : 'mt-3'}`}>
                    {!isOwn && (
                      <div className={`shrink-0 w-8 ${sameAsPrev ? 'invisible' : ''}`}>
                        <Avatar name={activeFriend.displayName} src={activeFriend.avatarUrl} size="sm" />
                      </div>
                    )}
                    <div className={`flex flex-col max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`px-3.5 py-2 text-[13px] leading-[1.4] break-words rounded-[18px] ${
                          isOwn ? 'text-white rounded-br-md' : 'text-ghost-text-primary rounded-bl-md'
                        }`}
                        style={{ background: isOwn ? '#7C3AED' : 'rgba(255,255,255,0.08)' }}
                      >
                        {msg.text}
                      </div>
                      {!sameAsPrev && (
                        <span className="text-[10px] text-white/30 mt-1 px-2">{fmtBubbleTime(msg.createdAt)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-4 pb-4 pt-2 shrink-0">
              <div className="flex items-center bg-white/[0.04] rounded-full border border-white/[0.08] pr-1">
                <input
                  className="flex-1 min-w-0 bg-transparent text-[14px] text-ghost-text-primary placeholder:text-ghost-text-muted pl-4 py-2.5 pr-2 outline-none"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                  placeholder={`Message ${activeFriend.displayName}...`}
                />
                <button
                  onClick={handleSend}
                  disabled={!draft.trim()}
                  className="shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #4C1D95 100%)' }}
                >
                  Send
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center px-8">
            <div className="text-center max-w-sm">
              <div className="w-16 h-16 rounded-full bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>
              <h3 className="text-[18px] font-bold text-white mb-1.5">Your messages</h3>
              <p className="text-[13px] text-white/50 leading-[1.5]">
                Pick a friend on the left to start a direct conversation — they'll show up online if they're active right now.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
