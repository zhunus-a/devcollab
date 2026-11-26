# DevCollab — Weeks 9–10 Starter Milestone

Desktop-first collaborative coding platform concept for a three-person Web Programming course team.

## Implemented in this starter
- **Week 9:** Semantic HTML, responsive CSS Grid/Flexbox, project cards, search and visibility filtering, accessible create-project modal, read-only editor demo, file/tab switching, loading/empty/error states.
- **Week 10:** REST API and persistent JSON-backed project CRUD (create, read, update, delete), browser `fetch()` integration, basic validation and automated API tests.

## Not implemented yet
PostgreSQL, collaborative cursors, Socket.IO, chat persistence, actual code execution, and invitations. The chat and preview show sample content.

## Requirements / run
Node.js 18 or newer. No external npm dependencies.

```bash
npm start
```

Open http://localhost:3000. For tests:

```bash
npm test
```

Projects persist locally in `data/projects.json`, which is excluded from Git. To reset to sample projects, stop the server and delete `data/projects.json`, then restart.

## Saving shared code

The first successful save updates the shared project. If you save from an older version, DevCollab automatically combines edits to different files and accepts identical changes. When both developers changed the same file differently, the editor shows the shared version next to your draft. For each file, choose a version or edit the draft to combine both, then select **Save resolution**. **Keep editing** returns to your original draft.

## API
- `GET /api/health` — health check
- `GET /api/projects` — list projects
- `GET /api/projects/:id` — project details
- `POST /api/projects` — create project with JSON `{name,description,visibility}`
- `PATCH /api/projects/:id` — modify fields
- `DELETE /api/projects/:id` — delete project
- `GET /api/projects/:id/files` — get the shared `{files, revision}` snapshot
- `PUT /api/projects/:id/files` — save `{files, revision}` against the loaded revision. A stale revision returns HTTP 409, `FILE_REVISION_CONFLICT`, and the current snapshot so the client can reconcile the draft.

## Team contribution plan (replace placeholders with real names and evidence)
1. Frontend/UI: page markup, design, responsive layout, navigation.
2. Backend/Data: API, persistence, validation.
3. Integration/QA: interactions, `fetch`, API tests, documentation.

All three students should review and explain each other's code. Record personal commits and pull requests; do not present this starter as independently developed work without disclosing AI assistance.

## Project requirements outstanding
Add real identity-based access control, database, secure input handling, further tests, and deployment before final defense. Current project visibility labels do **not** enforce access permissions.

## Course alignment
Lecture 1 client-server and Git; Lecture 2 semantic HTML; Lecture 4 Grid/Flexbox and responsive layouts; Lecture 5 JS variables/functions/conditionals; Lecture 6 arrays/objects/filter/map/modules (this starter uses arrays, objects and filter; module split is future); Lecture 7 DOM, events, forms, `fetch`, and error states.

See `docs/` for progress report templates and verification requirements.
