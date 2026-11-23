import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/store.mjs';
import { request as httpRequest } from 'node:http';
import { testTaskTypes } from './fixtures/task-types.mjs';

const newPassword = () => randomBytes(24).toString('base64url');
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: options.method, headers: options.headers, timeout: 10000 }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, headers: new Headers(response.headers), text, json: async () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.end(options.body);
  });
}
async function fixture(t, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'taskmanager-test-'));
  const dbPath = join(folder, 'test.sqlite');
  let app;
  let base;
  async function start() {
    app = createApp({ dbPath, ...options });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  async function stop() { await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
  await start();
  t.after(async () => { await stop(); await rm(folder, { recursive: true, force: true }); });
  function client() {
    return {
      cookie: '', csrf: '', user: null,
      async request(path, method = 'GET', body, extras = {}) {
        const response = await request(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'TaskManager', Cookie: this.cookie, 'X-CSRF-Token': this.csrf, Origin: base, ...extras }, body: body === undefined ? undefined : JSON.stringify(body) });
        const value = await response.json();
        if (response.headers.has('set-cookie')) this.cookie = response.headers.get('set-cookie').split(';')[0];
        if (value.csrf) this.csrf = value.csrf;
        if (value.user && ['/setup', '/login', '/session'].includes(path)) this.user = value.user;
        return { status: response.status, value, headers: response.headers };
      }
    };
  }
  const admin = client();
  const adminPassword = newPassword();
  assert.equal((await admin.request('/setup', 'POST', { username: 'admin', name: 'Administrator', password: adminPassword })).status, 200);
  async function addUser(name, adminRole = false) {
    const password = newPassword();
    const result = await admin.request('/users', 'POST', { username: name, name, password, admin: adminRole });
    assert.equal(result.status, 201);
    const account = client();
    assert.equal((await account.request('/login', 'POST', { username: name, password })).status, 200);
    return { account, password, user: result.value.user };
  }
  const worker = await addUser('worker');
  const reviewer = await addUser('reviewer');
  const stranger = await addUser('stranger');
  async function task(creator = admin, overrides = {}) {
    const result = await creator.request('/tasks', 'POST', { title: 'Prepare report', description: 'Write the report and send it for review.', assignee_id: worker.user.id, reviewer_id: reviewer.user.id, due_date: '2026-12-20', ...overrides });
    assert.equal(result.status, 201, JSON.stringify(result.value));
    return result.value;
  }
  async function act(account, task, action, note = '') {
    return account.request(`/tasks/${task.id}/actions`, 'POST', { action, note, version: task.version });
  }
  return { admin, adminPassword, worker, reviewer, stranger, client, addUser, task, act, get store() { return app.store; }, restart: async () => { await stop(); await start(); }, get base() { return base; } };
}

