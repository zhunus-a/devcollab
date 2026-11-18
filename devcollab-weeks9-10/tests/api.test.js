'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Тестовый сервер: данные пишутся во временную папку, а не в настоящую data/
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcollab-test-'));
const port = 34000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: path.resolve(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    DATA_FILE: path.join(dir, 'projects.json'),
    USERS_FILE: path.join(dir, 'users.json')
  },
  stdio: 'pipe'
});
process.on('exit', () => child.kill());
after(() => {
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function ready() {
  for (let i = 0; i < 70; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 70));
  }
  throw Error('Server did not start');
}

// Помощник: отправить запрос (по желанию с cookie входа)
function call(method, url, body, cookie) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  return fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

// Помощник: зарегистрировать пользователя, войти и вернуть cookie
async function signIn(username) {
  await call('POST', '/api/auth/register', { username, password: 'password123' });
  const res = await call('POST', '/api/auth/login', { username, password: 'password123' });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test('project CRUD, input validation, persistence and static page', async () => {
  await ready();
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /DevCollab/);

  // Без входа видны 3 старых демо-проекта
  const initial = await (await call('GET', '/api/projects')).json();
  assert.equal(initial.projects.length, 3);

  const cookie = await signIn('tester');

  const bad = await call('POST', '/api/projects', { name: 'x' }, cookie);
  assert.equal(bad.status, 400);

  const created = await call('POST', '/api/projects', { name: 'API Test Project', description: 'Testing persistence', visibility: 'private' }, cookie);
  assert.equal(created.status, 201);
  const { project } = await created.json();

  const get = await (await call('GET', '/api/projects/' + project.id, null, cookie)).json();
  assert.equal(get.project.name, 'API Test Project');

  const patch = await call('PATCH', '/api/projects/' + project.id, { name: 'Updated Project' }, cookie);
  assert.equal(patch.status, 200);

  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'projects.json'), 'utf8'));
  assert(persisted.some(p => p.id === project.id && p.name === 'Updated Project' && p.ownerId));

  const removed = await call('DELETE', '/api/projects/' + project.id, null, cookie);
  assert.equal(removed.status, 200);
  const missing = await call('GET', '/api/projects/' + project.id, null, cookie);
  assert.equal(missing.status, 404);
});

test('permissions: login required, owner-only changes, private projects hidden', async () => {
  const alice = await signIn('alice');
  const bob = await signIn('bob');

  // Без входа создать проект нельзя
  const anon = await call('POST', '/api/projects', { name: 'Anonymous project' });
  assert.equal(anon.status, 401);

  // Alice создаёт приватный и публичный проекты
  const priv = (await (await call('POST', '/api/projects', { name: 'Alice private', visibility: 'private' }, alice)).json()).project;
  const pub = (await (await call('POST', '/api/projects', { name: 'Alice public', visibility: 'public' }, alice)).json()).project;

  // Приватный проект: Bob и аноним получают 404, Alice получает 200
  assert.equal((await call('GET', '/api/projects/' + priv.id, null, bob)).status, 404);
  assert.equal((await call('GET', '/api/projects/' + priv.id)).status, 404);
  assert.equal((await call('GET', '/api/projects/' + priv.id, null, alice)).status, 200);

  // В списке Bob не видит приватный проект Alice, но видит публичный
  const bobList = (await (await call('GET', '/api/projects', null, bob)).json()).projects;
  assert(!bobList.some(p => p.id === priv.id));
  assert(bobList.some(p => p.id === pub.id));

  // Публичный проект Bob видит, но менять и удалять не может (403)
  assert.equal((await call('PATCH', '/api/projects/' + pub.id, { name: 'Hacked' }, bob)).status, 403);
  assert.equal((await call('DELETE', '/api/projects/' + pub.id, null, bob)).status, 403);
  assert.equal((await call('PATCH', '/api/projects/' + pub.id, { name: 'Hacked' })).status, 401);

  // Файлы: чужой не может сохранить (403), аноним (401), владелец может (200)
  const files = { files: { app: 'a', css: 'b', html: 'c' } };
  assert.equal((await call('PUT', `/api/projects/${pub.id}/files`, files, bob)).status, 403);
  assert.equal((await call('PUT', `/api/projects/${pub.id}/files`, files)).status, 401);
  assert.equal((await call('PUT', `/api/projects/${pub.id}/files`, files, alice)).status, 200);

  // Старые проекты без владельца нельзя менять никому
  assert.equal((await call('PATCH', '/api/projects/sample-ecom', { name: 'Nope' }, alice)).status, 403);
});