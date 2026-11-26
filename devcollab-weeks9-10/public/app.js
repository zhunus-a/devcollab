'use strict';
const $ = s => document.querySelector(s);
let projects = [];
let projectView = 'mine';
let currentProject = null;
let currentFile = null;
let editorSession = null;

const fileLabels = { app: 'App.js', css: 'styles.css', html: 'index.html' };
const fileKeys = Object.keys(fileLabels);
const defaultFiles = {
    app: `function App() {\n  return (\n    <main>\n      <h1>Welcome to DevCollab</h1>\n      <p>Build together in real time.</p>\n    </main>\n  );\n}`,
    css: `body {\n  font-family: system-ui, sans-serif;\n  margin: 0;\n  background: #f8fafc;\n}\nh1 { color: #563cf4; }`,
    html: `<!doctype html>\n<html lang="en">\n  <head><title>DevCollab</title></head>\n  <body><main id="app"></main></body>\n</html>`
};

async function api(url, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error('Cannot connect to server. Please try again.');
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 &&
        !url.startsWith('/api/auth/')) {
      showAuth();
      throw new Error('Session expired. Please log in again.');
    }

    const messages = {
      400: 'Invalid request.',
      401: 'Invalid username or password.',
      403: 'Access denied. You do not have permission.',
      404: 'Not found. The requested resource does not exist.',
      409: 'Conflict. This user or resource already exists.',
      500: 'Server error. Please try again later.'
    };

    const error = new Error(
      data.error || messages[response.status] || 'Request failed.'
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

let currentUser = null;
let authMode = 'login';

function showAuth() {
  currentUser = null;
  $('#appShell').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
}

function showWorkspace(user) {
  currentUser = user;
  $('#currentUsername').textContent = user.username;
  $('#authScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  refresh();
}

$('#switchAuth').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  const registering = authMode === 'register';
  $('#authTitle').textContent = registering ? 'Register' : 'Login';
  $('#authSubmit').textContent = registering ? 'Register' : 'Login';
  $('#switchAuth').textContent = registering
    ? 'Already have an account? Login'
    : "Don't have an account? Register";
  $('#authError').textContent = '';
});

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const username = $('#authUsername').value.trim();
  const password = $('#authPassword').value;
  const button = $('#authSubmit');
  button.disabled = true;
  $('#authError').textContent = '';
  try {
    if (authMode === 'register') {
      await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
    }
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    const result = await api('/api/me');
    $('#authPassword').value = '';
    showWorkspace(result.user);
  } catch (error) {
    $('#authError').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#logoutButton').addEventListener('click', async () => {
  if (!canLeaveEditor()) return;

  try {
    await api('/api/auth/logout', { method: 'POST' });
    editorSession = null;
    closeProject();
    showAuth();
  } catch (error) {
    setStatus(error.message);
  }
});

