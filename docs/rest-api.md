# Native REST API

Native apps use JSON routes under `/api/v1` on the same server as the web app. Use HTTPS
outside local development. Send JSON bodies with `Content-Type: application/json`, and let
the client send requests without an `Origin` header. The server checks the request host
against its configured address. The browser interface uses its own cookie-based routes.

## Sign in and sign out

`POST /api/v1/session` accepts `{"username":"employee","password":"YOUR_PASSWORD"}`.
The response contains `user`, `access_token`, `token_type` (always `Bearer`) and
`expires_at` (UTC). Store the token in the device's secure credential storage and send it
as `Authorization: Bearer YOUR_ACCESS_TOKEN`.

`GET /api/v1/session` returns `{ "user": ... }`. `DELETE /api/v1/session` signs out the
current device and returns 204 with an empty body. Sessions last 12 hours and the client
signs in again when a token expires. Password changes, password resets and account access
changes revoke existing sessions. Each account is created by a system administrator.

## Read and write tasks

All routes in the table start with `/api/v1`.

| Method and path | Request and response |
| --- | --- |
| `GET /task-types` | Returns `default_type` and the `task_types` catalog, keyed by type ID. |
| `GET /tasks` | Returns `tasks` and `next_cursor`. Supports the filters below. |
| `POST /tasks` | Creates a task. Returns 201 with task details and a `Location` header. |
| `GET /tasks/{id}` | Returns task details with an `events` array, newest first. |
| `PATCH /tasks/{id}` | Updates editable fields on a task and returns task details. |
| `POST /tasks/{id}/actions` | Records a workflow action and returns task details. |
| `GET /users` | Returns `users` for the assignment picker and `directory` for looking up names. |
| `POST /password` | Changes your password using `current_password` and `password`. Returns `{ "ok": true }`. Sign in again afterward. |
| `POST /users` | Admin only. Takes `username`, `name`, `password` and optional `admin`. Returns 201 with `{ "user": ... }`. |
| `PATCH /users/{id}` | Admin only. Takes `name`, boolean `active` and `admin`, and `version`. Returns `{ "user": ... }`. |
| `POST /users/{id}/password` | Admin only. Takes `password` and the user's `version`. Returns `{ "ok": true }`. |

A user has `id`, `username`, `name`, `admin`, `active` and `version`. Administrators
receive all accounts in `users`. Other users receive active accounts. Each `directory`
entry contains `id` and `name`, including inactive accounts that still appear in history.

Task lists include only tasks visible to the signed-in user. List parameters are
`type`, `status`, `scope` (`assigned`, `reviewing` or `created`), `limit` (1 to 100,
default 50) and `cursor`. Role filters are relative to the signed-in user, even for admins.
Lists are sorted newest by creation time, then descending by ID. Continue with the same
filters and the returned `next_cursor`. A null cursor marks the end. Other users may
change task visibility and status between page requests.

A task contains `id`, `type`, `title`, `description`, `creator_id`, `assignee_id`,
`reviewer_id`, `status`, `due_date`, `version`, `created_at`, `updated_at` and `fields`.
Dates are ISO 8601, with UTC timestamps and a date-only due date. The task also includes
`can_edit`, `allowed_actions` (action IDs currently available to the requester) and
`blocked_actions` (objects with `action`, `code` and `message` for actions blocked by an
inactive reviewer). Use the catalog for labels, field requirements and action note requirements.
Each event has `id`, `task_id`, `actor_id`, `actor_name`, `action`, `note`, `created_at`
and `snapshot` with the task data saved when the event was recorded.

For creation, supply `title`, `description`, `assignee_id` and `reviewer_id`.
The participants must be different active users. You can also send `due_date` as
`YYYY-MM-DD` or null, `type` (defaults to `standard`) and `fields` as an object with the
type's text fields. The server sets the initial status and version.

For an edit, include the current `version` and any of `title`, `description`,
`assignee_id`, `reviewer_id`, `due_date` or `fields`. A null due date clears it.
If you include `fields`, supply the complete object. If you omit it, the existing object
is preserved. The type is fixed at creation.

For a workflow action, send the action ID and the task version, for example
`{"action":"submit","version":2,"note":"The report is ready."}`. The server checks the user,
current state and note requirements before recording the action and history in one transaction.
An administrator can approve only a task on which they are the designated reviewer.

## Handle errors

Error responses contain a machine-readable `code` and a human-readable Persian `error`.
Unexpected server errors use `internal_error`. Invalid input returns 400, an expired or
revoked session returns 401, and forbidden operations return 403. Task requests return 404
when the task is missing or outside the requester's visibility. Login limits return 429.

A 409 can include `stale_version`, `task_locked`, `invalid_transition` or
`reviewer_inactive`. Fetch the current task when its version is stale, preserve any draft
text, and let the user decide whether to retry against that version. A 409 from an account
operation uses `conflict`.
