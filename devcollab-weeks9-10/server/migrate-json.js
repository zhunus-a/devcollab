'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('./db');

const root = path.resolve(__dirname, '..');
const usersFile = process.env.USERS_FILE || path.join(root, 'data', 'users.json');
const projectsFile = process.env.DATA_FILE || path.join(root, 'data', 'projects.json');

async function readJsonArray(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

(async () => {
  const users = await readJsonArray(usersFile);
  const projects = await readJsonArray(projectsFile);

  for (const u of users) {
    await db.query(
      `INSERT INTO users (id, username, password_hash, created_at)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()))
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.username, u.passwordHash, u.createdAt || null]
    );
  }

  for (const p of projects) {
    const isPublic = p.visibility === 'public' || !p.ownerId;
    await db.query(
      `INSERT INTO projects (id, name, owner_id, is_public, created_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.name, p.ownerId || null, isPublic, p.createdAt || null]
    );

    for (const uid of p.members || []) {
      await db.query(
        `INSERT INTO project_members (project_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [p.id, uid]
      );
    }

    for (const [filename, content] of Object.entries(p.files || {})) {
      await db.query(
        `INSERT INTO project_files (project_id, filename, content)
         VALUES ($1, $2, $3)
         ON CONFLICT (project_id, filename) DO NOTHING`,
        [p.id, filename, typeof content === 'string' ? content : '']
      );
    }
  }

  console.log('Migration done');
  await db.pool.end();
})();