function mobile(f, accessToken) {
  return async (path, method = 'GET', body, extras = {}) => {
    const headers = { ...extras };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await request(`${f.base}/api/v1${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { ...response, value: response.text ? await response.json() : null };
  };
}

async function mobileSignIn(f, username, password) {
  const signedIn = await mobile(f)('/session', 'POST', { username, password });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.headers.get('set-cookie'), null);
  assert.equal(signedIn.headers.get('cache-control'), 'no-store');
  assert.equal(signedIn.value.token_type, 'Bearer');
  assert.ok(Date.parse(signedIn.value.expires_at) > Date.now());
  assert.match(signedIn.value.access_token, /^tm_[A-Za-z0-9_-]{43}$/);
  return mobile(f, signedIn.value.access_token);
}

test('REST sessions use bearer credentials, survive restart, and support logout and account revocation', async t => {
  const f = await fixture(t);
  const anonymous = mobile(f);
  const worker = await mobileSignIn(f, 'worker', f.worker.password);
  assert.equal((await anonymous('/session', 'POST', { username: 'worker', password: f.worker.password }, { Origin: f.base })).status, 403);
  const cookie = f.worker.account.cookie;
  const cookieToken = cookie.split('=')[1];
  const missing = await anonymous('/session', 'GET', undefined, { Cookie: cookie, Authorization: `Bearer ${cookieToken}` });
  assert.equal(missing.status, 401);
  assert.equal(missing.value.code, 'unauthorized');
  assert.equal(missing.headers.get('www-authenticate'), 'Bearer');
  const second = await anonymous('/session', 'POST', { username: 'worker', password: f.worker.password });
  assert.equal(second.status, 200);
  assert.equal((await f.client().request('/tasks', 'GET', undefined, { Cookie: `taskmanager=${second.value.access_token}` })).status, 401);
  await f.restart();
  assert.deepEqual((await worker('/session')).value, { user: f.worker.user });
  assert.equal((await worker('/session', 'DELETE')).status, 204);
  assert.equal((await worker('/session')).status, 401);
  assert.equal((await f.worker.account.request('/tasks')).status, 200);
  const workerPhone = mobile(f, second.value.access_token);
  assert.equal((await workerPhone('/session')).status, 200);
  await f.admin.request(`/users/${f.worker.user.id}/password`, 'POST', { version: 1, password: newPassword() });
  assert.equal((await workerPhone('/session')).status, 401);
});

test('REST tasks expose permissions, partial edits, and paged filter results within the visible scope', async t => {
  const f = await fixture(t);
  const admin = await mobileSignIn(f, 'admin', f.adminPassword);
  const worker = await mobileSignIn(f, 'worker', f.worker.password);
  const reviewer = await mobileSignIn(f, 'reviewer', f.reviewer.password);
  const created = await admin('/tasks', 'POST', {
    title: 'First task', description: 'Write the report', assignee_id: f.worker.user.id,
    reviewer_id: f.reviewer.user.id, due_date: '2026-12-20'
  });
  assert.equal(created.status, 201);
  const first = created.value;
  assert.equal(created.headers.get('location'), `/api/v1/tasks/${first.id}`);
  assert.equal(first.type, 'standard');
  assert.deepEqual(first.fields, {});
  assert.deepEqual(first.allowed_actions, []);
  const taskPath = `/tasks/${first.id}`;
  assert.deepEqual((await worker(taskPath)).value.allowed_actions, ['start']);
  assert.equal((await worker(taskPath, 'PATCH', { version: 1, title: 'Wrong editor' })).status, 403);
  const edited = (await admin(taskPath, 'PATCH', { version: 1, title: 'Updated report' })).value;
  assert.equal(edited.title, 'Updated report');
  assert.equal(edited.due_date, first.due_date);
  assert.equal(edited.description, first.description);
  assert.equal((await admin(taskPath, 'PATCH', { version: 1, title: 'Lost update' })).value.code, 'stale_version');
  assert.equal((await worker(`${taskPath}/actions`, 'POST', { version: 2, action: 'start' })).status, 200);
  assert.equal((await worker(`${taskPath}/actions`, 'POST', { version: 3, action: 'submit', note: 'Result' })).status, 200);
  assert.equal((await admin(taskPath, 'PATCH', { version: 4, title: 'Frozen' })).value.code, 'task_locked');
  assert.equal((await admin(`${taskPath}/actions`, 'POST', { version: 4, action: 'approve' })).status, 403);
  assert.equal((await reviewer(`${taskPath}/actions`, 'POST', { version: 4, action: 'approve' })).status, 200);
  assert.deepEqual((await worker('/tasks?scope=assigned&status=done')).value.tasks.map(task => task.id), [first.id]);

  const second = await f.task(f.admin, { title: 'Second task' });
  await f.task(f.admin, { title: 'Private task', assignee_id: f.stranger.user.id });
  assert.deepEqual((await worker('/tasks?scope=created')).value, { tasks: [], next_cursor: null });
  const page = (await worker('/tasks?limit=1&type=standard')).value;
  assert.deepEqual(page.tasks.map(task => task.id), [second.id]);
  assert.ok(page.next_cursor);
  const last = (await worker(`/tasks?limit=1&type=standard&cursor=${page.next_cursor}`)).value;
  assert.deepEqual(last.tasks.map(task => task.id), [first.id]);
  assert.equal(last.next_cursor, null);
  assert.equal((await worker('/tasks?cursor=invalid')).value.code, 'invalid_cursor');
  for (const query of ['limit=101', 'limit=00', 'scope=all', 'status=unknown']) {
    assert.equal((await worker(`/tasks?${query}`)).status, 400);
  }
});

test('a registered task type has its own fields, states, permissions and immutable snapshots', async t => {
  const f = await fixture(t, { taskTypes: testTaskTypes });
  const admin = await mobileSignIn(f, 'admin', f.adminPassword);
  const worker = await mobileSignIn(f, 'worker', f.worker.password);
  const input = {
    type: 'delivery', title: 'Send package', description: 'Drop off today',
    assignee_id: f.worker.user.id, reviewer_id: f.reviewer.user.id
  };
  assert.equal((await admin('/task-types')).value.task_types.delivery.actions.deliver.to, 'delivered');
  assert.equal((await admin('/tasks', 'POST', { ...input, type: 'constructor' })).value.code, 'invalid_task_type');
  for (const fields of [{}, null, { tracking: 'X'.repeat(31) }, { tracking: 'ABC', extra: 'Invalid' }]) {
    assert.equal((await admin('/tasks', 'POST', { ...input, fields })).status, 400);
  }
  const created = await admin('/tasks', 'POST', { ...input, fields: { tracking: '  ABC  ', destination: 'Front desk' } });
  assert.equal(created.status, 201);
  assert.equal(created.value.status, 'awaiting_delivery');
  const taskPath = `/tasks/${created.value.id}`;
  assert.equal((await admin(taskPath, 'PATCH', { version: 1, type: 'standard' })).value.code, 'immutable_task_type');
  const edited = await admin(taskPath, 'PATCH', { version: 1, fields: { tracking: 'DEF' } });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.value.fields, { tracking: 'DEF' });
  assert.deepEqual(edited.value.events[1].snapshot.fields, { tracking: 'ABC', destination: 'Front desk' });
  await f.restart();
  assert.deepEqual((await worker(taskPath)).value.allowed_actions, ['deliver']);
  assert.equal((await worker(`${taskPath}/actions`, 'POST', { version: 2, action: 'start' })).status, 400);
  assert.equal((await worker(`${taskPath}/actions`, 'POST', { version: 2, action: 'deliver' })).status, 400);
  const done = await worker(`${taskPath}/actions`, 'POST', { version: 2, action: 'deliver', note: 'Signed for' });
  assert.equal(done.status, 200);
  assert.equal(done.value.status, 'delivered');
  assert.equal(done.value.events[0].note, 'Signed for');
  assert.deepEqual(done.value.allowed_actions, []);
  assert.equal((await admin(taskPath, 'PATCH', { version: 3, title: 'Frozen' })).value.code, 'task_locked');
  assert.equal((await admin('/tasks?type=delivery&status=done')).status, 400);
  assert.deepEqual((await admin('/tasks?type=delivery&status=delivered')).value.tasks.map(task => task.id), [created.value.id]);
});

test('complete review and repeated revision cycle preserves every result and snapshot', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  let task = await f.task();
  for (const [actor, action, note, expected] of [
    [f.worker.account, 'start', '', 'in_progress'],
    [f.worker.account, 'submit', 'First report', 'in_review'],
    [f.reviewer.account, 'request_changes', 'Add figures', 'changes_requested'],
    [f.worker.account, 'start', 'Updating figures', 'in_progress'],
    [f.worker.account, 'submit', 'Figures added', 'in_review'],
    [f.reviewer.account, 'request_changes', 'Explain sources', 'changes_requested'],
    [f.worker.account, 'submit', 'Sources included', 'in_review'],
    [f.reviewer.account, 'approve', 'Accepted', 'done']
  ]) {
    const result = await f.act(actor, task, action, note);
    assert.equal(result.status, 200); task = result.value; assert.equal(task.status, expected);
  }
  assert.equal(task.events.length, 9);
  assert.deepEqual(task.events.map(event => event.snapshot.version), [9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(task.events.find(event => event.note === 'First report').snapshot.status, 'in_review');
  assert.equal((await f.act(f.worker.account, task, 'start')).status, 409);
});

test('unrelated users cannot list, read, edit or act on a task', async t => {
  const f = await fixture(t); const task = await f.task();
  assert.equal((await f.stranger.account.request('/tasks')).value.tasks.length, 0);
  assert.equal((await f.stranger.account.request(`/tasks/${task.id}`)).status, 404);
  assert.equal((await f.stranger.account.request(`/tasks/${task.id}`, 'PATCH', { ...task })).status, 404);
  assert.equal((await f.act(f.stranger.account, task, 'start')).status, 404);
  assert.equal((await f.worker.account.request(`/tasks/${task.id}`)).status, 200);
  assert.equal((await f.reviewer.account.request(`/tasks/${task.id}`)).status, 200);
});

test('only the named assignee and reviewer may change workflow, including administrators', async t => {
  const f = await fixture(t); let task = await f.task();
  assert.equal((await f.act(f.admin, task, 'start')).status, 403);
  assert.equal((await f.act(f.reviewer.account, task, 'start')).status, 403);
  assert.equal((await f.act(f.worker.account, task, 'submit', 'Premature')).status, 409);
  task = (await f.act(f.worker.account, task, 'start')).value;
  assert.equal((await f.act(f.worker.account, task, 'submit', '   ')).status, 400);
  task = (await f.act(f.worker.account, task, 'submit', 'Finished')).value;
  assert.equal((await f.act(f.worker.account, task, 'approve')).status, 403);
  assert.equal((await f.act(f.admin, task, 'approve')).status, 403);
  assert.equal((await f.act(f.reviewer.account, task, 'request_changes', ' ')).status, 400);
  assert.equal((await f.act(f.reviewer.account, task, 'approve')).status, 200);
});

test('concurrent duplicate actions succeed once with a single history event', async t => {
  const f = await fixture(t); const task = await f.task();
  const results = await Promise.all([f.act(f.worker.account, task, 'start'), f.act(f.worker.account, task, 'start')]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const detail = (await f.admin.request(`/tasks/${task.id}`)).value;
  assert.equal(detail.version, 2); assert.equal(detail.events.length, 2);
  const staleEdit = await f.admin.request(`/tasks/${task.id}`, 'PATCH', { ...task, title: 'Stale edit' });
  assert.equal(staleEdit.status, 409);
  assert.equal((await f.admin.request(`/tasks/${task.id}`)).value.title, task.title);
});

test('edits record old and new assignments; review and completed tasks remain frozen', async t => {
  const f = await fixture(t); let task = await f.task(f.worker.account);
  assert.equal((await f.reviewer.account.request(`/tasks/${task.id}`, 'PATCH', task)).status, 403);
  task = (await f.worker.account.request(`/tasks/${task.id}`, 'PATCH', { ...task, title: 'Revised title', description: 'Revised details', reviewer_id: f.stranger.user.id })).value;
  assert.equal(task.events[1].snapshot.reviewer_id, f.reviewer.user.id);
  assert.equal(task.events[0].snapshot.reviewer_id, f.stranger.user.id);
  assert.equal((await f.reviewer.account.request(`/tasks/${task.id}`)).status, 404);
  task = (await f.act(f.worker.account, task, 'start')).value;
  task = (await f.act(f.worker.account, task, 'submit', 'Report')).value;
  assert.equal((await f.admin.request(`/tasks/${task.id}`, 'PATCH', task)).status, 409);
  task = (await f.act(f.stranger.account, task, 'approve')).value;
  assert.equal((await f.admin.request(`/tasks/${task.id}`, 'PATCH', task)).status, 409);
});

test('task fields, distinct active participants, dates and lengths are validated', async t => {
  const f = await fixture(t);
  const input = { title: 'Task', description: 'Description', assignee_id: f.worker.user.id, reviewer_id: f.reviewer.user.id };
  for (const extra of [{ title: '' }, { description: ' ' }, { assignee_id: f.reviewer.user.id }, { reviewer_id: 'missing' }, { due_date: '2026-02-30' }, { due_date: '2026-99-01' }, { due_date: 'invalid' }, { due_date: 0 }, { due_date: false }, { title: 'x'.repeat(201) }]) {
    assert.equal((await f.admin.request('/tasks', 'POST', { ...input, ...extra })).status, 400);
  }
  assert.equal((await f.admin.request('/tasks')).value.tasks.length, 0);
});

test('failed history write rolls back the state change', async t => {
  const f = await fixture(t); const task = await f.task();
  f.store.db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.equal((await f.act(f.worker.account, task, 'start')).status, 500);
  const detail = (await f.admin.request(`/tasks/${task.id}`)).value;
  assert.equal(detail.status, 'new'); assert.equal(detail.version, 1); assert.equal(detail.events.length, 1);
});

test('data, history and sessions survive a server restart', async t => {
  const f = await fixture(t); let task = await f.task();
  task = (await f.act(f.worker.account, task, 'start')).value;
  await f.restart();
  const result = await f.worker.account.request(`/tasks/${task.id}`);
  assert.equal(result.status, 200); assert.equal(result.value.events.length, 2); assert.equal(result.value.status, 'in_progress');
});

test('deactivation revokes every session, rejects assignment and preserves old history', async t => {
  const f = await fixture(t); const task = await f.task();
  const another = f.client(); await another.request('/login', 'POST', { username: 'worker', password: f.worker.password });
  assert.equal((await f.admin.request(`/users/${f.worker.user.id}`, 'PATCH', { ...f.worker.user, active: false })).status, 200);
  assert.equal((await f.worker.account.request('/tasks')).status, 401);
  assert.equal((await another.request('/tasks')).status, 401);
  assert.equal((await f.client().request('/login', 'POST', { username: 'worker', password: f.worker.password })).status, 401);
  assert.equal((await f.admin.request(`/tasks/${task.id}`)).value.events.length, 1);
  assert.equal((await f.admin.request('/tasks', 'POST', task)).status, 400);
});

test('account administration requires admin and retains an active administrator', async t => {
  const f = await fixture(t);
  assert.equal((await f.worker.account.request('/users', 'POST', { username: 'intruder', name: 'Intruder', password: newPassword() })).status, 403);
  assert.equal((await f.admin.request(`/users/${f.admin.user.id}`, 'PATCH', { ...f.admin.user, admin: false })).status, 400);
  assert.equal((await f.admin.request(`/users/${f.admin.user.id}`, 'PATCH', { ...f.admin.user, active: false })).status, 400);
  assert.equal((await f.admin.request('/users', 'POST', { username: 'WORKER', name: 'Duplicate', password: newPassword() })).status, 409);
  const directory = (await f.worker.account.request('/users')).value;
  assert.ok(directory.users.every(user => !('password' in user)));
  assert.ok(directory.directory.every(user => Object.keys(user).sort().join(',') === 'id,name'));
});

test('user updates reject stale versions; password reset invalidates existing sessions', async t => {
  const f = await fixture(t); const password = newPassword();
  assert.equal((await f.admin.request(`/users/${f.worker.user.id}/password`, 'POST', { version: 99, password })).status, 409);
  assert.equal((await f.admin.request(`/users/${f.worker.user.id}/password`, 'POST', { version: 1, password })).status, 200);
  assert.equal((await f.worker.account.request('/tasks')).status, 401);
  assert.equal((await f.client().request('/login', 'POST', { username: 'worker', password })).status, 200);
  assert.equal((await f.admin.request(`/users/${f.worker.user.id}`, 'PATCH', { ...f.worker.user, active: false })).status, 409);
});

test('passwords preserve spaces, change requires current password and logout revokes sessions', async t => {
  const f = await fixture(t); const password = ` ${newPassword()} `;
  assert.equal((await f.worker.account.request('/password', 'POST', { current_password: 'incorrect', password })).status, 400);
  assert.equal((await f.worker.account.request('/password', 'POST', { current_password: f.worker.password, password })).status, 200);
  assert.equal((await f.worker.account.request('/tasks')).status, 401);
  assert.equal((await f.worker.account.request('/login', 'POST', { username: 'worker', password })).status, 200);
  assert.equal((await f.worker.account.request('/logout', 'POST', {})).status, 200);
  assert.equal((await f.worker.account.request('/tasks')).status, 401);
});

test('CSRF, cross-origin and Host checks protect mutations and setup is one-time', async t => {
  const f = await fixture(t);
  assert.equal((await f.admin.request('/logout', 'POST', {}, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await f.admin.request('/logout', 'POST', {}, { Origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await f.admin.request('/logout', 'POST', {}, { 'X-Requested-With': '' })).status, 403);
  assert.equal((await f.admin.request('/session', 'GET', undefined, { Host: 'unrelated.example' })).status, 403);
  assert.equal((await f.client().request('/setup', 'POST', { username: 'newadmin', name: 'Name', password: newPassword() })).status, 409);
  const session = await f.admin.request('/session');
  assert.equal(session.status, 200); assert.equal(session.headers.get('x-frame-options'), 'DENY');
  assert.ok(session.headers.get('content-security-policy').includes("script-src 'self'"));
});

test('login throttling stops repeated guesses without exposing account existence', async t => {
  const f = await fixture(t); const anonymous = f.client();
  for (let i = 0; i < 10; i++) {
    const result = await anonymous.request('/login', 'POST', { username: 'absent', password: 'incorrect' });
    assert.equal(result.status, 401); assert.equal(result.value.error, 'نام کاربری یا رمز عبور نادرست است.');
  }
  assert.equal((await anonymous.request('/login', 'POST', { username: 'absent', password: 'incorrect' })).status, 429);
});

test('production blocks browser setup behind a loopback proxy and issues secure login cookies', async t => {
  assert.throws(() => createApp({ dbPath: ':memory:', production: true }), /Production requires/);
  const app = createApp({ dbPath: ':memory:', production: true, origin: 'https://tasks.example.com' });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.store.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const headers = { Host: 'tasks.example.com', Origin: 'https://tasks.example.com', 'X-Requested-With': 'TaskManager', 'Content-Type': 'application/json' };
  const password = newPassword();
  const credentials = { username: 'admin', name: 'Administrator', password };
  const setup = await request(`${base}/setup`, { method: 'POST', headers, body: JSON.stringify(credentials) });
  assert.equal(setup.status, 403);
  assert.equal(setup.headers.get('set-cookie'), null);
  // A forbidden setup request must never spend the shared login budget of a reverse proxy.
  for (let index = 0; index < 30; index++) {
    const denied = await request(`${base}/setup`, { method: 'POST', headers, body: JSON.stringify({ username: `blocked-${index}` }) });
    assert.equal(denied.status, 403);
  }
  const session = await (await request(`${base}/session`, { headers })).json();
  assert.equal(session.setupRequired, true);
  assert.equal(session.canSetup, false);
  app.store.addUser({ ...credentials, password: await hashPassword(password), admin: true }, true);
  const response = await request(`${base}/login`, { method: 'POST', headers, body: JSON.stringify(credentials) });
  assert.equal(response.status, 200); assert.ok(response.headers.get('set-cookie').includes('__Host-taskmanager='));
  assert.ok(response.headers.get('set-cookie').includes('; Secure'));
  assert.ok(response.headers.get('set-cookie').includes('; HttpOnly'));
  assert.ok(response.headers.get('set-cookie').includes('SameSite=Strict'));
});

test('a fresh server creates exactly one administrator when setup requests race', async t => {
  const { server, store } = createApp({ dbPath: ':memory:' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const before = await (await request(`${base}/api/session`)).json();
  assert.equal(before.setupRequired, true);
  assert.equal(before.user, null);
  const responses = await Promise.all(['first', 'second'].map(username => request(`${base}/api/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'TaskManager', Origin: base },
    body: JSON.stringify({ username, name: username, password: newPassword(), admin: false })
  })));
  assert.deepEqual(responses.map(result => result.status).sort(), [200, 409]);
  const winner = responses.find(result => result.status === 200);
  assert.equal((await winner.json()).user.admin, true);
  const cookie = winner.headers.get('set-cookie').split(';')[0];
  const roster = await request(`${base}/api/users`, { headers: { Cookie: cookie } });
  assert.equal(roster.status, 200);
  assert.equal((await roster.json()).users.length, 1);
  assert.equal((await (await request(`${base}/api/session`)).json()).setupRequired, false);
});

