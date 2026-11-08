'use strict';
const $ = s => document.querySelector(s);
let projects = [];
let currentProject = null;
let currentFile = 'app';

const files = {
    app: `function App() {\n  return (\n    <main>\n      <h1>Welcome to DevCollab</h1>\n      <p>Build together in real time.</p>\n    </main>\n  );\n}`,
    css: `body {\n  font-family: system-ui, sans-serif;\n  margin: 0;\n  background: #f8fafc;\n}\nh1 { color: #563cf4; }`,
    html: `<!doctype html>\n<html lang="en">\n  <head><title>DevCollab</title></head>\n  <body><main id="app"></main></body>\n</html>`
};
async function api(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const data = await response.json(); if (!response.ok) throw Error(data.error || 'Request failed'); return data; }
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function setStatus(message) { $('#status').textContent = message || ''; }
async function refresh() { setStatus(''); $('#projectGrid').replaceChildren(el('p', 'muted', 'Loading projects…')); try { const result = await api('/api/projects'); projects = result.projects; renderProjects(); } catch (e) { $('#projectGrid').replaceChildren(); setStatus(`Could not load projects: ${e.message}`); } }
function renderProjects() {
    const term = $('#search').value.trim().toLowerCase(), vis = $('#visibilityFilter').value; const visible = projects.filter(p => (vis === 'all' || p.visibility === vis) && `${p.name} ${p.description}`.toLowerCase().includes(term)); const grid = $('#projectGrid'); grid.replaceChildren(); if (!visible.length) { const empty = el('div', 'empty'); empty.append(el('strong', '', projects.length ? 'No matching projects' : 'No projects yet'), el('p', '', 'Create a project or change your search.')); grid.append(empty); return; }
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

    O// Load files for the selected project
Object.assign(files, defaultFiles, data.files);

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
function chooseTab(tab) { document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); }); const panel = $('#panelContent'); panel.replaceChildren(); if (tab === 'chat') { const a = el('div', 'chat-bubble', 'Alex: I added the main layout.'); const b = el('div', 'chat-bubble', 'Taylor: I will work on navigation.'); panel.append(a, b, el('p', 'muted', 'Sample chat — real-time messaging is planned.')); } else if (tab === 'members') { panel.append(el('p', '', '● Alex — Owner'), el('p', '', '● Taylor — Editor'), el('p', '', '● Jamie — Editor'), el('p', 'muted', 'Sample member list.')); } else { const preview = el('div', 'preview-card'); preview.append(el('h2', '', 'Welcome to DevCollab'), el('p', '', 'Build together in real time.')); panel.append(preview); } }
function showNotImplemented() { setStatus('This section will be implemented in a future milestone.'); closeProject(); }
$('#newProject').addEventListener('click', () => { $('#formError').textContent = ''; $('#projectDialog').showModal(); $('#projectName').focus(); });
$('#closeDialog').addEventListener('click', () => $('#projectDialog').close()); $('#cancelDialog').addEventListener('click', () => $('#projectDialog').close());
$('#projectForm').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; const formData = new FormData(form); try { await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: formData.get('name'), description: formData.get('description'), visibility: formData.get('visibility') }) }); $('#projectDialog').close(); form.reset(); await refresh(); } catch (e) { $('#formError').textContent = e.message; } });
$('#search').addEventListener('input', renderProjects); $('#visibilityFilter').addEventListener('change', renderProjects); $('#backDashboard').addEventListener('click', closeProject);
document.querySelectorAll('[data-file]').forEach(b => b.addEventListener('click', () => chooseFile(b.dataset.file))); document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => chooseTab(b.dataset.tab))); $('#runPreview').addEventListener('click', () => chooseTab('preview'));
$('#navProjects').addEventListener('click', () => { closeProject(); setStatus(''); }); $('#navShared').addEventListener('click', showNotImplemented); $('#navSessions').addEventListener('click', showNotImplemented);
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
refresh();
