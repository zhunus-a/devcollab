'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

test('file saves reject stale revisions and preserve the shared version', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcollab-file-conflicts-'));
  const projectsPath = path.join(dir, 'projects.json');
  process.env.DATA_FILE = projectsPath;
  process.env.USERS_FILE = path.join(dir, 'users.json');

  const { server } = require('../server/index');
  t.after(async () => {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  function request(url, method = 'GET', body, cookie) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    return fetch(base + url, { method, headers, body: JSON.stringify(body) });
  }

  async function logIn(username) {
    const credentials = { username, password: 'TestPassword123!' };
    assert.equal((await request('/api/auth/register', 'POST', credentials)).status, 201);
    const response = await request('/api/auth/login', 'POST', credentials);
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }

  const owner = await logIn('owner');
  const member = await logIn('teammate');
  const created = await request('/api/projects', 'POST', { name: 'Shared editor' }, owner);
  assert.equal(created.status, 201);
  const { project } = await created.json();
  const url = `/api/projects/${project.id}`;
  assert.equal((await request(url + '/members', 'POST', { username: 'teammate' }, owner)).status, 201);

  const filesUrl = url + '/files';
  const read = async cookie => {
    const response = await request(filesUrl, 'GET', undefined, cookie);
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.deepEqual(await read(owner), { files: {}, revision: 0 });

  // Simulate an existing project whose files were saved before revisions were introduced.
  const existingFiles = { app: 'Original app', css: '', html: 'Original HTML' };
  const projects = JSON.parse(await fs.readFile(projectsPath, 'utf8'));
  projects.find(item => item.id === project.id).files = existingFiles;
  await fs.writeFile(projectsPath, JSON.stringify(projects));

  const ownerBase = await read(owner);
  const memberBase = await read(member);
  assert.deepEqual(ownerBase, { files: existingFiles, revision: 0 });
  assert.deepEqual(memberBase, ownerBase);

  const put = (cookie, files, revision) => request(filesUrl, 'PUT', { files, revision }, cookie);
  const ownerDraft = { ...existingFiles, app: 'Owner edit' };
  const memberDraft = { ...existingFiles, app: 'Member edit' };
  assert.equal((await put(owner, ownerDraft)).status, 400);
  assert.equal((await put(owner, ownerDraft, -1)).status, 400);
  assert.deepEqual(await read(owner), ownerBase);

  const saves = await Promise.all([
    put(owner, ownerDraft, ownerBase.revision),
    put(member, memberDraft, memberBase.revision)
  ]);
  assert.deepEqual(saves.map(response => response.status).sort(), [200, 409]);

  const { message, ...saved } = await saves.find(response => response.status === 200).json();
  assert.equal(message, 'Files saved successfully');
  const conflict = await saves.find(response => response.status === 409).json();
  assert.equal(conflict.code, 'FILE_REVISION_CONFLICT');
  assert.equal(saved.revision, 1);
  assert.deepEqual(conflict.files, saved.files);
  assert.equal(conflict.revision, saved.revision);
  assert.deepEqual(await read(member), saved);

  const resolved = { ...conflict.files, app: 'Owner edit + Member edit' };
  const resolution = await put(member, resolved, conflict.revision);
  assert.equal(resolution.status, 200);
  const expectedSave = { message: 'Files saved successfully', files: resolved, revision: 2 };
  assert.deepEqual(await resolution.json(), expectedSave);

  const stale = await put(owner, ownerDraft, saved.revision);
  assert.equal(stale.status, 409);
  assert.deepEqual(await read(owner), { files: resolved, revision: 2 });

  const unchanged = await put(owner, resolved, 2);
  assert.equal(unchanged.status, 200);
  assert.deepEqual(await unchanged.json(), expectedSave);

  const largeFiles = { app: 'λ'.repeat(15000), css: '\t'.repeat(15000), html: '"'.repeat(15000) };
  const largeSave = await put(owner, largeFiles, 2);
  assert.equal(largeSave.status, 200);
  assert.deepEqual(await read(member), { files: largeFiles, revision: 3 });
});