test('public assets support HEAD and do not expose source files or private APIs', async t => {
  const f = await fixture(t);
  for (const [path, mime] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/style.css', 'text/css']]) {
    const get = await request(`${f.base}${path}`);
    const head = await request(`${f.base}${path}`, { method: 'HEAD' });
    assert.equal(get.status, 200);
    assert.ok(get.text.length > 0);
    assert.ok(get.headers.get('content-type').startsWith(mime));
    assert.equal(get.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), get.headers.get('content-type'));
    assert.equal(head.text, '');
  }
  for (const path of ['/server.mjs', '/data/taskmanager.sqlite', '/%2e%2e/lib/store.mjs']) {
    assert.equal((await request(`${f.base}${path}`)).status, 404);
  }
  const task = await f.task();
  for (const path of ['/users', '/tasks', `/tasks/${task.id}`]) {
    assert.equal((await f.client().request(path)).status, 401);
  }
  assert.equal((await f.client().request('/tasks', 'POST', task)).status, 401);
});

test('JSON validation rejects malformed bodies without changing the task list', async t => {
  const f = await fixture(t);
  for (const [body, mediaType, status] of [
    ['{"title":', 'application/json', 400], ['null', 'application/json', 400],
    ['[]', 'application/json', 400], ['"task"', 'application/json', 400],
    ['{}', 'text/plain', 415], ['{}', 'application/x-www-form-urlencoded', 415]
  ]) {
    const response = await request(`${f.base}/api/tasks`, { method: 'POST', headers: {
      'Content-Type': mediaType, 'X-Requested-With': 'TaskManager', 'X-CSRF-Token': f.admin.csrf,
      Cookie: f.admin.cookie, Origin: f.base
    }, body });
    assert.equal(response.status, status, body);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.deepEqual((await f.admin.request('/tasks')).value.tasks, []);
});

test('the request body limit applies to both length-delimited and chunked JSON', async t => {
  const f = await fixture(t);
  const body = JSON.stringify({ title: 'Large request', padding: 'x'.repeat(70 * 1024) });
  for (const framing of [{ 'Content-Length': Buffer.byteLength(body) }, { 'Transfer-Encoding': 'chunked' }]) {
    const response = await request(`${f.base}/api/tasks`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Requested-With': 'TaskManager', 'X-CSRF-Token': f.admin.csrf,
      Cookie: f.admin.cookie, Origin: f.base, ...framing
    }, body });
    assert.equal(response.status, 413);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.deepEqual((await f.admin.request('/tasks')).value.tasks, []);
  await f.task();
});

