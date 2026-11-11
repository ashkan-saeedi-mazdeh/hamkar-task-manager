import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Store, hashPassword, token, verifyPassword } from '../lib/store.mjs';

const exec = promisify(execFile);
test('online backup restores users, tasks and history into a clean database', { timeout: 20000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'taskmanager-backup-'));
  const dbPath = join(folder, 'source.sqlite');
  const backups = join(folder, 'backups');
  const store = new Store(dbPath);
  let restored;
  t.after(async () => { restored?.close(); store.close(); await rm(folder, { recursive: true, force: true }); });
  const password = await hashPassword(token());
  const creator = store.addUser({ username: 'creator', name: 'Creator', password, admin: true }, true);
  const reviewer = store.addUser({ username: 'reviewer', name: 'Reviewer', password });
  let task = store.createTask(creator, { title: 'Backup task', description: 'A durable result', assignee_id: creator.id, reviewer_id: reviewer.id, due_date: null });
  task = store.transition(task.id, creator, { action: 'start', note: 'Work started', version: 1 });
  const result = await exec(process.execPath, [fileURLToPath(new URL('../scripts/backup.mjs', import.meta.url))], { env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backups }, timeout: 10000 });
  assert.match(result.stdout, /Verified backup:/);
  const files = await readdir(backups);
  assert.equal(files.length, 1);
  const restoredPath = join(folder, 'restored.sqlite');
  await copyFile(join(backups, files[0]), restoredPath);
  restored = new Store(restoredPath);
  const detail = restored.detail(task.id, creator);
  assert.equal(detail.events.length, 2); assert.equal(detail.status, 'in_progress');
  assert.equal(restored.user(creator.id).username, 'creator');
  assert.equal(Object.values(restored.db.prepare('PRAGMA integrity_check').get())[0], 'ok');
});

test('a restored backup cannot revive login sessions and still accepts a fresh sign-in', { timeout: 20000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'taskmanager-backup-session-'));
  const dbPath = join(folder, 'source.sqlite');
  const backups = join(folder, 'backups');
  const store = new Store(dbPath);
  let restored;
  t.after(async () => { restored?.close(); store.close(); await rm(folder, { recursive: true, force: true }); });
  const password = token();
  const user = store.addUser({ username: 'admin', name: 'Administrator', password: await hashPassword(password), admin: true }, true);
  const old = store.createSession(user.id);
  await exec(process.execPath, [fileURLToPath(new URL('../scripts/backup.mjs', import.meta.url))], { env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backups }, timeout: 10000 });
  assert.equal(store.session(old.raw).id, user.id, 'backup must leave the live session intact');
  store.logout(old.raw);

  const [file] = await readdir(backups);
  const restoredPath = join(folder, 'restored.sqlite');
  await copyFile(join(backups, file), restoredPath);
  restored = new Store(restoredPath);
  assert.ok(!restored.session(old.raw), 'restoring the backup must not undo logout');
  assert.ok(await verifyPassword(password, restored.userByName('admin').password));
  const fresh = restored.createSession(user.id);
  assert.equal(restored.session(fresh.raw).id, user.id);
});

test('a failed backup leaves no downloadable partial database', { timeout: 20000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'taskmanager-backup-invalid-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const dbPath = join(folder, 'unrelated.sqlite');
  const backups = join(folder, 'backups');
  const unrelated = new DatabaseSync(dbPath);
  try { unrelated.exec('CREATE TABLE unrelated (name TEXT)'); } finally { unrelated.close(); }
  await assert.rejects(exec(process.execPath, [fileURLToPath(new URL('../scripts/backup.mjs', import.meta.url))], { env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backups }, timeout: 10000 }), /no such table: sessions/);
  assert.deepEqual(await readdir(backups), []);
});
