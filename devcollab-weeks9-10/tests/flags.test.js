'use strict';

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { server, db } = require('../server/index');

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/devcollab_test';

let baseUrl;

function asArray(data, key) {
  if (Array.isArray(data)) return data;
  if (data && key && Array.isArray(data[key])) return data[key];
  return [];
}

async function truncateAll() {
  await db.query(`
    TRUNCATE TABLE
      flag_comments,
      notifications,
      code_flags,
      project_files,
      project_members,
      projects,
      users
    RESTART IDENTITY CASCADE
  `);
}

async function req(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.get('set-cookie');
  const sidCookie = setCookie ? setCookie.split(';')[0] : null;
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data, cookie: sidCookie };
}

async function registerAndLogin(username, password = 'Password123!') {
  await req('POST', '/api/auth/register', { body: { username, password } });
  const loginRes = await req('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(loginRes.status, 200);
  return { user: loginRes.data.user, cookie: loginRes.cookie };
}

describe('Flags, comments, tasks, and notifications (BE-14, BE-15)', () => {
  before(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(async () => {
    await truncateAll();
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.pool.end();
  });

  it('1. Anonymous user gets 401 on protected flag/task/notification routes', async () => {
    const r1 = await req('POST', '/api/projects/some-id/flags', {
      body: { filename: 'app', line: 1, text: 'Fix bug' },
    });
    assert.equal(r1.status, 401);

    const r2 = await req('GET', '/api/me/tasks');
    assert.equal(r2.status, 401);

    const r3 = await req('GET', '/api/notifications');
    assert.equal(r3.status, 401);
  });

  it('2. Private project returns 404 to non-members', async () => {
    const owner = await registerAndLogin('owner_user');
    const stranger = await registerAndLogin('stranger_user');

    const created = await req('POST', '/api/projects', {
      cookie: owner.cookie,
      body: { name: 'Secret Repo', visibility: 'private' },
    });
    assert.equal(created.status, 201);
    const projectId = created.data.project.id;

    const getFlags = await req('GET', `/api/projects/${projectId}/flags`, {
      cookie: stranger.cookie,
    });
    assert.equal(getFlags.status, 404);
  });

  it('3. Non-member viewer gets 403 on create/comment, while member succeeds', async () => {
    const owner = await registerAndLogin('proj_owner');
    const viewer = await registerAndLogin('public_viewer');
    const member = await registerAndLogin('team_member');

    const created = await req('POST', '/api/projects', {
      cookie: owner.cookie,
      body: { name: 'Open Demo', visibility: 'public' },
    });
    const projectId = created.data.project.id;

    await req('POST', `/api/projects/${projectId}/members`, {
      cookie: owner.cookie,
      body: { username: member.user.username },
    });

    const viewerFlag = await req('POST', `/api/projects/${projectId}/flags`, {
      cookie: viewer.cookie,
      body: { filename: 'app', line: 10, text: 'Viewer try' },
    });
    assert.equal(viewerFlag.status, 403);

    const memberFlag = await req('POST', `/api/projects/${projectId}/flags`, {
      cookie: member.cookie,
      body: { filename: 'app', line: 10, text: 'Member flag' },
    });
    assert.equal(memberFlag.status, 201);
    const flagId = memberFlag.data.flag?.id || memberFlag.data.id;

    const viewerComment = await req('POST', `/api/flags/${flagId}/comments`, {
      cookie: viewer.cookie,
      body: { body: 'Viewer comment' },
    });
    assert.equal(viewerComment.status, 403);

    const memberComment = await req('POST', `/api/flags/${flagId}/comments`, {
      cookie: member.cookie,
      body: { body: 'Member comment' },
    });
    assert.equal(memberComment.status, 201);
  });

  it('4. Assigning a non-member returns 400', async () => {
    const owner = await registerAndLogin('assign_owner');
    const outsider = await registerAndLogin('outsider_dev');

    const created = await req('POST', '/api/projects', {
      cookie: owner.cookie,
      body: { name: 'Assign Check', visibility: 'private' },
    });
    const projectId = created.data.project.id;

    const badAssign = await req('POST', `/api/projects/${projectId}/flags`, {
      cookie: owner.cookie,
      body: {
        filename: 'app',
        line: 5,
        text: 'Assign outside',
        assignedTo: outsider.user.username,
      },
    });
    assert.equal(badAssign.status, 400);
  });

  it('5. Assigning a flag creates notification only for the assignee', async () => {
    const owner = await registerAndLogin('notif_owner');
    const devA = await registerAndLogin('dev_alpha');
    const devB = await registerAndLogin('dev_beta');

    const created = await req('POST', '/api/projects', {
      cookie: owner.cookie,
      body: { name: 'Notif Project', visibility: 'private' },
    });
    const projectId = created.data.project.id;

    await req('POST', `/api/projects/${projectId}/members`, {
      cookie: owner.cookie,
      body: { username: devA.user.username },
    });
    await req('POST', `/api/projects/${projectId}/members`, {
      cookie: owner.cookie,
      body: { username: devB.user.username },
    });

    const flagRes = await req('POST', `/api/projects/${projectId}/flags`, {
      cookie: owner.cookie,
      body: {
        filename: 'app',
        line: 12,
        text: 'Check auth token',
        assignedTo: devA.user.username,
      },
    });
    assert.equal(flagRes.status, 201);

    const notifA = await req('GET', '/api/notifications', { cookie: devA.cookie });
    const notifB = await req('GET', '/api/notifications', { cookie: devB.cookie });
    assert.equal(notifA.status, 200);
    assert.equal(notifB.status, 200);

    const listA = asArray(notifA.data, 'notifications');
    const listB = asArray(notifB.data, 'notifications');
    assert.ok(listA.length >= 1);
    assert.equal(listB.length, 0);
  });

  it('6. Updating flag status to resolved works; invalid status "banana" returns 400', async () => {
    const owner = await registerAndLogin('status_owner');
    const created = await req('POST', '/api/projects', {
      cookie: owner.cookie,
      body: { name: 'Status Project', visibility: 'private' },
    });
    const projectId = created.data.project.id;

    const flagRes = await req('POST', `/api/projects/${projectId}/flags`, {
      cookie: owner.cookie,
      body: { filename: 'app', line: 3, text: 'Resolve me' },
    });
    const flagId = flagRes.data.flag?.id || flagRes.data.id;

    const badStatus = await req('PATCH', `/api/flags/${flagId}`, {
      cookie: owner.cookie,
      body: { status: 'banana' },
    });
    assert.equal(badStatus.status, 400);

    const okStatus = await req('PATCH', `/api/flags/${flagId}`, {
      cookie: owner.cookie,
      body: { status: 'resolved' },
    });
    assert.equal(okStatus.status, 200);
    assert.equal((okStatus.data.flag || okStatus.data).status, 'resolved');
  });

  it('7. /api/me/tasks returns only flags assigned to the current user', async () => {
    const owner = await registerAndLogin('task_owner');
    const dev1 = await registerAndLogin('task_dev1');
    const dev2 = await registerAndLogin('task_dev2');

    const created = await req('POST', '/api/projects', {
      cookie: owner.cookie,
      body: { name: 'Tasks Project', visibility: 'private' },
    });
    const projectId = created.data.project.id;

    for (const u of [dev1, dev2]) {
      await req('POST', `/api/projects/${projectId}/members`, {
        cookie: owner.cookie,
        body: { username: u.user.username },
      });
    }

    await req('POST', `/api/projects/${projectId}/flags`, {
      cookie: owner.cookie,
      body: { filename: 'app', line: 1, text: 'For dev1', assignedTo: dev1.user.username },
    });
    await req('POST', `/api/projects/${projectId}/flags`, {
      cookie: owner.cookie,
      body: { filename: 'app', line: 2, text: 'For dev2', assignedTo: dev2.user.username },
    });

    const tasks1 = await req('GET', '/api/me/tasks', { cookie: dev1.cookie });
    assert.equal(tasks1.status, 200);
    const items1 = asArray(tasks1.data, 'tasks');
    assert.equal(items1.length, 1);
    assert.equal(items1[0].assigned_to, dev1.user.id);
  });

  it('8. Marking one notification read does not mark another user\'s notifications read', async () => {
    const owner = await registerAndLogin('read_owner');
    const dev1 = await registerAndLogin('read_dev1');
    const dev2 = await registerAndLogin('read_dev2');

    const created = await req('POST', '/api/projects', {
      cookie: owner.cookie,
      body: { name: 'Read Isolation', visibility: 'private' },
    });
    const projectId = created.data.project.id;

    for (const u of [dev1, dev2]) {
      await req('POST', `/api/projects/${projectId}/members`, {
        cookie: owner.cookie,
        body: { username: u.user.username },
      });
      await req('POST', `/api/projects/${projectId}/flags`, {
        cookie: owner.cookie,
        body: { filename: 'app', line: 7, text: `Task ${u.user.username}`, assignedTo: u.user.username },
      });
    }

    const list1 = await req('GET', '/api/notifications', { cookie: dev1.cookie });
    assert.equal(list1.status, 200);
    const notes1 = asArray(list1.data, 'notifications');
    const n1 = notes1[0];
    assert.ok(n1);

    const markRead = await req('POST', `/api/notifications/${n1.id}/read`, {
      cookie: dev1.cookie,
    });
    assert.equal(markRead.status, 200);

    const list2After = await req('GET', '/api/notifications', { cookie: dev2.cookie });
    assert.equal(list2After.status, 200);
    const notes2 = asArray(list2After.data, 'notifications');
    const n2 = notes2[0];
    assert.ok(n2);
    assert.equal(Boolean(n2.is_read ?? n2.read), false);
  });
});