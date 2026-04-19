import { Hono } from 'hono';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/index.js';
import { directMessages, users } from '../db/schema.js';
import { eq, and, or, desc, inArray, sql } from 'drizzle-orm';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { emitDm } from '../ws/index.js';

const dmRoutes = new Hono();
dmRoutes.use('*', authMiddleware);

const sendSchema = z.object({ text: z.string().min(1).max(4000) });

// GET /dm/conversations — summary list: last message + unread count per counterpart
dmRoutes.get('/conversations', async (c) => {
  const me = c.get('user') as AuthUser;

  // Pull every message involving me (either direction), newest first.
  const rows = await db.select({
    id: directMessages.id,
    fromUserId: directMessages.fromUserId,
    toUserId: directMessages.toUserId,
    text: directMessages.text,
    read: directMessages.read,
    createdAt: directMessages.createdAt,
  })
    .from(directMessages)
    .where(or(eq(directMessages.fromUserId, me.id), eq(directMessages.toUserId, me.id)))
    .orderBy(desc(directMessages.createdAt))
    .limit(500)
    .all();

  // Group by counterpart user id.
  const byOther = new Map<string, { lastText: string; lastAt: string; unread: number; lastFromMe: boolean }>();
  for (const r of rows) {
    const other = r.fromUserId === me.id ? r.toUserId : r.fromUserId;
    const existing = byOther.get(other);
    if (!existing) {
      byOther.set(other, {
        lastText: r.text,
        lastAt: r.createdAt,
        lastFromMe: r.fromUserId === me.id,
        unread: r.toUserId === me.id && !r.read ? 1 : 0,
      });
    } else if (r.toUserId === me.id && !r.read) {
      existing.unread += 1;
    }
  }

  const otherIds = [...byOther.keys()];
  if (otherIds.length === 0) return c.json({ success: true, data: [] });

  const profiles = await db.select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users).where(inArray(users.id, otherIds)).all();
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  const data = otherIds.map((id) => {
    const s = byOther.get(id)!;
    const p = profileMap.get(id);
    return {
      userId: id,
      displayName: p?.displayName || 'Unknown',
      avatarUrl: p?.avatarUrl || null,
      lastText: s.lastText,
      lastAt: s.lastAt,
      lastFromMe: s.lastFromMe,
      unread: s.unread,
    };
  }).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));

  return c.json({ success: true, data });
});

// GET /dm/:userId — message history with one user
dmRoutes.get('/:userId', async (c) => {
  const me = c.get('user') as AuthUser;
  const otherId = c.req.param('userId');
  const limit = parseInt(c.req.query('limit') || '200', 10);

  const rows = await db.select({
    id: directMessages.id,
    fromUserId: directMessages.fromUserId,
    toUserId: directMessages.toUserId,
    text: directMessages.text,
    read: directMessages.read,
    createdAt: directMessages.createdAt,
  })
    .from(directMessages)
    .where(or(
      and(eq(directMessages.fromUserId, me.id), eq(directMessages.toUserId, otherId)),
      and(eq(directMessages.fromUserId, otherId), eq(directMessages.toUserId, me.id)),
    ))
    .orderBy(desc(directMessages.createdAt))
    .limit(limit)
    .all();

  return c.json({ success: true, data: rows.reverse() });
});

// POST /dm/:userId — send a message
dmRoutes.post('/:userId', async (c) => {
  const me = c.get('user') as AuthUser;
  const otherId = c.req.param('userId');
  if (otherId === me.id) throw new HTTPException(400, { message: 'Cannot message yourself' });

  const body = sendSchema.parse(await c.req.json());
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, otherId)).limit(1).all();
  if (!target) throw new HTTPException(404, { message: 'User not found' });

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.insert(directMessages).values({
    id, fromUserId: me.id, toUserId: otherId, text: body.text.trim(), read: false, createdAt,
  }).run();

  const msg = { id, fromUserId: me.id, toUserId: otherId, text: body.text.trim(), read: false, createdAt };

  // Fire-and-forget real-time delivery to the recipient; harmless if they're offline.
  emitDm(otherId, msg);
  emitDm(me.id, msg);

  return c.json({ success: true, data: msg });
});

// POST /dm/:userId/read — mark messages from userId as read
dmRoutes.post('/:userId/read', async (c) => {
  const me = c.get('user') as AuthUser;
  const otherId = c.req.param('userId');

  await db.update(directMessages)
    .set({ read: true })
    .where(and(
      eq(directMessages.fromUserId, otherId),
      eq(directMessages.toUserId, me.id),
      eq(directMessages.read, false),
    ))
    .run();

  return c.json({ success: true });
});

// GET /dm/unread-count — total unread DMs for me (for global badge)
dmRoutes.get('/unread-count/total', async (c) => {
  const me = c.get('user') as AuthUser;
  const [row] = await db.select({ count: sql<number>`count(*)` })
    .from(directMessages)
    .where(and(eq(directMessages.toUserId, me.id), eq(directMessages.read, false)))
    .all();
  return c.json({ success: true, data: { count: row?.count || 0 } });
});

export default dmRoutes;
