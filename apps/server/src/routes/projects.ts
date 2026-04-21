import { Hono } from 'hono';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/index.js';
import { projects, projectMembers, tracks, users, invitations, chatMessages, follows, files } from '../db/schema.js';
import { eq, or, and, desc, like, inArray } from 'drizzle-orm';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { createAutoSnapshot } from '../lib/autoSnapshot.js';
import { postActivityComment } from '../lib/activityComment.js';
import { assertMember, assertEditor } from '../lib/membership.js';
import { emitProjectUpdated } from '../ws/index.js';

const projectRoutes = new Hono();
projectRoutes.use('*', authMiddleware);

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().default(''),
  tempo: z.number().min(0).max(300).optional().default(0),
  key: z.string().max(10).optional().default(''),
  genre: z.string().max(50).optional().default(''),
  projectType: z.string().optional().default('project'),
  timeSignature: z.string().max(10).optional().default('4/4'),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  tempo: z.number().min(30).max(300).optional(),
  key: z.string().max(10).optional(),
  genre: z.string().max(50).optional(),
  timeSignature: z.string().max(10).optional(),
});

const inviteMemberSchema = z.object({
  email: z.string().optional(),
  name: z.string().optional(),
  role: z.enum(['editor', 'viewer']).optional().default('editor'),
}).refine(d => d.email || d.name, { message: 'Provide email or name' });

projectRoutes.get('/', async (c) => {
  const user = c.get('user') as AuthUser;

  const memberOf = await db.select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, user.id))
    .all();

  if (memberOf.length === 0) return c.json({ success: true, data: [] });

  const result = await db.select().from(projects)
    .where(or(...memberOf.map((m) => eq(projects.id, m.projectId))))
    .orderBy(desc(projects.updatedAt))
    .all();

  return c.json({ success: true, data: result });
});

projectRoutes.post('/', async (c) => {
  const user = c.get('user') as AuthUser;
  const body = createProjectSchema.parse(await c.req.json());
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db.insert(projects).values({
    id, ...body, ownerId: user.id, createdAt: now, updatedAt: now,
  }).run();

  await db.insert(projectMembers).values({
    projectId: id, userId: user.id, role: 'owner', joinedAt: now,
  }).run();

  const [project] = await db.select().from(projects).where(eq(projects.id, id)).all();
  return c.json({ success: true, data: project }, 201);
});

projectRoutes.get('/:id', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('id');

  await assertMember(projectId, user.id);

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1).all();
  if (!project) throw new HTTPException(404, { message: 'Project not found' });

  const members = await db.select({
    userId: projectMembers.userId,
    displayName: users.displayName,
    avatarUrl: users.avatarUrl,
    role: projectMembers.role,
    joinedAt: projectMembers.joinedAt,
  }).from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .all();

  const projectTracks = await db.select().from(tracks)
    .where(eq(tracks.projectId, projectId))
    .orderBy(tracks.position)
    .all();

  // Fetch peaks for all file-backed tracks in one query and attach inline,
  // so the client can render waveforms immediately with no extra round trips.
  const fileIds = Array.from(new Set(projectTracks.map((t) => t.fileId).filter((id): id is string => !!id)));
  let peaksByFileId = new Map<string, any>();
  if (fileIds.length > 0) {
    const rows = await db.select({ id: files.id, peaks: files.peaks }).from(files).where(inArray(files.id, fileIds)).all();
    for (const r of rows) {
      if (r.peaks) {
        try { peaksByFileId.set(r.id, JSON.parse(r.peaks)); } catch { /* skip corrupt cached peaks */ }
      }
    }
  }
  const tracksWithPeaks = projectTracks.map((t) => ({
    ...t,
    peaks: t.fileId ? peaksByFileId.get(t.fileId) || null : null,
  }));

  return c.json({ success: true, data: { ...project, members, tracks: tracksWithPeaks } });
});

projectRoutes.patch('/:id', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('id');
  const body = updateProjectSchema.parse(await c.req.json());

  await assertEditor(projectId, user.id);

  // Session-auto-created projects: only the host (project owner) may rename.
  // Other metadata edits remain open to all editors. Invitees could still
  // create misleading context by renaming a scheduled session, so we lock it.
  if (body.name !== undefined) {
    const { bookings } = await import('../db/schema.js');
    const [bk] = await db.select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.projectId, projectId))
      .limit(1).all();
    if (bk) {
      const [project] = await db.select({ ownerId: projects.ownerId })
        .from(projects).where(eq(projects.id, projectId)).limit(1).all();
      if (project && project.ownerId !== user.id) {
        throw new HTTPException(403, { message: 'Only the session host can rename this project' });
      }
    }
  }

  await db.update(projects).set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, projectId)).run();

  const [updated] = await db.select().from(projects).where(eq(projects.id, projectId)).all();

  const changes = Object.keys(body).join(', ');
  await createAutoSnapshot(projectId, user.id, `Updated project: ${changes}`);
  await postActivityComment(projectId, user.id, `✏️ updated project settings: ${changes}`);

  emitProjectUpdated(projectId, 'metadata-updated');
  return c.json({ success: true, data: updated });
});

