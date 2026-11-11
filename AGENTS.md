# TaskManager

This is a standalone company task app inside the WildCat checkout. It does not use WildCat,
Orleans, Unity or the parent panel. Keep all changes for this app inside this folder.

Read [the plan](PLAN.md), [implementation record](docs/implementation.md) and
[project memory](docs/project-memory/MEMORY.md) before continuing work. Product behavior and
commands are in [README.md](README.md).

- Use Node.js 24.13 or newer. Runtime code has no third-party package dependencies.
- `server.mjs` is the HTTP/auth boundary; `lib/store.mjs` owns SQLite transactions and workflow.
- `public/app.js`, `style.css` and `index.html` are the Persian RTL browser interface.
- Keep setup, permissions, workflow transitions and version checks enforced on the server.
- State changes and history events belong in the same transaction.
- Administration never grants the right to approve a task unless that user is its reviewer.
- Preserve old review notes and assignment snapshots. Freeze tasks in review and completed tasks.
- Never check in data, backups, sessions, passwords or real account details.
- Run `npm run check` and `npm test` after substantive changes. For browser changes, also run
  `npm run test:browser`, or use `npm run verify` for all checks. Tests use isolated databases.
- `node tests/preview.mjs` runs a disposable browser fixture on port 4311; it must never replace
  the user's real database on port 4310. Its generated password is for temporary test data only.
  Use a separate browser profile for the preview because both ports share the host's cookies.
- Human-readable English is ASCII. Persian interface strings and the Persian plan retain Unicode.
- Report actual verification and deployment limits. The user requested local testing for now;
  do not publish or expose the app to the Internet without a later request.
