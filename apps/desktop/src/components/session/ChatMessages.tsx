import { useEffect, useRef } from 'react';
import type { ChatMessage, PresenceInfo } from '@ghost/types';
import Avatar from '../common/Avatar';

interface Props {
  messages: ChatMessage[];
  onlineUsers: PresenceInfo[];
  currentUserId: string | undefined;
  onDelete: (index: number) => void;
}

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export default function ChatMessages({ messages, onlineUsers, currentUserId, onDelete }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-2">
        <div className="flex flex-col items-center justify-center py-5 gap-2 text-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ghost-text-muted/30">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p className="text-[15px] text-ghost-text-secondary font-semibold text-center">Start the conversation</p>
          <p className="text-[14px] text-ghost-text-muted text-center">Send a message to<br />your collaborators</p>
        </div>
        <div ref={bottomRef} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-2 pb-2">
      {messages.map((msg, origIndex) => {
        const isOwn = msg.userId === currentUserId;
        const sender = onlineUsers.find((u) => u.userId === msg.userId);
        const avatarUrl = msg.avatarUrl ?? sender?.avatarUrl ?? null;
        const isGif = msg.text.startsWith('[gif]') && msg.text.endsWith('[/gif]');
        const prev = origIndex > 0 ? messages[origIndex - 1] : null;
        const sameAsPrev = !!prev && prev.userId === msg.userId && msg.timestamp - prev.timestamp < 5 * 60 * 1000;

        return (
          <div key={origIndex} className={`group relative flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'} ${sameAsPrev ? 'mt-0.5' : 'mt-3'}`}>
            {!isOwn && (
              <div className={`shrink-0 w-8 ${sameAsPrev ? 'invisible' : ''}`}>
                <Avatar name={msg.displayName} src={avatarUrl} size="sm" userId={msg.userId} />
              </div>
            )}
            <div className={`flex flex-col max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
              {isGif ? (
                <img src={msg.text.slice(5, -6)} alt="GIF" className="rounded-2xl max-w-[200px] max-h-[150px]" loading="lazy" />
              ) : (
                <div
                  className={`px-3 py-2 text-[13px] leading-[1.35] break-words ${
                    isOwn
                      ? 'text-white rounded-[18px] rounded-br-md'
                      : 'text-ghost-text-primary rounded-[18px] rounded-bl-md'
                  }`}
                  style={{ background: isOwn ? '#7C3AED' : 'rgba(255,255,255,0.08)' }}
                >
                  {msg.text}
                </div>
              )}
              {!sameAsPrev && (
                <span className="text-[10px] text-white/30 mt-1 px-2">{formatTime(msg.timestamp)}</span>
              )}
            </div>
            {isOwn && (
              <button
                onClick={() => onDelete(origIndex)}
                className="absolute top-0 right-1 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-ghost-text-muted hover:text-ghost-error-red hover:bg-ghost-error-red/10 transition-all"
                title="Delete message"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
