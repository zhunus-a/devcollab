# Week 10 Progress Report — DevCollab (draft template)

**Team:** [team name]  
**Practice session:** [session]  
**Members:** [member 1], [member 2], [member 3]  
**Repository:** https://github.com/zhunus-a/devcollab (verify URL)

## Goal
Connect the interactive dashboard to a backend API and persist project records.

## Proposed achievements — confirm after testing
- Node.js HTTP server serving the web interface.
- REST endpoints for project CRUD and health status.
- JSON-file persistence for initial milestone (database migration still pending).
- Browser Fetch API integration with loading/error states.
- Server-side validation and automated CRUD tests.

## Lecture alignment
- Lecture 1: HTTP request/response and frontend-backend division.
- Lecture 5: reusable functions, conditionals and validation.
- Lecture 6: arrays of objects and filter/find.
- Lecture 7: async fetch, response.ok, DOM updates, user-visible error states.

## Evidence to attach
[npm test output], [GET /api/projects JSON screenshot], [create-and-reload demonstration], [PR links], [commit SHAs].

## Challenges and response
Possible challenge: browser state disappears after refresh without persistence. The API stores project records in a JSON file and reloads them after restart. Only report this as a challenge if it was actually investigated by your team.

## Individual contributions — fill using actual commits
- Student 1: [API-connected frontend UI + commit/PR]
- Student 2: [API and persistence + commit/PR]
- Student 3: [validation, tests, documentation + commit/PR]

## AI assistance
ChatGPT prepared starter source code and the reporting templates. Record student review, changes, testing, and any bugs found.

## Next steps
Move persistence to PostgreSQL; implement authentication and protected user-specific projects; add real editor and collaboration features incrementally.