async function initializeAuth() {
  try {
    const response = await fetch('/api/me');
    if (!response.ok) throw Error('Not logged in');
    const result = await response.json();
    showWorkspace(result.user);
  } catch {
    showAuth();
  }
}
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function setStatus(message) { $('#status').textContent = message || ''; }
async function refresh() { setStatus(''); $('#projectGrid').replaceChildren(el('p', 'muted', 'Loading projects…')); try { const result = await api('/api/projects'); projects = result.projects; renderProjects(); } catch (e) { $('#projectGrid').replaceChildren(); setStatus(`Could not load projects: ${e.message}`); } }
function renderProjects() {
    const term = $('#search').value.trim().toLowerCase(), vis = $('#visibilityFilter').value; const visible = projects
  .filter(p => {
    if (!currentUser) return false;

    const isOwner = p.ownerId === currentUser.id;
    const isMember = Array.isArray(p.members) &&
      p.members.some(member =>
        (typeof member === 'object' ? member.userId : member)
          === currentUser.id
      );

    return projectView === 'mine'
      ? isOwner
      : !isOwner && isMember;
  })
  .filter(p =>
    (vis === 'all' || p.visibility === vis) &&
    `${p.name} ${p.description || ''}`
      .toLowerCase()
      .includes(term)
  ); const grid = $('#projectGrid'); grid.replaceChildren(); if (!visible.length) { const empty = el('div', 'empty'); empty.append(el('strong', '', projects.length ? 'No matching projects' : 'No projects yet'), el('p', '', 'Create a project or change your search.')); grid.append(empty); return; }
    for (const p of visible) { const card = el('article', 'card'); card.append(el('span', 'folder-icon', '▣'), el('h2', '', p.name), el('p', '', p.description || 'No description yet')); const foot = el('div', 'card-foot'), actions = el('div', 'card-actions'); const open = el('button', 'ghost', 'Open'), del = el('button', 'ghost danger', 'Delete'); open.type = 'button'; del.type = 'button'; open.addEventListener('click', () => openProject(p)); del.addEventListener('click', async () => { if (!confirm(`Delete "${p.name}"?`)) return; try { await api(`/api/projects/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); await refresh(); } catch (e) { setStatus(e.message); } }); actions.append(open, del); foot.append(el('span', 'card-meta', `${p.visibility} · ${p.language || 'JavaScript'}`), actions); card.append(foot); grid.append(card); }
}
function fileSnapshot(files) {
  return Object.fromEntries(fileKeys.map(key => [key, files[key] ?? defaultFiles[key]]));
}

function updateEditorControls() {
  const disabled = !editorSession?.draft || editorSession.saving;
  $('#saveCode').disabled = disabled;
  $('#codeContent').disabled = disabled;
  document.querySelectorAll('[data-file]').forEach(button => {
    button.disabled = disabled;
  });
}

function setEditorStatus(message) {
  $('#editorStatus').textContent = message;
}

async function openProject(project) {
  currentProject = project;
  currentFile = null;
  const session = { url: `/api/projects/${encodeURIComponent(project.id)}/files`, saving: false };
  editorSession = session;

  $('#dashboard').classList.add('hidden');
  $('#editorView').classList.remove('hidden');
  $('#newProject').classList.add('hidden');

  $('#pageTitle').textContent = 'Project room';
  $('#pageDescription').textContent = 'Edit and save your project files';
  $('#editorProjectName').textContent = project.name;
  $('#codeContent').value = '';
  updateEditorControls();
  chooseTab('chat');
  setEditorStatus('Loading files…');

  try {
    const data = await api(session.url);
    if (editorSession !== session) return;

    session.revision = data.revision;
    session.base = fileSnapshot(data.files);
    session.draft = { ...session.base };
    chooseFile('app');
    updateEditorControls();
    setEditorStatus('');
  } catch (error) {
    if (editorSession === session) setEditorStatus('Failed to load files: ' + error.message);
  }
}

function canLeaveEditor() {
  if (editorSession?.saving) return false;
  const { base, draft } = editorSession || {};
  const hasUnsavedFiles = draft && fileKeys.some(key => draft[key] !== base[key]);
  return !hasUnsavedFiles || confirm('Leave this project and discard your unsaved edits?');
}

function closeProject() {
  if (!canLeaveEditor()) return false;

  currentProject = null;
  editorSession = null;
  currentFile = null;
  $('#dashboard').classList.remove('hidden');
  $('#editorView').classList.add('hidden');
  $('#newProject').classList.remove('hidden');
  $('#pageTitle').textContent = 'Projects';
  $('#pageDescription').textContent = 'Manage your code projects and collaborate with classmates.';
  return true;
}

function chooseFile(file) {
  if (!editorSession?.draft) return;
  currentFile = file;

  document.querySelectorAll('[data-file]').forEach(button => {
    button.classList.toggle('active', button.dataset.file === file);
  });

  $('#fileLabel').textContent = fileLabels[file];
  $('#codeContent').value = editorSession.draft[file];
}

function mergeFiles(base, draft, shared) {
  const merged = { ...shared };
  const conflicts = [];

  for (const key of fileKeys) {
    if (draft[key] === base[key] || draft[key] === shared[key]) continue;

    merged[key] = draft[key];
    if (shared[key] !== base[key]) conflicts.push(key);
  }

  return { merged, conflicts };
}

function showFileConflicts(session, revision, shared, merged, conflicts) {
  const dialog = $('#fileConflictDialog');
  const form = $('#fileConflictForm');
  const entries = $('#fileConflictEntries');
  const submit = $('#saveResolution');
  const pending = new Set(conflicts);
  entries.replaceChildren();
  submit.disabled = true;

  for (const key of conflicts) {
    const fieldset = el('fieldset', 'file-conflict');
    const versions = el('div', 'file-conflict-versions');
    const sharedLabel = el('label', '', 'Shared version');
    const draftLabel = el('label', '', 'Your draft or merged code');
    const sharedCode = el('textarea');
    const draftCode = el('textarea');
    const useShared = el('button', 'outline', 'Use shared version');
    const useDraft = el('button', 'outline', 'Keep my draft');
    const status = el('span', 'file-conflict-status', 'Choose a version or edit your draft.');
    const actions = el('div', 'file-conflict-actions');

    sharedCode.readOnly = true;
    sharedCode.spellcheck = draftCode.spellcheck = false;
    draftCode.maxLength = 15000;
    sharedCode.value = shared[key];
    draftCode.value = session.draft[key];
    useShared.type = useDraft.type = 'button';
    status.setAttribute('role', 'status');

    function resolve(code, message) {
      merged[key] = code;
      pending.delete(key);
      status.textContent = message;
      submit.disabled = pending.size > 0;
    }

    useShared.addEventListener('click', () => {
      draftCode.value = shared[key];
      resolve(shared[key], 'Using shared version.');
    });
    useDraft.addEventListener('click', () => {
      draftCode.value = session.draft[key];
      resolve(session.draft[key], 'Keeping your draft.');
    });
    draftCode.addEventListener('input', () => resolve(draftCode.value, 'Using edited code.'));

    sharedLabel.append(sharedCode);
    draftLabel.append(draftCode);
    versions.append(sharedLabel, draftLabel);
    actions.append(useShared, useDraft, status);
    fieldset.append(el('legend', '', fileLabels[key]), versions, actions);
    entries.append(fieldset);
  }

  form.onsubmit = event => {
    event.preventDefault();
    if (pending.size || editorSession !== session) return;

    session.revision = revision;
    session.base = shared;
    session.draft = merged;
    chooseFile(currentFile);
    dialog.close();
    saveFiles();
  };

  dialog.showModal();
}

async function saveFiles() {
  const session = editorSession;
  if (!session?.draft || session.saving) return;

  session.saving = true;
  updateEditorControls();
  setEditorStatus('Saving…');

  try {
    // A collaborator can save again before an automatic merge is submitted.
    // Limit retries while keeping the combined draft available in the editor.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const saved = await api(session.url, {
          method: 'PUT',
          body: JSON.stringify({ files: session.draft, revision: session.revision })
        });
        if (editorSession !== session) return;

        session.revision = saved.revision;
        session.base = fileSnapshot(saved.files);
        session.draft = { ...session.base };
        chooseFile(currentFile);
        setEditorStatus('Code saved.');
        return;
      } catch (error) {
        if (editorSession !== session) return;
        if (error.data?.code !== 'FILE_REVISION_CONFLICT') throw error;

        const { files, revision } = error.data;
        const shared = fileSnapshot(files);
        const { merged, conflicts } = mergeFiles(session.base, session.draft, shared);
        if (conflicts.length) {
          setEditorStatus('The shared version changed. Resolve the conflicts to save.');
          showFileConflicts(session, revision, shared, merged, conflicts);
          return;
        }

        session.revision = revision;
        session.base = shared;
        session.draft = merged;
        chooseFile(currentFile);
      }
    }

    setEditorStatus('The shared files are still changing. Your draft is intact. Try saving again.');
  } catch (error) {
    setEditorStatus('Failed to save code: ' + error.message);
  } finally {
    session.saving = false;
    if (editorSession === session) updateEditorControls();
  }
}

function chooseTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tab);
    button.setAttribute(
      'aria-selected',
      String(button.dataset.tab === tab)
    );
  });

  const panel = $('#panelContent');
  panel.replaceChildren();

  if (tab === 'members') {
    loadMembers();
  } else if (tab === 'chat') {
    panel.append(
      el('p', 'muted', 'Real-time chat coming soon.')
    );
  } else {
    const preview = el('div', 'preview-card');
    preview.append(
      el('h2', '', 'Welcome to DevCollab'),
      el('p', '', 'Build together in real time.')
    );
    panel.append(preview);
  }
}

async function loadMembers() {
  const project = currentProject;
  const user = currentUser;
  if (!project || !user) return;

  const panel = $('#panelContent');
  panel.replaceChildren(el('p', 'muted', 'Loading members...'));

  try {
    const projectId = encodeURIComponent(project.id);
    const result = await api(`/api/projects/${projectId}/members`);
    if (project !== currentProject || user !== currentUser) return;

    const members = result.members || [];
    const isOwner = project.ownerId === user.id;

    panel.replaceChildren(el('h3', '', 'Project Members'));

    for (const member of members) {
      const row = el('div', 'member-row');
      row.append(
        el('span', '', `${member.username} (${member.role})`)
      );

      if (isOwner && member.role !== 'owner') {
        const remove = el('button', 'ghost danger', 'Remove');

        remove.addEventListener('click', async () => {
          try {
            await api(
              `/api/projects/${projectId}/members/${encodeURIComponent(member.id)}`,
              { method: 'DELETE' }
            );
            await loadMembers();
          } catch (error) {
            setStatus(error.message);
          }
        });

        row.append(remove);
      }

      panel.append(row);
    }

    if (isOwner) {
      const input = el('input');
      input.placeholder = 'Teammate username';

      const add = el('button', 'primary', 'Add member');

      add.addEventListener('click', async () => {
        const username = input.value.trim();
        if (!username) return;

        try {
          await api(`/api/projects/${projectId}/members`, {
            method: 'POST',
            body: JSON.stringify({ username })
          });
          await loadMembers();
        } catch (error) {
          setStatus(error.message);
        }
      });

      panel.append(input, add);
    }
  } catch (error) {
    if (project !== currentProject || user !== currentUser) return;
    panel.replaceChildren(
      el('p', 'muted', `Could not load members: ${error.message}`)
    );
  }
}

function selectProjectView(view) {
  if (!closeProject()) return;
  projectView = view;

  $('#pageTitle').textContent =
    view === 'mine' ? 'My Projects' : 'Shared with me';

  $('#newProject').classList.toggle('hidden', view !== 'mine');

  $('#navProjects').classList.toggle('active', view === 'mine');
  $('#navShared').classList.toggle('active', view === 'shared');

  renderProjects();
}
function showNotImplemented() { if (closeProject()) setStatus('This section will be implemented in a future milestone.'); }
$('#newProject').addEventListener('click', () => { $('#formError').textContent = ''; $('#projectDialog').showModal(); $('#projectName').focus(); });
$('#closeDialog').addEventListener('click', () => $('#projectDialog').close()); $('#cancelDialog').addEventListener('click', () => $('#projectDialog').close());
$('#projectForm').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; const formData = new FormData(form); try { await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: formData.get('name'), description: formData.get('description'), visibility: formData.get('visibility') }) }); $('#projectDialog').close(); form.reset(); await refresh(); } catch (e) { $('#formError').textContent = e.message; } });
$('#search').addEventListener('input', renderProjects); $('#visibilityFilter').addEventListener('change', renderProjects); $('#backDashboard').addEventListener('click', closeProject);
document.querySelectorAll('[data-file]').forEach(b => b.addEventListener('click', () => chooseFile(b.dataset.file))); document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => chooseTab(b.dataset.tab))); $('#runPreview').addEventListener('click', () => chooseTab('preview'));
$('#navProjects').addEventListener('click', () => {
  selectProjectView('mine');
});

$('#navShared').addEventListener('click', () => {
  selectProjectView('shared');
});

$('#navSessions').addEventListener('click', showNotImplemented);
$('#codeContent').addEventListener('input', event => {
  if (editorSession?.draft && currentFile) {
    editorSession.draft[currentFile] = event.currentTarget.value;
  }
});
$('#saveCode').addEventListener('click', saveFiles);
$('#keepEditing').addEventListener('click', () => $('#fileConflictDialog').close());
initializeAuth();
