# Hamkar Task Manager

A standalone company task app with a Persian, right-to-left interface for phones and computers.
Every task has a creator, an assignee and a separate reviewer. The assignee submits a result;
the reviewer approves it or returns it with a reason. Each round stays in the task history.

Hamkar was built as part of a program to create software with AI in fewer than five prompts.

The [prompt log](prompts.md) includes the original planning and implementation requests
and later prompts for testing, improving the interface, and publishing the app.

Hamkar uses Node.js 24.13 or newer, the built-in SQLite database and plain browser JavaScript.
Running the app does not require installing npm packages or building assets.

## Start on this computer

Open a terminal in this folder and run:

```powershell
npm start
```

Open [the local app](http://127.0.0.1:4310). On the first visit, create the administrator account
with a password of at least 12 characters. Browser setup is available on loopback with the
default local configuration and closes once the first account exists. If `APP_ORIGIN` is set
or the app runs in production, initialize it on the server with `node scripts/setup.mjs`.
No account or default password ships with the app.

In the team page, create accounts for your colleagues. An administrator can assign themselves
to a task, but each task still needs two different people as assignee and reviewer. Use separate
browser profiles or an incognito window to try the workflow with two accounts.

The default database is `data/taskmanager.sqlite`. Restarting the app preserves users, tasks,
history and unexpired sessions. Keep the whole data directory on persistent local disk. Do not
put it on a shared network drive or run multiple application replicas against it.

The server only accepts loopback hosts by default. For a trusted LAN trial, set `BIND=0.0.0.0`
and `APP_ORIGIN=http://YOUR-LAN-IP:4310` before starting, then use that same address from every
device. Initialize the administrator on loopback first. HTTP is for local testing; use the
HTTPS deployment below for normal company use. No firewall rules are changed by the app.

## Work with tasks

Create a task with its title, expected result, assignee and reviewer. An optional due date is
entered in Gregorian form; the interface displays dates in the Persian calendar and times in
the browser's local timezone.

| State | Allowed action | Who |
| --- | --- | --- |
| Ready | Start work | Assignee |
| In progress | Submit a written result | Assignee |
| In review | Approve, or request changes with a reason | Reviewer |
| Changes requested | Start corrections or submit a corrected result | Assignee |
| Completed | Read details and history | Authorized viewers |

The creator, assignee and reviewer can see a task. Administrators can see all tasks and edit
unlocked tasks, but administration alone does not allow starting, submitting or approving them.
Unrelated users cannot read a task even if they know its URL. Only the creator or an administrator
can edit the title, description, due date and assignments. Edits record a new snapshot in history.

If a reviewer is inactive when you submit, the task stays editable so its creator or an
administrator can assign an active reviewer. Tasks already in review and completed tasks are
read-only. If a reviewer is disabled after submission, an administrator can reactivate that
account to finish the review. Completed tasks cannot be reopened or deleted.

Select a count on the dashboard to open your tasks, pending reviews, revision requests or
completed work. The dashboard puts tasks with an action for you first. Start a ready task or
open the result form directly from its row. A task returned for changes opens with the reviewer's
note; a task in review opens with the latest result and the reviewer's decision buttons.

Search by title or open Filters to narrow the list by status and people. When you open a task
from a list, Back to tasks restores the search, filters and your place in the list. On a desktop
keyboard, Alt+F focuses task search and Alt+N opens the new task form where available. Refresh
retrieves the latest changes. There is no background synchronization or offline editing.

Each change includes the task's version. A stale action is rejected instead of overwriting a
colleague's change. The app retrieves the current task while keeping your unsaved form open.
Copy any text you want to keep, close the form and reopen the action against the new version.

## Accounts

Administrators can create accounts, edit names, grant administration, disable accounts and reset
passwords. Disabling an account or changing its permissions ends all of its existing sessions.
Its task history remains available. At least one active administrator must remain, and you
cannot disable your own account.

Anyone can change their own password from Account by entering their current password. Password
changes end all sessions for that user, so sign in again afterward. Password recovery goes through
an administrator. There is no public registration or email reset flow.

Sessions last 12 hours. Passwords are stored as salted scrypt hashes. Session tokens are random
and stored as hashes. The browser uses HttpOnly, SameSite=Strict cookies, with Secure on HTTPS.
Mutations require the session's CSRF token and a same-origin request. Login attempts are limited
per account and connection address for 15 minutes. Behind Caddy the connection limit is shared
by all users, with 30 attempts per 15 minutes, so use this version for a small team.

## Mobile API and task types

Native clients can sign in and work with tasks through the [versioned REST API](docs/rest-api.md).
The browser and native apps use the same task permissions, workflow and history.

See [task types](docs/task-types.md) to add a kind of task with its own fields and workflow or
change the existing one.

## Run the tests

```powershell
npm run check
npm test
```

To run the browser tests as well, install the development dependencies and Chromium headless
shell once. The browser tests start isolated local servers with temporary databases.

```powershell
npm ci
npx playwright install chromium --only-shell
npm run verify
```

## Back up and restore

```powershell
npm run backup
```

Backup uses SQLite's online backup operation and checks the resulting database integrity. The
output goes into `backups/`. Copy verified backups to a separate restricted location and schedule
the command with your operating system's scheduler. The app does not install scheduled jobs.

To restore, stop the application and preserve its current data directory as a separate recovery
copy. Create a clean data directory, copy the chosen backup into it as `taskmanager.sqlite`, then
start the app with that directory. Do not mix a restored database with old `-wal` or `-shm` files.
Backups contain account hashes and task contents, so protect them like the live database.
New backups exclude sessions. Users sign in again after a restore. If you must restore a
backup made before sessions were excluded, clear its sessions before starting the app; see
[the restore instructions](docs/deployment.md#persistent-storage-and-backup).

See [deployment](docs/deployment.md) for Docker, HTTPS, backups and updates, and
[the acceptance walkthrough](docs/acceptance.md) for a first team test.

## Scope

This version supports online task review for one company. Attachments, email/SMS notifications,
subtasks, recurring tasks, multiple organizations, SSO and advanced reporting are outside its
scope. Phone-sized browser layouts are supported; it is not a native mobile app.