test('logins rotate the previous session and CSRF tokens are bound to their session', async t => {
  const f = await fixture(t);
  const task = await f.task();
  const secondSession = f.client();
  assert.equal((await secondSession.request('/login', 'POST', { username: 'worker', password: f.worker.password })).status, 200);
  const originalCookie = f.worker.account.cookie;
  assert.equal((await f.worker.account.request(`/tasks/${task.id}/actions`, 'POST', { action: 'start', version: 1 }, { 'X-CSRF-Token': secondSession.csrf })).status, 403);
  assert.equal((await f.admin.request(`/tasks/${task.id}`)).value.version, 1);

  const login = await f.worker.account.request('/login', 'POST', { username: 'reviewer', password: f.reviewer.password });
  assert.equal(login.status, 200);
  assert.equal(login.value.user.id, f.reviewer.user.id);
  assert.notEqual(f.worker.account.cookie, originalCookie);
  assert.equal((await f.client().request('/tasks', 'GET', undefined, { Cookie: originalCookie })).status, 401);
  assert.equal((await secondSession.request('/tasks')).status, 200);

  const rotatedCookie = f.worker.account.cookie;
  const logout = await f.worker.account.request('/logout', 'POST', {});
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.client().request('/tasks', 'GET', undefined, { Cookie: rotatedCookie })).status, 401);
  assert.equal((await f.reviewer.account.request('/tasks')).status, 200);
});

