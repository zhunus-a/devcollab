'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getCookie,
  getUser,
  sessionCookie,
  clearCookie,
} = require('./auth');
const { findByUsername, findById, createUser } = require('./users');
const { handleFlagRoutes } = require('./flags');
const db = require('./db');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const PORT = Number(process.env.PORT || 3000);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

async function bodyJSON(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 20000) {
      const e = Error('Request body too large');
      e.status = 413;
      throw e;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    const e = Error('Invalid JSON');
    e.status = 400;
    throw e;
  }
}

function validate(obj, patch = false) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 'Invalid project object';
  if (!patch || Object.hasOwn(obj, 'name')) {
    if (typeof obj.name !== 'string' || obj.name.trim().length < 3 || obj.name.trim().length > 60) {
      return 'Project name must be 3–60 characters';
    }
  }
  if (Object.hasOwn(obj, 'description') && (typeof obj.description !== 'string' || obj.description.length > 240)) {
    return 'Description must be 240 characters or fewer';
  }
  if (Object.hasOwn(obj, 'visibility') && !['private', 'public'].includes(obj.visibility)) {
    return 'Invalid visibility';
  }
  if (patch && !['name', 'description', 'visibility'].some((k) => Object.hasOwn(obj, k))) {
    return 'No editable fields supplied';
  }
  return null;
}

async function requireUser(req, res) {
  const user = await getUser(req);
  if (!user) send(res, 401, { error: 'Please log in' });
  return user;
}

