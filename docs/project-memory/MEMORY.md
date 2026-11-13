# TaskManager project memory

## Initial implementation, 2026-11-06

The user requested all steps of the earlier task-manager plan. The plan was found in the chat
"Plan task management app" for this folder and in the sibling project's saved `PLAN.md`.
The sibling plan was copied here without changing the original. The user later confirmed that
the immediate target is testing on this computer, not deployment to an external server.

Implemented a standalone Node/SQLite app with Persian RTL login/setup, account administration,
scoped task creation and edits, desktop tables/mobile cards, dashboard and filters, the complete
review/revision/approval workflow, immutable history snapshots and optimistic version checks.
Sessions, password hashing, CSRF/origin checks, throttling and revocation are server-side.

Node uses its built-in SQLite API. Runtime requires no installed npm packages. Data and backups
are ignored. Docker/Caddy files and online backup/restore instructions are provided for later
deployment. No server/domain was supplied or used. Nothing was committed, pushed or published.

See [the implementation record](../implementation.md) for verification and limitations, and
[the acceptance walkthrough](../acceptance.md) for the user's trial. Local app port is 4310;
the separate disposable browser fixture uses 4311. The real app intentionally starts without
default accounts or sample work, so the user chooses the first administrator credentials.

Final verification passed 17 tests on Windows and in the Linux image. Browser verification
covered the complete submission/revision/approval cycle, task creation/editing, title search,
status filtering, login/logout, mobile cards and menu behavior at 390 x 844. Online backup was
restored into a clean database. Compose parsed and Caddy validated; no public HTTPS deployment
ran. Docker Desktop bind mounts failed with an I/O error, so container checks used copied files.
The disposable preview was stopped and the clean real app was left open for the user on port 4310.

## Regression coverage and independent review, 2026-11-11

The initial app was committed as `f3f315a`. Data, backups and demo artifacts were excluded.
The follow-up added HTTP regressions and a Chromium suite that exercises the real RTL app with
isolated sessions and temporary databases. Playwright is a development dependency; the app still
runs without installing packages. `npm run verify` runs the syntax, Node and browser checks.

The independent agent reviewed the app and then reviewed the fixes. Production and configured
origins require CLI setup, including behind loopback proxies. Denied setup requests do not use
the login quota. Password changes recheck session authorization after hashing. New backups are
verified before publication and cannot restore login sessions. A disabled reviewer blocks new
submissions without freezing the task; disabling a reviewer after submission still requires
reactivation under the read-only review policy.

Browser regressions cover delayed saves and conflict responses, lost access after reassignment,
revoked sessions, refresh failures, task links, mobile navigation, escaped markup, and the full
revision cycle. The races were reproduced with controlled response ordering. Changes remained
local; no push or public deployment was requested.

Final verification on Windows passed the syntax checks, all 33 Node tests, all 15 Chromium
tests, and Compose configuration validation. No live deployment or physical-phone test ran.

## Task desk interface refresh, 2026-11-13

The owner asked for a more readable Persian interface and shorter paths through common tasks.
Dashboard counts now open their queues; the dashboard lists work with a next action first.
Assignees can start from a row in one click instead of opening the detail and confirming.
They can open and submit the result form from the list. Reviewers see the latest result
above the description, and assignees see current correction feedback in the same place.
Returning from a task restores the list's search, filters, expanded rows, scroll and focus.
The server still owns permissions, version checks, state transitions and history.

The interface uses a local Vazirmatn font, shared outline icons, larger Persian labels, a
compact dashboard and reduced motion support. `DESIGN.md` records the design and font source.
The [comparison viewer](../ui-comparison/index.html) pairs 12 before and after scenes using
the same disposable fixture and fixed dates. See [capture notes](../ui-comparison/README.md)
for baseline revision, roles, dimensions and reproduction commands. The preview stopped after
capture and did not use the user's data on port 4310.

`npm run verify` passed on Windows: syntax checks, 33 Node tests and 22 Chromium tests.
The added tests cover row actions and audited results, stale submission recovery, return
context across a long list, keyboard shortcuts, reduced motion and reviewer actions at a
320-pixel viewport. Two additional race tests verify that a pending start stays disabled after
search and viewport changes, and that its delayed response cannot restore access after
reassignment. The comparison viewer loaded all 24 images at matching dimensions, switched
between scenes and phases, fit a phone viewport, and raised no browser errors. Physical-phone
testing and public deployment were outside this work.
