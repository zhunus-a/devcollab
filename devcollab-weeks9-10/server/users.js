'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

// Где лежит "холодильник" с пользователями
const usersPath = process.env.USERS_FILE || path.join(__dirname, '..', 'data', 'users.json');

// Читает список пользователей. Если файла ещё нет, возвращает пустой список.
async function readUsers() {
  try {
    const data = JSON.parse(await fs.readFile(usersPath, 'utf8'));
    if (!Array.isArray(data)) throw Error('Invalid users file');
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Записывает список пользователей (сначала во временный файл, потом переименовывает)
async function writeUsers(users) {
  await fs.mkdir(path.dirname(usersPath), { recursive: true });
  const tmp = usersPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(users, null, 2));
  await fs.rename(tmp, usersPath);
}

module.exports = { readUsers, writeUsers };