// PUT /:id/arrangement — full arrangement blob (clip offsets, trims, volumes,
// mute/solo, pitch). Editors can write. We store as a JSON string and emit
// project-updated so every collaborator in the room refreshes their layout.
projectRoutes.put('/:id/arrangement', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('id');
  const body = await c.req.json();

  await assertEditor(projectId, user.id);

  // Minimal shape check — accept whatever the client sends so long as clips
  // is an array. The client owns the schema; server is just a passthrough.
  if (!body || typeof body !== 'object' || !Array.isArray(body.clips)) {
    throw new HTTPException(400, { message: 'arrangement.clips must be an array' });
  }

  await db.update(projects)
    .set({ arrangementJson: JSON.stringify(body), updatedAt: new Date().toISOString() })
    .where(eq(projects.id, projectId))
    .run();

  emitProjectUpdated(projectId, 'metadata-updated');
  return c.json({ success: true });
});

projectRoutes.delete('/:id', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('id');

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1).all();
  if (!project || project.ownerId !== user.id) {
    throw new HTTPException(403, { message: 'Only the owner can delete' });
  }

  await db.delete(projects).where(eq(projects.id, projectId)).run();
  return c.json({ success: true });
});

projectRoutes.post('/:id/members', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('id');
  const body = inviteMemberSchema.parse(await c.req.json());

  await assertEditor(projectId, user.id);

  let invitee;
  if (body.email) {
    [invitee] = await db.select().from(users).where(eq(users.email, body.email)).limit(1).all();
  } else if (body.name) {
    [invitee] = await db.select().from(users).where(like(users.displayName, body.name)).limit(1).all();
  }
  if (!invitee) throw new HTTPException(404, { message: 'User not found' });

  // Check if already a member
  const existing = await db.select().from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, invitee.id)))
    .limit(1).all();
  if (existing.length > 0) {
    return c.json({ success: true, message: 'Already a member' });
  }

  // Create a pending invitation instead of directly adding
  const invId = crypto.randomUUID();
  try {
    await db.insert(invitations).values({
      id: invId,
      projectId,
      inviterId: user.id,
      inviteeId: invitee.id,
      role: body.role,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }).run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/UNIQUE|PRIMARY KEY/i.test(msg)) console.warn('[projects.invite] insert failed:', err);
  }

  // Auto-add as friend (both directions) so they show in presence bar
  const existingFollow = await db.select().from(follows)
    .where(and(eq(follows.followerId, user.id), eq(follows.followingId, invitee.id)))
    .limit(1).all();
  if (existingFollow.length === 0) {
    await db.insert(follows).values({ followerId: user.id, followingId: invitee.id, createdAt: new Date().toISOString() }).run();
  }
  const reverseFollow = await db.select().from(follows)
    .where(and(eq(follows.followerId, invitee.id), eq(follows.followingId, user.id)))
    .limit(1).all();
  if (reverseFollow.length === 0) {
    await db.insert(follows).values({ followerId: invitee.id, followingId: user.id, createdAt: new Date().toISOString() }).run();
  }

  await postActivityComment(projectId, user.id, `📨 invited ${invitee.displayName} to the project`);

  return c.json({ success: true, message: 'Invitation sent' });
});

// Remove a member from a project (owner only)
projectRoutes.delete('/:id/members/:userId', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('id');
  const targetUserId = c.req.param('userId');

  const membership = await assertMember(projectId, user.id);

  if (membership.role !== 'owner') {
    throw new HTTPException(403, { message: 'Only the project owner can remove members' });
  }

  if (targetUserId === user.id) {
    throw new HTTPException(400, { message: 'Cannot remove yourself from the project' });
  }

  const [removedUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1).all();

  await db.delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)))
    .run();

  await postActivityComment(projectId, user.id, `👋 removed ${removedUser?.displayName || 'a member'} from the project`);

  emitProjectUpdated(projectId, 'member-changed');
  return c.json({ success: true });
});

// Leave a project (non-owner members only)
projectRoutes.post('/:id/leave', async (c) => {
  const user = c.get('user') as AuthUser;
  const projectId = c.req.param('id');

  const membership = await assertMember(projectId, user.id);

  if (membership.role === 'owner') {
    throw new HTTPException(400, { message: 'Owner cannot leave the project. Transfer ownership or delete it.' });
  }

  await postActivityComment(projectId, user.id, `👋 left the project`);

  await db.delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)))
    .run();

  emitProjectUpdated(projectId, 'member-changed');
  return c.json({ success: true });
});

// Get chat history for a project
projectRoutes.get('/:id/chat', async (c) => {
  const projectId = c.req.param('id');
  const limit = parseInt(c.req.query('limit') || '100', 10);

  const messages = (await db.select({
    id: chatMessages.id,
    userId: chatMessages.userId,
    displayName: chatMessages.displayName,
    colour: chatMessages.colour,
    text: chatMessages.text,
    createdAt: chatMessages.createdAt,
    avatarUrl: users.avatarUrl,
  })
    .from(chatMessages)
    .leftJoin(users, eq(users.id, chatMessages.userId))
    .where(eq(chatMessages.projectId, projectId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit)
    .all())
    .reverse() // oldest first
    .map((m) => ({
      id: m.id,
      userId: m.userId,
      displayName: m.displayName,
      colour: m.colour,
      text: m.text,
      timestamp: new Date(m.createdAt).getTime(),
      avatarUrl: m.avatarUrl,
    }));

  return c.json({ success: true, data: messages });
});

export default projectRoutes;
