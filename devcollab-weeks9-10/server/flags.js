'use strict';
const db = require('./db');
const events = require('./events');
const { getUser } = require('./auth');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 20000) {
      const err = new Error('Request body too large');
      err.status = 413;
      throw err;
    }
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    const err = new Error('Invalid JSON');
    err.status = 400;
    throw err;
  }
}

// ---------- Права доступа (BE-14) ----------
async function access(projectId, userId) {
  const { rows } = await db.query(
    `SELECT p.owner_id,
            p.is_public,
            EXISTS (
              SELECT 1 FROM project_members m
              WHERE m.project_id = p.id AND m.user_id = $2
            ) AS is_member
     FROM projects p
     WHERE p.id = $1`,
    [projectId, userId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  const isOwner = Boolean(r.owner_id) && r.owner_id === userId;
  const isMember = Boolean(r.is_member);
  return {
    canView: Boolean(r.is_public) || !r.owner_id || isOwner || isMember,
    canEdit: isOwner || isMember,
    isOwner,
    isMember,
  };
}

async function isProjectPerson(projectId, userId) {
  const a = await access(projectId, userId);
  return Boolean(a && a.canEdit);
}

// ---------- Уведомления и выборки ----------
async function notify(userId, type, flag, message) {
  const { rows } = await db.query(
    `INSERT INTO notifications (user_id, type, flag_id, project_id, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, type, flag.id, flag.project_id, message]
  );
  events.emit('notification:created', rows[0]);
}

async function getFlagFull(id) {
  const { rows } = await db.query(
    `SELECT f.*,
            cu.username AS created_by_name,
            au.username AS assigned_to_name,
            (SELECT COUNT(*)::int FROM flag_comments c WHERE c.flag_id = f.id) AS comment_count
     FROM code_flags f
     LEFT JOIN users cu ON cu.id = f.created_by
     LEFT JOIN users au ON au.id = f.assigned_to
     WHERE f.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function usernameToId(username) {
  const { rows } = await db.query(
    'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  return rows[0] ? rows[0].id : null;
}

// ---------- Роутер ----------
async function handleFlagRoutes(req, res, pathname) {
  const method = req.method;
  const isOurs = /^\/api\/(projects\/[^/]+\/flags|flags\/|me\/tasks|notifications)/.test(pathname);
  if (!isOurs) return false;

  const user = await getUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Please log in' });
    return true;
  }

  let m;
  try {
    // 1. Список флагов проекта
    if ((m = pathname.match(/^\/api\/projects\/([^/]+)\/flags$/)) && method === 'GET') {
      const a = await access(m[1], user.id);
      if (!a || !a.canView) {
        sendJson(res, 404, { error: 'Not found' });
        return true;
      }
      const status = new URL(req.url, 'http://localhost').searchParams.get('status');
      const { rows } = await db.query(
        `SELECT f.*,
                cu.username AS created_by_name,
                au.username AS assigned_to_name,
                (SELECT COUNT(*)::int FROM flag_comments c WHERE c.flag_id = f.id) AS comment_count
         FROM code_flags f
         LEFT JOIN users cu ON cu.id = f.created_by
         LEFT JOIN users au ON au.id = f.assigned_to
         WHERE f.project_id = $1 AND ($2::text IS NULL OR f.status = $2)
         ORDER BY f.created_at DESC`,
        [m[1], status]
      );
      sendJson(res, 200, rows);
      return true;
    }

    // 2. Создание флага
    if ((m = pathname.match(/^\/api\/projects\/([^/]+)\/flags$/)) && method === 'POST') {
      const a = await access(m[1], user.id);
      if (!a || !a.canView) {
        sendJson(res, 404, { error: 'Not found' });
        return true;
      }
      if (!a.canEdit) {
        sendJson(res, 403, { error: 'Forbidden' });
        return true;
      }

      const { filename, line, text, assignedTo } = await readJson(req);
      if (!filename || typeof filename !== 'string' || !Number.isInteger(line) || line < 1) {
        sendJson(res, 400, { error: 'filename and line (number) are required' });
        return true;
      }
      if (text !== undefined && text !== null && (typeof text !== 'string' || text.length > 2000)) {
        sendJson(res, 400, { error: 'Comment too long' });
        return true;
      }

      let assigneeId = null;
      if (assignedTo !== undefined && assignedTo !== null && assignedTo !== '') {
        if (typeof assignedTo !== 'string') {
          sendJson(res, 400, { error: 'Invalid assignedTo' });
          return true;
        }
        assigneeId = await usernameToId(assignedTo.trim());
        if (!assigneeId || !(await isProjectPerson(m[1], assigneeId))) {
          sendJson(res, 400, { error: 'User is not a member of this project' });
          return true;
        }
      }

      const ins = await db.query(
        `INSERT INTO code_flags (project_id, filename, line_number, created_by, assigned_to)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [m[1], filename.trim(), line, user.id, assigneeId]
      );
      const flag = ins.rows[0];

      if (text && text.trim()) {
        await db.query(
          'INSERT INTO flag_comments (flag_id, user_id, body) VALUES ($1, $2, $3)',
          [flag.id, user.id, text.trim()]
        );
      }

      if (assigneeId && assigneeId !== user.id) {
        await notify(
          assigneeId,
          'assigned',
          flag,
          `${user.username} assigned you a flag in ${flag.filename}:${flag.line_number}`
        );
      }

      const full = await getFlagFull(flag.id);
      events.emit('flag:created', full);
      sendJson(res, 201, full);
      return true;
    }

    // 3. Обновление статуса / исполнителя флага
    if ((m = pathname.match(/^\/api\/flags\/(\d+)$/)) && method === 'PATCH') {
      const flag = await getFlagFull(Number(m[1]));
      if (!flag) {
        sendJson(res, 404, { error: 'Not found' });
        return true;
      }
      const a = await access(flag.project_id, user.id);
      if (!a || !a.canView) {
        sendJson(res, 404, { error: 'Not found' });
        return true;
      }
      if (!a.canEdit) {
        sendJson(res, 403, { error: 'Forbidden' });
        return true;
      }

      const body = await readJson(req);

      if (body.status !== undefined) {
        if (!['open', 'resolved'].includes(body.status)) {
          sendJson(res, 400, { error: 'status must be open or resolved' });
          return true;
        }
        await db.query(
          `UPDATE code_flags
           SET status = $1,
               resolved_at = CASE WHEN $1 = 'resolved' THEN now() ELSE NULL END
           WHERE id = $2`,
          [body.status, flag.id]
        );
        if (body.status === 'resolved' && flag.created_by && flag.created_by !== user.id) {
          await notify(
            flag.created_by,
            'resolved',
            flag,
            `${user.username} resolved your flag in ${flag.filename}:${flag.line_number}`
          );
        }
      }

      if (body.assignedTo !== undefined) {
        let newId = null;
        if (body.assignedTo !== null && body.assignedTo !== '') {
          if (typeof body.assignedTo !== 'string') {
            sendJson(res, 400, { error: 'Invalid assignedTo' });
            return true;
          }
          newId = await usernameToId(body.assignedTo.trim());
          if (!newId || !(await isProjectPerson(flag.project_id, newId))) {
            sendJson(res, 400, { error: 'User is not a member of this project' });
            return true;
          }
        }
        await db.query('UPDATE code_flags SET assigned_to = $1 WHERE id = $2', [newId, flag.id]);
        if (newId && newId !== user.id) {
          await notify(
            newId,
            'assigned',
            flag,
            `${user.username} assigned you a flag in ${flag.filename}:${flag.line_number}`
          );
        }
      }

      const full = await getFlagFull(flag.id);
      events.emit('flag:updated', full);
      sendJson(res, 200, full);
      return true;
    }

    // 4. Комментарии к флагу
    if ((m = pathname.match(/^\/api\/flags\/(\d+)\/comments$/))) {
      const flag = await getFlagFull(Number(m[1]));
      if (!flag) {
        sendJson(res, 404, { error: 'Not found' });
        return true;
      }
      const a = await access(flag.project_id, user.id);
      if (!a || !a.canView) {
        sendJson(res, 404, { error: 'Not found' });
        return true;
      }

      if (method === 'GET') {
        const { rows } = await db.query(
          `SELECT c.id, c.body, c.created_at, u.username
           FROM flag_comments c
           JOIN users u ON u.id = c.user_id
           WHERE c.flag_id = $1
           ORDER BY c.created_at ASC`,
          [flag.id]
        );
        sendJson(res, 200, rows);
        return true;
      }

      if (method === 'POST') {
        if (!a.canEdit) {
          sendJson(res, 403, { error: 'Forbidden' });
          return true;
        }
        const { body } = await readJson(req);
        if (typeof body !== 'string' || !body.trim() || body.length > 2000) {
          sendJson(res, 400, { error: 'Comment must be 1-2000 characters' });
          return true;
        }
        const ins = await db.query(
          `INSERT INTO flag_comments (flag_id, user_id, body)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [flag.id, user.id, body.trim()]
        );
        const comment = { ...ins.rows[0], username: user.username };

        const toNotify = new Set([flag.created_by, flag.assigned_to]);
        toNotify.delete(user.id);
        toNotify.delete(null);
        for (const uid of toNotify) {
          await notify(
            uid,
            'comment',
            flag,
            `${user.username} commented on ${flag.filename}:${flag.line_number}`
          );
        }

        events.emit('comment:created', { flagId: flag.id, projectId: flag.project_id, comment });
        sendJson(res, 201, comment);
        return true;
      }
    }

    // 5. Мои задачи
    if (pathname === '/api/me/tasks' && method === 'GET') {
      const { rows } = await db.query(
        `SELECT f.*,
                p.name AS project_name,
                cu.username AS created_by_name
         FROM code_flags f
         JOIN projects p ON p.id = f.project_id
         LEFT JOIN users cu ON cu.id = f.created_by
         WHERE f.assigned_to = $1 AND f.status = 'open'
         ORDER BY f.created_at DESC`,
        [user.id]
      );
      sendJson(res, 200, rows);
      return true;
    }

    // 6. Уведомления
    if (pathname === '/api/notifications' && method === 'GET') {
      const { rows } = await db.query(
        `SELECT * FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [user.id]
      );
      sendJson(res, 200, rows);
      return true;
    }

    if (pathname === '/api/notifications/read-all' && method === 'POST') {
      await db.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [user.id]);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if ((m = pathname.match(/^\/api\/notifications\/(\d+)\/read$/)) && method === 'POST') {
      await db.query(
        'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
        [Number(m[1]), user.id]
      );
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    if (err && err.status) {
      sendJson(res, err.status, { error: err.message });
      return true;
    }
    console.error(err);
    sendJson(res, 500, { error: 'Server error' });
    return true;
  }
}

module.exports = { handleFlagRoutes };