test('an expired session cookie stays invalid across a restart and a fresh login', async t => {
  const f = await fixture(t);
  const oldCookie = f.worker.account.cookie;
  const raw = oldCookie.slice(oldCookie.indexOf('=') + 1);
  const hash = createHash('sha256').update(raw).digest('hex');
  assert.equal(f.store.db.prepare('UPDATE sessions SET expires_at = ? WHERE hash = ?').run('2000-01-01T00:00:00.000Z', hash).changes, 1);
  await f.restart();
  const expired = await f.worker.account.request('/session');
  assert.equal(expired.value.user, null);
  assert.equal(expired.value.csrf, undefined);
  assert.equal((await f.worker.account.request('/tasks')).status, 401);
  assert.equal((await f.worker.account.request('/login', 'POST', { username: 'worker', password: f.worker.password })).status, 200);
  assert.equal((await f.client().request('/tasks', 'GET', undefined, { Cookie: oldCookie })).status, 401);
});

test('task writes cannot impersonate creators or inject status, version or history', async t => {
  const f = await fixture(t);
  const forged = { creator_id: f.admin.user.id, status: 'done', version: 42, events: [{ action: 'approve' }] };
  const task = await f.task(f.stranger.account, forged);
  assert.equal(task.creator_id, f.stranger.user.id);
  assert.equal(task.status, 'new');
  assert.equal(task.version, 1);
  assert.deepEqual(task.events.map(event => [event.action, event.actor_id]), [['created', f.stranger.user.id]]);
  const next = await f.stranger.account.request(`/tasks/${task.id}`, 'PATCH', { ...task, ...forged, version: 1, title: 'Revised report' });
  assert.equal(next.status, 200);
  assert.equal(next.value.creator_id, f.stranger.user.id);
  assert.equal(next.value.status, 'new');
  assert.equal(next.value.version, 2);
  assert.deepEqual(next.value.events.map(event => event.action), ['edited', 'created']);
});

