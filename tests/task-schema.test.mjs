import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Store, digest, token } from '../lib/store.mjs';
import { testTaskTypes } from './fixtures/task-types.mjs';

test('opening a version 1 database migrates tasks and keeps snapshots and sessions', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'taskmanager-migration-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'legacy.sqlite');
  const stamp = '2026-11-01T00:00:00.000Z';
  const snapshot = {
    id: 'task-id', title: 'Old task', description: 'Old description', creator_id: 'creator',
    assignee_id: 'creator', reviewer_id: 'reviewer', status: 'in_review', due_date: null,
    version: 2, created_at: stamp, updated_at: stamp
  };
  const originalSnapshot = JSON.stringify(snapshot);
  const browserToken = token();
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        csrf TEXT NOT NULL, expires_at TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        creator_id TEXT NOT NULL REFERENCES users(id), assignee_id TEXT NOT NULL REFERENCES users(id),
        reviewer_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'new'
          CHECK(status IN ('new','in_progress','in_review','changes_requested','done')),
        due_date TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK(assignee_id != reviewer_id)
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id),
        actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '', snapshot TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX task_assignee ON tasks(assignee_id, updated_at);
      CREATE INDEX task_reviewer ON tasks(reviewer_id, status);
      CREATE INDEX task_creator ON tasks(creator_id);
      CREATE INDEX event_task ON events(task_id, id);
      CREATE INDEX session_expiry ON sessions(expires_at);
      PRAGMA user_version = 1;
    `);
    const user = legacy.prepare('INSERT INTO users (id,username,name,password,created_at) VALUES (?,?,?,?,?)');
    for (const name of ['creator', 'reviewer']) user.run(name, name, name, 'unused', stamp);
    legacy.prepare('INSERT INTO sessions VALUES (?,?,?,?)')
      .run(digest(browserToken), 'reviewer', token(), new Date(Date.now() + 3600000).toISOString());
    legacy.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(snapshot));
    legacy.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?)')
      .run(7, snapshot.id, 'creator', 'submit', 'Original review note', originalSnapshot, stamp);
  } finally {
    legacy.close();
  }

  const store = new Store(path);
  try {
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(store.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(store.db.prepare('SELECT snapshot FROM events WHERE id=7').get().snapshot, originalSnapshot);
    const reviewer = store.session(browserToken);
    assert.equal(reviewer.id, 'reviewer');
    const task = store.detail(snapshot.id, reviewer);
    assert.equal(task.type, 'standard');
    assert.equal(task.version, 2);
    assert.equal(task.events[0].note, 'Original review note');
    assert.deepEqual(task.events[0].snapshot, { ...snapshot, type: 'standard', fields: {} });
    const approved = store.transition(task.id, reviewer, { action: 'approve', version: 2, note: '' });
    assert.equal(approved.status, 'done');
    assert.deepEqual(approved.events.map(event => event.id), [8, 7]);
  } finally {
    store.close();
  }
  const reopened = new Store(path);
  try { assert.equal(reopened.detail(snapshot.id, reopened.session(browserToken)).status, 'done'); }
  finally { reopened.close(); }
});

test('task type definitions reject transitions from terminal states and assignee actions in review', () => {
  for (const status of ['delivered', 'waiting_for_recipient']) {
    const types = structuredClone(testTaskTypes);
    types.delivery.statuses.waiting_for_recipient = { label: 'Waiting for recipient', review: true };
    types.delivery.actions.deliver.from = [status];
    assert.throws(() => new Store(':memory:', types), /Invalid task type definition: delivery.actions.deliver/);
  }
});
