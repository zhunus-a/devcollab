'use strict';
const $ = s => document.querySelector(s);
let projects = [];
let projectView = 'mine';
let currentProject = null;
let currentFile = 'app';

const files = {
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
  try {
    await api('/api/auth/logout', { method: 'POST' });
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
async function openProject(project) {
  currentProject = project;

  $('#dashboard').classList.add('hidden');
  $('#editorView').classList.remove('hidden');
  $('#newProject').classList.add('hidden');

  $('#pageTitle').textContent = 'Project room';
  $('#pageDescription').textContent = 'Edit and save your project files';
  $('#editorProjectName').textContent = project.name;

  try {
    const data = await api(
      `/api/projects/${encodeURIComponent(project.id)}/files`
    );

   // Load files for the selected project
Object.assign(files, data.files);

// Reset the current file
currentFile = null;

// Display App.js
chooseFile('app');
chooseTab('chat');

    setStatus('');
  } catch (error) {
    setStatus('Failed to load files: ' + error.message);
  }
}
function closeProject() { $('#dashboard').classList.remove('hidden'); $('#editorView').classList.add('hidden'); $('#newProject').classList.remove('hidden'); $('#pageTitle').textContent = 'Projects'; $('#pageDescription').textContent = 'Manage your code projects and collaborate with classmates.'; }
function chooseFile(file) {
  // Save changes only when switching to another file
  if (currentFile && currentFile !== file) {
    files[currentFile] = $('#codeContent').value;
  }

  currentFile = file;

  document.querySelectorAll('[data-file]').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.file === file
    );
  });

  $('#fileLabel').textContent = {
    app: 'App.js',
    css: 'styles.css',
    html: 'index.html'
  }[file];

  $('#codeContent').value = files[file];
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
  if (!currentProject) return;

  const panel = $('#panelContent');
  panel.replaceChildren(el('p', 'muted', 'Loading members...'));

  try {
    const projectId = encodeURIComponent(currentProject.id);
    const result = await api(`/api/projects/${projectId}/members`);
    const members = result.members || [];
    const isOwner = currentProject.ownerId === currentUser.id;

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
    panel.replaceChildren(
      el('p', 'muted', `Could not load members: ${error.message}`)
    );
  }
}

function selectProjectView(view) {
  projectView = view;
  closeProject();

  $('#pageTitle').textContent =
    view === 'mine' ? 'My Projects' : 'Shared with me';

  $('#newProject').classList.toggle('hidden', view !== 'mine');

  $('#navProjects').classList.toggle('active', view === 'mine');
  $('#navShared').classList.toggle('active', view === 'shared');

  renderProjects();
}
function showNotImplemented() { setStatus('This section will be implemented in a future milestone.'); closeProject(); }
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
$('#saveCode').addEventListener('click', async () => {
  if (!currentProject) return;

  files[currentFile] = $('#codeContent').value;

  try {
    await api(
      `/api/projects/${encodeURIComponent(currentProject.id)}/files`,
      {
        method: 'PUT',
        body: JSON.stringify({ files })
      }
    );

    setStatus('Code saved successfully!');
  } catch (error) {
    setStatus('Failed to save code: ' + error.message);
  }
});
initializeAuth();
