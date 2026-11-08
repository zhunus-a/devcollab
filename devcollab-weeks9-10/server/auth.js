const { scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');
const { readUsers } = require('./users');

// ---------- Пароли (Шаг 2) ----------

// Превращает пароль в "кашу" (хеш), которую нельзя развернуть обратно
function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

// Проверяет, подходит ли введённый пароль к сохранённой каше
function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// ---------- Сессии (Шаг 4) ----------

// "Список пропусков": код сессии -> чей это пропуск и когда он истекает.
// Хранится в памяти, поэтому после перезапуска сервера нужно войти заново.
const sessions = new Map();
const SESSION_SECONDS = 7 * 24 * 60 * 60; // неделя

// Выдаёт новый пропуск пользователю и возвращает его код
function createSession(userId) {
  const sid = randomBytes(32).toString('hex');
  sessions.set(sid, { userId, expires: Date.now() + SESSION_SECONDS * 1000 });
  return sid;
}

// Аннулирует пропуск
function destroySession(sid) {
  sessions.delete(sid);
}

// Достаёт значение cookie по имени из заголовка запроса
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

// Кто сейчас делает запрос? Возвращает пользователя или null.
async function getUser(req) {
  const sid = getCookie(req, 'sid');
  const session = sid && sessions.get(sid);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  const users = await readUsers();
  return users.find(u => u.id === session.userId) || null;
}

// Строки для заголовка Set-Cookie: выдать пропуск и забрать пропуск
function sessionCookie(sid) {
  return `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}
function clearCookie() {
  return 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

module.exports = {
  hashPassword, verifyPassword,
  createSession, destroySession, getCookie, getUser,
  sessionCookie, clearCookie
};