test('conflicting reviewer decisions persist only the winner and its note', async t => {
  const f = await fixture(t);
  const task = await f.task();
  const started = await f.act(f.worker.account, task, 'start');
  const submitted = await f.act(f.worker.account, started.value, 'submit', 'Initial result');
  assert.equal(submitted.status, 200);
  const decisions = await Promise.all([
    f.act(f.reviewer.account, submitted.value, 'approve', 'Looks good'),
    f.act(f.reviewer.account, submitted.value, 'request_changes', 'Improve the layout')
  ]);
  assert.deepEqual(decisions.map(result => result.status).sort(), [200, 409]);
  const winning = decisions.find(result => result.status === 200).value;
  const persisted = (await f.admin.request(`/tasks/${task.id}`)).value;
  assert.equal(persisted.version, submitted.value.version + 1);
  assert.equal(persisted.events.length, submitted.value.events.length + 1);
  assert.equal(persisted.status, winning.status);
  assert.equal(persisted.events[0].note, winning.status === 'done' ? 'Looks good' : 'Improve the layout');
});

test('reassigning both roles replaces access but preserves prior assignment snapshots', async t => {
  const f = await fixture(t);
  const substitute = await f.addUser('substitute');
  const task = await f.task();
  const response = await f.admin.request(`/tasks/${task.id}`, 'PATCH', { ...task, assignee_id: f.stranger.user.id, reviewer_id: substitute.user.id });
  assert.equal(response.status, 200);
  for (const previous of [f.worker.account, f.reviewer.account]) {
    assert.equal((await previous.request(`/tasks/${task.id}`)).status, 404);
    assert.deepEqual((await previous.request('/tasks')).value.tasks, []);
  }
  const detail = (await substitute.account.request(`/tasks/${task.id}`)).value;
  assert.equal(detail.events[1].snapshot.assignee_id, f.worker.user.id);
  assert.equal(detail.events[1].snapshot.reviewer_id, f.reviewer.user.id);
  assert.equal(detail.events[0].snapshot.assignee_id, f.stranger.user.id);
  assert.equal(detail.events[0].snapshot.reviewer_id, substitute.user.id);
  assert.equal((await f.act(f.stranger.account, response.value, 'start')).status, 200);
});