function formatProject(row, memberIds = []) {
  const visibility = row.is_public ? 'public' : 'private';
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    visibility,
    isPublic: Boolean(row.is_public),
    ownerId: row.owner_id || null,
    members: memberIds,
    language: row.language || 'JavaScript',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function getProjectWithAccess(projectId, user) {
  const { rows } = await db.query(
    `SELECT p.*,
            COALESCE(
              ARRAY_AGG(m.user_id) FILTER (WHERE m.user_id IS NOT NULL),
              '{}'
            ) AS member_ids
     FROM projects p
     LEFT JOIN project_members m ON m.project_id = p.id
     WHERE p.id = $1
     GROUP BY p.id`,
    [projectId]
  );
  if (!rows[0]) return null;

  const row = rows[0];
  const memberIds = Array.isArray(row.member_ids) ? row.member_ids : [];
  const userId = user ? user.id : null;
  const isOwner = Boolean(userId && row.owner_id && row.owner_id === userId);
  const isMember = Boolean(userId && memberIds.includes(userId));
  const canView = Boolean(row.is_public) || !row.owner_id || isOwner || isMember;
  const canEdit = isOwner || isMember;

  return {
    row,
    project: formatProject(row, memberIds),
    memberIds,
    isOwner,
    isMember,
    canView,
    canEdit,
  };
}

async function listMembersForProject(project) {
  const { rows } = await db.query(
    `SELECT u.id, u.username
     FROM users u
     WHERE u.id = $1 OR u.id = ANY($2::text[])`,
    [project.ownerId || '', project.members || []]
  );
  const byId = new Map(rows.map((u) => [u.id, u]));
  const result = [];
  if (project.ownerId && byId.has(project.ownerId)) {
    const owner = byId.get(project.ownerId);
    result.push({ id: owner.id, username: owner.username, role: 'owner' });
  }
  for (const mid of project.members || []) {
    if (mid !== project.ownerId && byId.has(mid)) {
      const member = byId.get(mid);
      result.push({ id: member.id, username: member.username, role: 'member' });
    }
  }
  return result;
}

async function handleAPI(req, res, url) {
  if (await handleFlagRoutes(req, res, url.pathname)) return;

  if (url.pathname === '/api/health' && req.method === 'GET') {
    return send(res, 200, { status: 'ok' });
  }

  // Регистрация
  if (url.pathname === '/api/auth/register') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const input = (await bodyJSON(req)) || {};
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (username.length < 3 || username.length > 30) return send(res, 400, { error: 'Username must be 3–30 characters' });
    if (password.length < 8 || password.length > 100) return send(res, 400, { error: 'Password must be 8–100 characters' });

    const existing = await findByUsername(username);
    if (existing) return send(res, 409, { error: 'Username already taken' });

    const id = randomUUID();
    await createUser(id, username, hashPassword(password));
    return send(res, 201, { user: { id, username } });
  }

  // Вход
  if (url.pathname === '/api/auth/login') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const input = (await bodyJSON(req)) || {};
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';

    const user = await findByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return send(res, 401, { error: 'Invalid username or password' });
    }
    const sid = createSession(user.id);
    return send(res, 200, { user: { id: user.id, username: user.username } }, { 'Set-Cookie': sessionCookie(sid) });
  }

  // Выход
  if (url.pathname === '/api/auth/logout') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const sid = getCookie(req, 'sid');
    if (sid) destroySession(sid);
    return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
  }

  // Текущий пользователь
  if (url.pathname === '/api/me') {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const sessionUser = await getUser(req);
    if (!sessionUser) return send(res, 401, { error: 'Not logged in' });
    const user = (await findById(sessionUser.id)) || sessionUser;
    return send(res, 200, { user: { id: user.id, username: user.username } });
  }

  if (!url.pathname.startsWith('/api/projects')) {
    return send(res, 404, { error: 'API route not found' });
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[2];

  // Файлы проекта: GET / PUT /api/projects/:id/files
  if (parts.length === 4 && parts[3] === 'files' && id) {
    if (req.method !== 'GET' && req.method !== 'PUT') {
      return send(res, 405, { error: 'Method not allowed' });
    }

    const user = await getUser(req);
    const ctx = await getProjectWithAccess(id, user);
    if (!ctx || !ctx.canView) {
      return send(res, 404, { error: 'Project not found' });
    }

    if (req.method === 'PUT') {
      if (!user) return send(res, 401, { error: 'Please log in' });
      if (!ctx.canEdit) return send(res, 403, { error: 'Only the owner and members can change files' });
    }

    if (req.method === 'GET') {
      const { rows } = await db.query(
        'SELECT filename, content FROM project_files WHERE project_id = $1',
        [id]
      );
      const files = {};
      for (const r of rows) {
        files[r.filename] = r.content;
      }
      return send(res, 200, { files });
    }

    if (req.method === 'PUT') {
      const input = await bodyJSON(req);
      const keys = ['app', 'css', 'html'];
      if (
        !input.files ||
        typeof input.files !== 'object' ||
        Array.isArray(input.files) ||
        !keys.every((key) => typeof input.files[key] === 'string' && input.files[key].length <= 15000)
      ) {
        return send(res, 400, { error: 'Invalid project files' });
      }

      const savedFiles = {};
      for (const key of keys) {
        savedFiles[key] = input.files[key];
        await db.query(
          `INSERT INTO project_files (project_id, filename, content, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (project_id, filename)
           DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
          [id, key, input.files[key]]
        );
      }

      return send(res, 200, { message: 'Files saved successfully', files: savedFiles });
    }
  }

  // Участники проекта: GET / POST /api/projects/:id/members, DELETE /api/projects/:id/members/:userId
  if (parts[3] === 'members' && id && (parts.length === 4 || parts.length === 5)) {
    const user = await getUser(req);
    const ctx = await getProjectWithAccess(id, user);
    if (!ctx || !ctx.canView) return send(res, 404, { error: 'Project not found' });
    if (!user) return send(res, 401, { error: 'Please log in' });

    if (parts.length === 4 && req.method === 'GET') {
      if (!ctx.canEdit) return send(res, 403, { error: 'Only the owner and members can see the member list' });
      return send(res, 200, { members: await listMembersForProject(ctx.project) });
    }

    if (parts.length === 4 && req.method === 'POST') {
      if (!ctx.isOwner) return send(res, 403, { error: 'Only the owner can add members' });
      const input = (await bodyJSON(req)) || {};
      const username = typeof input.username === 'string' ? input.username.trim() : '';
      const target = await findByUsername(username);
      if (!target) return send(res, 404, { error: 'User not found' });
      if (target.id === ctx.project.ownerId || ctx.memberIds.includes(target.id)) {
        return send(res, 409, { error: 'User is already in this project' });
      }
      await db.query(
        'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, target.id]
      );
      const updated = await getProjectWithAccess(id, user);
      return send(res, 201, { members: await listMembersForProject(updated.project) });
    }

    if (parts.length === 5 && req.method === 'DELETE') {
      const targetId = parts[4];
      if (!ctx.isOwner && user.id !== targetId) {
        return send(res, 403, { error: 'Only the owner can remove other members' });
      }
      if (!ctx.memberIds.includes(targetId)) return send(res, 404, { error: 'Member not found' });
      await db.query(
        'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2',
        [id, targetId]
      );
      const updated = await getProjectWithAccess(id, user);
      return send(res, 200, { members: await listMembersForProject(updated.project) });
    }

    return send(res, 405, { error: 'Method not allowed' });
  }

  if (parts.length > 3) {
    return send(res, 404, { error: 'Not found' });
  }

  // Список проектов: GET /api/projects
  if (!id && req.method === 'GET') {
    const user = await getUser(req);
    const userId = user ? user.id : null;

    const { rows: projectRows } = await db.query(
      'SELECT id, name, owner_id, is_public, created_at FROM projects ORDER BY created_at DESC'
    );
    const { rows: memberRows } = await db.query(
      'SELECT project_id, user_id FROM project_members'
    );

    const membersByProject = new Map();
    for (const m of memberRows) {
      if (!membersByProject.has(m.project_id)) {
        membersByProject.set(m.project_id, []);
      }
      membersByProject.get(m.project_id).push(m.user_id);
    }

    const projects = projectRows
      .filter((r) => {
        const memberIds = membersByProject.get(r.id) || [];
        const isOwner = Boolean(userId && r.owner_id && r.owner_id === userId);
        const isMember = Boolean(userId && memberIds.includes(userId));
        return Boolean(r.is_public) || !r.owner_id || isOwner || isMember;
      })
      .map((r) => formatProject(r, membersByProject.get(r.id) || []));

    return send(res, 200, { projects });
  }

  // Создание проекта: POST /api/projects
  if (!id && req.method === 'POST') {
    const user = await requireUser(req, res);
    if (!user) return;
    const input = await bodyJSON(req);
    const error = validate(input);
    if (error) return send(res, 400, { error });

    const newId = randomUUID();
    const name = input.name.trim();
    const isPublic = input.visibility === 'public';

    const { rows } = await db.query(
      `INSERT INTO projects (id, name, owner_id, is_public)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [newId, name, user.id, isPublic]
    );

    const project = {
      ...formatProject(rows[0], []),
      description: (input.description || '').trim(),
      visibility: input.visibility || 'private',
    };
    return send(res, 201, { project });
  }

  // Один проект: GET / PATCH / DELETE /api/projects/:id
  if (id && ['GET', 'PATCH', 'DELETE'].includes(req.method)) {
    const user = await getUser(req);
    const ctx = await getProjectWithAccess(id, user);
    if (!ctx || !ctx.canView) return send(res, 404, { error: 'Project not found' });

    if (req.method === 'GET') {
      return send(res, 200, { project: ctx.project });
    }

    if (!user) return send(res, 401, { error: 'Please log in' });
    if (!ctx.isOwner) return send(res, 403, { error: 'Only the owner can change this project' });

    if (req.method === 'DELETE') {
      await db.query('DELETE FROM projects WHERE id = $1', [id]);
      return send(res, 200, { deleted: true });
    }

    const input = await bodyJSON(req);
    const error = validate(input, true);
    if (error) return send(res, 400, { error });

    const nextName = Object.hasOwn(input, 'name') ? input.name.trim() : ctx.row.name;
    const nextIsPublic = Object.hasOwn(input, 'visibility')
      ? input.visibility === 'public'
      : Boolean(ctx.row.is_public);

    const { rows } = await db.query(
      `UPDATE projects
       SET name = $1, is_public = $2
       WHERE id = $3
       RETURNING *`,
      [nextName, nextIsPublic, id]
    );

    const updated = {
      ...formatProject(rows[0], ctx.memberIds),
      description: Object.hasOwn(input, 'description')
        ? input.description.trim()
        : ctx.project.description,
    };
    return send(res, 200, { project: updated });
  }

  return send(res, 405, { error: 'Method not allowed' });
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  let relative = decodeURIComponent(url.pathname);
  if (relative === '/') relative = '/index.html';
  const target = path.resolve(publicDir, '.' + relative);
  if (target !== publicDir && !target.startsWith(publicDir + path.sep)) {
    return send(res, 403, { error: 'Forbidden' });
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(target)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') {
      return send(res, 404, { error: 'Page not found' });
    }
    throw e;
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const work = async () => {
    try {
      if (url.pathname.startsWith('/api/')) await handleAPI(req, res, url);
      else await serveStatic(req, res, url);
    } catch (e) {
      send(res, e.status || 500, { error: e.status ? e.message : 'Internal server error' });
      console.error(e);
    }
  };
  work();
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`DevCollab running at http://localhost:${PORT}`));
}

module.exports = { server, db };