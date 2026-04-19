import { create } from 'zustand';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { devWarn } from '../lib/log';

export interface DmConversation {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  lastText: string;
  lastAt: string;
  lastFromMe: boolean;
  unread: number;
}

export interface DmMessage {
  id: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  read: boolean;
  createdAt: string;
}

interface DmState {
  conversations: DmConversation[];
  messagesByUser: Map<string, DmMessage[]>;
  activeUserId: string | null;
  loading: boolean;
  unreadTotal: number;

  bootstrap: (currentUserId: string | null) => () => void;
  loadConversations: () => Promise<void>;
  openConversation: (userId: string) => Promise<void>;
  send: (userId: string, text: string) => Promise<void>;
  markRead: (userId: string) => Promise<void>;
  setActive: (userId: string | null) => void;
}

let socketHandlerAttached = false;

export const useDmStore = create<DmState>((set, get) => ({
  conversations: [],
  messagesByUser: new Map(),
  activeUserId: null,
  loading: false,
  unreadTotal: 0,

  bootstrap: (currentUserId) => {
    get().loadConversations();
    api.getDmUnreadTotal().then((r) => set({ unreadTotal: r.count })).catch(() => {});

    const socket = getSocket();
    if (socket && !socketHandlerAttached) {
      const handler = (msg: DmMessage) => {
        const myId = currentUserId;
        const otherId = msg.fromUserId === myId ? msg.toUserId : msg.fromUserId;

        set((s) => {
          // Append to open thread if we have one cached.
          const next = new Map(s.messagesByUser);
          const existing = next.get(otherId);
          if (existing) {
            if (!existing.find((m) => m.id === msg.id)) {
              next.set(otherId, [...existing, msg]);
            }
          }
          return { messagesByUser: next };
        });

        // Refresh conversations list (cheap — one query) and unread badge.
        get().loadConversations();
        api.getDmUnreadTotal().then((r) => set({ unreadTotal: r.count })).catch(() => {});
      };
      socket.on('dm-received', handler);
      socketHandlerAttached = true;

      return () => {
        socket.off('dm-received', handler);
        socketHandlerAttached = false;
      };
    }
    return () => {};
  },

  loadConversations: async () => {
    try {
      set({ loading: true });
      const data = await api.listDmConversations();
      set({ conversations: data, loading: false });
    } catch (err) {
      devWarn('dmStore.loadConversations', err);
      set({ loading: false });
    }
  },

  openConversation: async (userId) => {
    set({ activeUserId: userId });
    try {
      const history = await api.getDmHistory(userId);
      set((s) => {
        const next = new Map(s.messagesByUser);
        next.set(userId, history);
        return { messagesByUser: next };
      });
      await get().markRead(userId);
    } catch (err) {
      devWarn('dmStore.openConversation', err);
    }
  },

  send: async (userId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const msg = await api.sendDm(userId, trimmed);
      set((s) => {
        const next = new Map(s.messagesByUser);
        const existing = next.get(userId) || [];
        if (!existing.find((m) => m.id === msg.id)) {
          next.set(userId, [...existing, msg]);
        }
        return { messagesByUser: next };
      });
      get().loadConversations();
    } catch (err) {
      devWarn('dmStore.send', err);
    }
  },

  markRead: async (userId) => {
    try {
      await api.markDmRead(userId);
      set((s) => ({
        conversations: s.conversations.map((c) => c.userId === userId ? { ...c, unread: 0 } : c),
        unreadTotal: Math.max(0, s.unreadTotal - (s.conversations.find((c) => c.userId === userId)?.unread || 0)),
      }));
    } catch (err) {
      devWarn('dmStore.markRead', err);
    }
  },

  setActive: (userId) => set({ activeUserId: userId }),
}));