test('account reactivation permits a fresh login without restoring revoked sessions', async t => {
  const f = await fixture(t);
  const oldCookie = f.worker.account.cookie;
  const endpoint = `/users/${f.worker.user.id}`;
  const inactive = await f.admin.request(endpoint, 'PATCH', { ...f.worker.user, active: false });
  assert.equal(inactive.status, 200);
  const directory = (await f.reviewer.account.request('/users')).value;
  assert.ok(!directory.users.some(user => user.id === f.worker.user.id));
  assert.ok(directory.directory.some(user => user.id === f.worker.user.id));
  assert.equal((await f.admin.request(endpoint, 'PATCH', { ...inactive.value.user, active: true })).status, 200);
  assert.equal((await f.client().request('/tasks', 'GET', undefined, { Cookie: oldCookie })).status, 401);
  assert.equal((await f.worker.account.request('/login', 'POST', { username: 'WORKER', password: f.worker.password })).status, 200);
  assert.equal((await f.worker.account.request('/tasks')).status, 200);
});

test('concurrent administrator demotions cannot leave the workspace without an admin', async t => {
  const f = await fixture(t);
  const second = await f.addUser('second-admin', true);
  const results = await Promise.all([
    f.admin.request(`/users/${second.user.id}`, 'PATCH', { ...second.user, admin: false }),
    second.account.request(`/users/${f.admin.user.id}`, 'PATCH', { ...f.admin.user, admin: false })
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  const surviving = results[0].status === 200 ? f.admin : second.account;
  const roster = (await surviving.request('/users')).value.users;
  assert.deepEqual(roster.filter(user => user.active && user.admin).map(user => user.id), [surviving.user.id]);
});

test('revoking a session during password verification prevents the credential change', async t => {
  const f = await fixture(t);
  const raw = f.worker.account.cookie.split('=')[1];
  const session = f.store.session.bind(f.store);
  let intercepted = false;
  // Revoke between the request's initial authorization and the async password check.
  f.store.session = function (value) {
    const user = session(value);
    if (value === raw && user && !intercepted) {
      intercepted = true;
      queueMicrotask(() => this.logout(raw));
    }
    return user;
  };
  const attemptedPassword = newPassword();
  const result = await f.worker.account.request('/password', 'POST', { current_password: f.worker.password, password: attemptedPassword });
  assert.equal(intercepted, true);
  assert.equal(result.status, 401);
  assert.equal((await f.client().request('/login', 'POST', { username: 'worker', password: attemptedPassword })).status, 401);
  assert.equal((await f.client().request('/login', 'POST', { username: 'worker', password: f.worker.password })).status, 200);
});

test('submission to a disabled reviewer leaves the task editable for reassignment', async t => {
  const f = await fixture(t);
  const task = await f.task();
  const started = (await f.act(f.worker.account, task, 'start')).value;
  assert.equal((await f.admin.request(`/users/${f.reviewer.user.id}`, 'PATCH', { ...f.reviewer.user, active: false })).status, 200);
  const result = await f.act(f.worker.account, started, 'submit', 'Completed result');
  assert.equal(result.status, 409);
  const current = (await f.admin.request(`/tasks/${task.id}`)).value;
  assert.equal(current.status, 'in_progress');
  assert.equal(current.version, started.version);
  assert.equal(current.events.length, started.events.length);
  const reassigned = await f.admin.request(`/tasks/${task.id}`, 'PATCH', { ...current, reviewer_id: f.stranger.user.id });
  assert.equal(reassigned.status, 200);
  const submitted = await f.act(f.worker.account, reassigned.value, 'submit', 'Completed result');
  assert.equal(submitted.status, 200);
  assert.equal((await f.act(f.stranger.account, submitted.value, 'approve')).status, 200);
});

test('unknown actions including prototype names are rejected without advancing the task', async t => {
  const f = await fixture(t);
  const task = await f.task();
  for (const action of ['cancel', 'toString', 'constructor', '__proto__']) {
    assert.equal((await f.act(f.worker.account, task, action)).status, 400, action);
  }
  const current = (await f.worker.account.request(`/tasks/${task.id}`)).value;
  assert.equal(current.version, 1);
  assert.equal(current.events.length, 1);
});
