import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server.mjs';
import { request as httpRequest } from 'node:http';

const newPassword = () => randomBytes(24).toString('base64url');
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: options.method, headers: options.headers, timeout: 10000 }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: new Headers(response.headers), json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.end(options.body);
  });
}
async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'taskmanager-test-'));
  const dbPath = join(folder, 'test.sqlite');
  let app;
  let base;
  async function start() {
    app = createApp({ dbPath });
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
  for (const extra of [{ title: '' }, { description: ' ' }, { assignee_id: f.reviewer.user.id }, { reviewer_id: 'missing' }, { due_date: '2026-02-30' }, { due_date: '2026-99-01' }, { due_date: 'invalid' }, { title: 'x'.repeat(201) }]) {
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

test('production refuses HTTP configuration and uses secure session cookies over HTTPS proxy origin', async t => {
  assert.throws(() => createApp({ dbPath: ':memory:', production: true }), /Production requires/);
  const app = createApp({ dbPath: ':memory:', production: true, origin: 'https://tasks.example.com' });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.store.close(); });
  const response = await request(`http://127.0.0.1:${app.server.address().port}/api/setup`, { method: 'POST', headers: { Host: 'tasks.example.com', Origin: 'https://tasks.example.com', 'X-Requested-With': 'TaskManager', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', name: 'Administrator', password: newPassword() }) });
  assert.equal(response.status, 200); assert.ok(response.headers.get('set-cookie').includes('__Host-taskmanager='));
  assert.ok(response.headers.get('set-cookie').includes('; Secure'));
  assert.ok(response.headers.get('set-cookie').includes('; HttpOnly'));
  assert.ok(response.headers.get('set-cookie').includes('SameSite=Strict'));
});
