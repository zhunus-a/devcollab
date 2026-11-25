'use strict';
const db = require('./db');

async function findByUsername(username) {
  const { rows } = await db.query(
    'SELECT id, username, password_hash AS "passwordHash", created_at AS "createdAt" FROM users WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query(
    'SELECT id, username, password_hash AS "passwordHash", created_at AS "createdAt" FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function createUser(id, username, passwordHash) {
  const { rows } = await db.query(
    `INSERT INTO users (id, username, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, password_hash AS "passwordHash", created_at AS "createdAt"`,
    [id, username, passwordHash]
  );
  return rows[0];
}

async function readUsers() {
  const { rows } = await db.query(
    'SELECT id, username, password_hash AS "passwordHash", created_at AS "createdAt" FROM users ORDER BY created_at ASC'
  );
  return rows;
}

module.exports = { findByUsername, findById, createUser, readUsers };