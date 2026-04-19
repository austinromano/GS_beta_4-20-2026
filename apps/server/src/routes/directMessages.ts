import { Hono } from 'hono';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/index.js';
import { directMessages, users } from '../db/schema.js';
import { eq, and, or, desc, inArray, sql } from 'drizzle-orm';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { emitDm } from '../ws/index.js';
import { isR2Configured, uploadToR2, downloadFromR2 } from '../services/storage.js';

const dmRoutes = new Hono();
dmRoutes.use('*', authMiddleware);

const sendSchema = z.object({
  text: z.string().max(4000).optional().default(''),
  audioFileId: z.string().optional(),
  audioFileName: z.string().optional(),
}).refine((d) => (d.text && d.text.trim().length > 0) || d.audioFileId, { message: 'Provide text or audioFileId' });

// GET /dm/conversations — summary list: last message + unread count per counterpart
dmRoutes.get('/conversations', async (c) => {
  const me = c.get('user') as AuthUser;

  // Pull every message involving me (either direction), newest first.
  const rows = await db.select({
    id: directMessages.id,
    fromUserId: directMessages.fromUserId,
    toUserId: directMessages.toUserId,
    text: directMessages.text,
    audioFileId: directMessages.audioFileId,
    audioFileName: directMessages.audioFileName,
    read: directMessages.read,
    createdAt: directMessages.createdAt,
  })
    .from(directMessages)
    .where(or(eq(directMessages.fromUserId, me.id), eq(directMessages.toUserId, me.id)))
    .orderBy(desc(directMessages.createdAt))
    .limit(500)
    .all();

  // Group by counterpart user id.
  const byOther = new Map<string, { lastText: string; lastAt: string; unread: number; lastFromMe: boolean; lastHasAudio: boolean }>();
  for (const r of rows) {
    const other = r.fromUserId === me.id ? r.toUserId : r.fromUserId;
    const existing = byOther.get(other);
    if (!existing) {
      byOther.set(other, {
        lastText: r.text,
        lastAt: r.createdAt,
        lastFromMe: r.fromUserId === me.id,
        lastHasAudio: !!r.audioFileId,
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
      lastHasAudio: s.lastHasAudio,
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
    audioFileId: directMessages.audioFileId,
    audioFileName: directMessages.audioFileName,
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

// POST /dm/upload — upload audio for a DM, returns fileId + fileName
dmRoutes.post('/upload', async (c) => {
  const user = c.get('user') as AuthUser;
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return c.json({ success: false, error: 'No file' }, 400);
  if (file.size > 50 * 1024 * 1024) return c.json({ success: false, error: 'File too large (50MB max)' }, 413);

  const fileId = crypto.randomUUID();
  const buf = Buffer.from(await file.arrayBuffer());

  if (isR2Configured()) {
    const key = `dm/${user.id}/${fileId}_${file.name}`;
    await uploadToR2(key, buf, file.type || 'audio/wav');
    return c.json({ success: true, data: { fileId, fileName: file.name } });
  } else {
    const { mkdir } = await import('node:fs/promises');
    const { resolve, join } = await import('node:path');
    const DM_UPLOADS = resolve(import.meta.dirname, '../../uploads/dm');
    await mkdir(DM_UPLOADS, { recursive: true });
    const filePath = join(DM_UPLOADS, `${fileId}_${file.name}`);
    const fsp = await import('node:fs/promises');
    await fsp.writeFile(filePath, buf);
    return c.json({ success: true, data: { fileId, fileName: file.name } });
  }
});

// GET /dm/audio/:fileId — stream DM audio (must be sender or recipient)
dmRoutes.get('/audio/:fileId', async (c) => {
  const me = c.get('user') as AuthUser;
  const fileId = c.req.param('fileId');

  // Verify the caller is either the sender or recipient of the message that references this fileId.
  const [row] = await db.select({ fromUserId: directMessages.fromUserId, toUserId: directMessages.toUserId })
    .from(directMessages)
    .where(eq(directMessages.audioFileId, fileId))
    .limit(1).all();
  if (!row) return c.json({ success: false, error: 'Not found' }, 404);
  if (row.fromUserId !== me.id && row.toUserId !== me.id) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  if (isR2Configured()) {
    try {
      const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY || '', secretAccessKey: process.env.S3_SECRET_KEY || '' },
      });
      // File lives under dm/<senderId>/<fileId>_<name>. We know senderId (row.fromUserId).
      const list = await s3.send(new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET || 'ghost-session-files',
        Prefix: `dm/${row.fromUserId}/${fileId}`,
        MaxKeys: 1,
      }));
      const key = list.Contents?.[0]?.Key;
      if (!key) return c.json({ success: false, error: 'Not found' }, 404);
      const { stream, contentLength } = await downloadFromR2(key);
      return new Response(stream, {
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Disposition': `inline; filename="${key.split('/').pop()}"`,
          'Content-Length': contentLength.toString(),
        },
      });
    } catch {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
  }

  // Local fallback
  const { resolve, join } = await import('node:path');
  const DM_UPLOADS = resolve(import.meta.dirname, '../../uploads/dm');
  const fsp = await import('node:fs/promises');
  const fs = await import('node:fs');
  const allFiles = await fsp.readdir(DM_UPLOADS).catch(() => []);
  const match = (allFiles as string[]).find((f: string) => f.startsWith(fileId));
  if (!match) return c.json({ success: false, error: 'Not found' }, 404);
  const filePath = join(DM_UPLOADS, match);
  const fileStat = await fsp.stat(filePath);
  const stream = fs.createReadStream(filePath);
  const { Readable } = await import('node:stream');
  c.header('Content-Type', 'audio/wav');
  c.header('Content-Disposition', `inline; filename="${match}"`);
  c.header('Content-Length', fileStat.size.toString());
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers: c.res.headers });
});

// POST /dm/:userId — send a message (text and/or audio)
dmRoutes.post('/:userId', async (c) => {
  const me = c.get('user') as AuthUser;
  const otherId = c.req.param('userId');
  if (otherId === me.id) throw new HTTPException(400, { message: 'Cannot message yourself' });

  const body = sendSchema.parse(await c.req.json());
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, otherId)).limit(1).all();
  if (!target) throw new HTTPException(404, { message: 'User not found' });

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const text = (body.text || '').trim();
  await db.insert(directMessages).values({
    id,
    fromUserId: me.id,
    toUserId: otherId,
    text,
    audioFileId: body.audioFileId || null,
    audioFileName: body.audioFileName || null,
    read: false,
    createdAt,
  }).run();

  const msg = {
    id,
    fromUserId: me.id,
    toUserId: otherId,
    text,
    audioFileId: body.audioFileId || null,
    audioFileName: body.audioFileName || null,
    read: false,
    createdAt,
  };

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
