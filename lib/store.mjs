import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError, field, requireThat } from './validation.mjs';
import {
  actionProblem, DEFAULT_TASK_TYPE, editAllowed, INACTIVE_REVIEWER, statusLocked,
  TASK_TYPES, taskFields, taskInput, taskType, validateTaskTypes
} from './task-types.mjs';

const scrypt = promisify(scryptCallback);
export const now = () => new Date().toISOString();
export const token = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const publicUser = user => user && ({ id: user.id, username: user.username, name: user.name, admin: !!user.admin, active: !!user.active, version: user.version });

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(':');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}

function storedTask(row) {
  return { ...row, fields: JSON.parse(row.fields) };
}

export class Store {
  constructor(path, taskTypes = TASK_TYPES) {
    validateTaskTypes(taskTypes);
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.taskTypes = taskTypes;
    try {
      if (path !== ':memory:') chmodSync(path, 0o600);
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000');
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  migrate() {
    // SQLite requires foreign keys to be off outside the transaction when rebuilding a parent table.
    this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      this.transaction(() => {
        const schema = this.db.prepare('PRAGMA user_version').get().user_version;
        if (![0, 1, 2].includes(schema)) throw new Error(`Unsupported database version: ${schema}`);
        if (schema === 0) this.initializeSchema();
        if (schema < 2) this.migrateTaskTypes();
        for (const { type, status } of this.db.prepare('SELECT DISTINCT type, status FROM tasks').iterate()) {
          if (!Object.hasOwn(this.taskTypes, type) || !Object.hasOwn(this.taskTypes[type].statuses, status)) {
            throw new Error(`Missing task type or status definition: ${type}/${status}`);
          }
        }
      });
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON');
    }
  }
  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        csrf TEXT NOT NULL, expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        creator_id TEXT NOT NULL REFERENCES users(id), assignee_id TEXT NOT NULL REFERENCES users(id),
        reviewer_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'new'
          CHECK(status IN ('new','in_progress','in_review','changes_requested','done')),
        due_date TEXT, version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK(assignee_id != reviewer_id)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id),
        actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '', snapshot TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS task_assignee ON tasks(assignee_id, updated_at);
      CREATE INDEX IF NOT EXISTS task_reviewer ON tasks(reviewer_id, status);
      CREATE INDEX IF NOT EXISTS task_creator ON tasks(creator_id);
      CREATE INDEX IF NOT EXISTS event_task ON events(task_id, id);
      CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
      PRAGMA user_version = 1;
    `);
  }
  migrateTaskTypes() {
    this.db.exec(`
      CREATE TABLE tasks_v2 (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        creator_id TEXT NOT NULL REFERENCES users(id), assignee_id TEXT NOT NULL REFERENCES users(id),
        reviewer_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL,
        due_date TEXT, version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        type TEXT NOT NULL, fields TEXT NOT NULL CHECK(json_valid(fields) AND json_type(fields) = 'object'),
        CHECK(assignee_id != reviewer_id)
      );
      INSERT INTO tasks_v2 (id,title,description,creator_id,assignee_id,reviewer_id,status,due_date,version,created_at,updated_at,type,fields)
        SELECT id,title,description,creator_id,assignee_id,reviewer_id,status,due_date,version,created_at,updated_at,'standard','{}' FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_v2 RENAME TO tasks;
      CREATE INDEX task_assignee ON tasks(assignee_id, updated_at);
      CREATE INDEX task_reviewer ON tasks(reviewer_id, status);
      CREATE INDEX task_creator ON tasks(creator_id);
      CREATE INDEX task_created ON tasks(created_at, id);
      PRAGMA user_version = 2;
    `);
    if (this.db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Task migration failed its foreign key check');
  }
  transaction(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  user(id) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
  userByName(name) { return this.db.prepare('SELECT * FROM users WHERE username = ?').get(name); }
  needsSetup() { return this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0; }
  users(admin) {
    return this.db.prepare(`SELECT * FROM users ${admin ? '' : 'WHERE active = 1'} ORDER BY name`).all().map(publicUser);
  }
  addUser({ username, name, password, admin = false }, initial = false) {
    return this.transaction(() => {
      if (initial) requireThat(this.needsSetup(), 409, 'راه‌اندازی اولیه قبلا انجام شده است.');
      requireThat(!this.userByName(username), 409, 'این نام کاربری قبلا استفاده شده است.');
      const id = crypto.randomUUID();
      this.db.prepare('INSERT INTO users (id,username,name,password,admin,created_at) VALUES (?,?,?,?,?,?)')
        .run(id, username, name, password, admin ? 1 : 0, now());
      return publicUser(this.user(id));
    });
  }
  updateUser(id, actor, input) {
    return this.transaction(() => {
      const user = this.user(id);
      requireThat(user, 404, 'کاربر پیدا نشد.');
      requireThat(user.version === input.version, 409, 'اطلاعات کاربر تغییر کرده است. صفحه را تازه کنید.');
      requireThat(id !== actor.id || input.active, 400, 'نمی‌توانید حساب خودتان را غیرفعال کنید.');
      if (user.admin && user.active && (!input.admin || !input.active)) {
        const count = this.db.prepare('SELECT COUNT(*) AS count FROM users WHERE active=1 AND admin=1').get().count;
        requireThat(count > 1, 400, 'حداقل یک مدیر سیستم فعال باید باقی بماند.');
      }
      this.db.prepare('UPDATE users SET name=?, active=?, admin=?, version=version+1 WHERE id=?')
        .run(input.name, +input.active, +input.admin, id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      return publicUser(this.user(id));
    });
  }
  createSession(userId, native = false) {
    const raw = native ? `tm_${token()}` : token();
    const csrf = token();
    const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(raw), userId, csrf, expires);
    return { raw, csrf, expires };
  }
  session(raw) {
    if (!raw) return null;
    return this.db.prepare(`SELECT users.*, sessions.csrf FROM sessions JOIN users ON users.id=sessions.user_id
      WHERE sessions.hash=? AND sessions.expires_at>? AND users.active=1`).get(digest(raw), now()) ?? null;
  }
  logout(raw) { if (raw) this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(raw)); }
  setPassword(id, password) {
    this.transaction(() => {
      this.db.prepare('UPDATE users SET password=?,version=version+1 WHERE id=?').run(password, id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    });
  }
  visible(task, user) { return user.admin || [task.creator_id, task.assignee_id, task.reviewer_id].includes(user.id); }
  task(id, user) {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    requireThat(task && this.visible(task, user), 404, 'کار پیدا نشد یا به آن دسترسی ندارید.');
    return storedTask(task);
  }
  listTasks(user) {
    const where = user.admin ? '' : 'WHERE creator_id=? OR assignee_id=? OR reviewer_id=?';
    const rows = this.db.prepare(`SELECT * FROM tasks ${where} ORDER BY updated_at DESC, id`).all(...(user.admin ? [] : [user.id, user.id, user.id]));
    return this.taskSummaries(rows, user);
  }
  taskPage(user, { type, status, scope, cursor, limit }) {
    const filters = [];
    const values = [];
    if (!user.admin) {
      filters.push('(creator_id=? OR assignee_id=? OR reviewer_id=?)');
      values.push(user.id, user.id, user.id);
    }
    if (type) { filters.push('type=?'); values.push(type); }
    if (status) { filters.push('status=?'); values.push(status); }
    const scopeColumn = { assigned: 'assignee_id', reviewing: 'reviewer_id', created: 'creator_id' };
    if (scope) { filters.push(`${scopeColumn[scope]}=?`); values.push(user.id); }
    if (cursor) { filters.push('(created_at, id) < (?, ?)'); values.push(...cursor); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...values, limit + 1);
    return { tasks: this.taskSummaries(rows.slice(0, limit), user), hasMore: rows.length > limit };
  }
  taskSummaries(rows, user) {
    const reviewers = new Map();
    return rows.map(row => {
      if (!reviewers.has(row.reviewer_id)) reviewers.set(row.reviewer_id, !!this.user(row.reviewer_id)?.active);
      return this.taskSummary(storedTask(row), user, reviewers.get(row.reviewer_id));
    });
  }
  taskSummary(task, user, reviewerActive = !!this.user(task.reviewer_id)?.active) {
    const type = taskType(this.taskTypes, task.type);
    const locked = statusLocked(type.statuses[task.status]);
    const allowed_actions = [];
    const blocked_actions = [];
    for (const [action, rule] of Object.entries(type.actions)) {
      if (actionProblem(rule, task, user)) continue;
      if (type.statuses[rule.to].review && !reviewerActive) blocked_actions.push({ action, ...INACTIVE_REVIEWER });
      else allowed_actions.push(action);
    }
    return { ...task, can_edit: editAllowed(task, user) && !locked, allowed_actions, blocked_actions };
  }
  detail(id, user) {
    const task = this.task(id, user);
    const events = this.db.prepare(`SELECT events.*, users.name AS actor_name FROM events JOIN users
      ON users.id=events.actor_id WHERE task_id=? ORDER BY events.id DESC`).all(id)
      .map(event => ({ ...event, snapshot: { type: DEFAULT_TASK_TYPE, fields: {}, ...JSON.parse(event.snapshot) } }));
    return { ...this.taskSummary(task, user), events };
  }
  validatePeople(input) {
    requireThat(input.assignee_id !== input.reviewer_id, 400, 'انجام‌دهنده و مدیر پیگیری باید دو نفر متفاوت باشند.');
    for (const id of [input.assignee_id, input.reviewer_id]) {
      requireThat(this.user(id)?.active, 400, 'مسئولان کار باید حساب فعال داشته باشند.');
    }
  }
  event(task, actorId, action, note = '') {
    this.db.prepare('INSERT INTO events (task_id,actor_id,action,note,snapshot,created_at) VALUES (?,?,?,?,?,?)')
      .run(task.id, actorId, action, note, JSON.stringify(task), now());
  }
  createTask(user, input) {
    const typeId = Object.hasOwn(input, 'type') ? input.type : DEFAULT_TASK_TYPE;
    const type = taskType(this.taskTypes, typeId);
    const data = taskInput(input);
    const fields = taskFields(type, Object.hasOwn(input, 'fields') ? input.fields : {});
    return this.transaction(() => {
      this.validatePeople(data);
      const id = crypto.randomUUID();
      const time = now();
      this.db.prepare(`INSERT INTO tasks (id,title,description,creator_id,assignee_id,reviewer_id,due_date,created_at,updated_at,type,status,fields)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, data.title, data.description, user.id, data.assignee_id, data.reviewer_id,
        data.due_date, time, time, typeId, type.initialStatus, JSON.stringify(fields));
      this.event(this.task(id, user), user.id, 'created');
      return this.detail(id, user);
    });
  }
  updateTask(id, user, input, { partial = false } = {}) {
    return this.transaction(() => {
      const task = this.task(id, user);
      const type = taskType(this.taskTypes, task.type);
      requireThat(editAllowed(task, user), 403, 'فقط سازنده یا مدیر سیستم می‌تواند اطلاعات کار را ویرایش کند.');
      requireThat(!statusLocked(type.statuses[task.status]), 409, 'کار در بازبینی یا تکمیل‌شده قابل ویرایش نیست.', 'task_locked');
      this.checkTaskVersion(task, input.version);
      requireThat(!Object.hasOwn(input, 'type') || input.type === task.type, 400, 'نوع کار بعد از ایجاد تغییر نمی‌کند.', 'immutable_task_type');
      const data = taskInput(partial ? { ...task, ...input } : input);
      const fields = Object.hasOwn(input, 'fields') ? taskFields(type, input.fields) : task.fields;
      this.validatePeople(data);
      this.db.prepare(`UPDATE tasks SET title=?,description=?,assignee_id=?,reviewer_id=?,due_date=?,fields=?,version=version+1,updated_at=? WHERE id=?`)
        .run(data.title, data.description, data.assignee_id, data.reviewer_id, data.due_date, JSON.stringify(fields), now(), id);
      this.event(this.task(id, user), user.id, 'edited');
      return this.detail(id, user);
    });
  }
  checkTaskVersion(task, version) {
    requireThat(task.version === version, 409, 'این کار تغییر کرده است. نسخه تازه را ببینید و دوباره اقدام کنید.', 'stale_version');
  }
  transition(id, user, { action, note, version }) {
    return this.transaction(() => {
      const task = this.task(id, user);
      this.checkTaskVersion(task, version);
      const { actions: rules, statuses } = taskType(this.taskTypes, task.type);
      requireThat(Object.hasOwn(rules, action), 400, 'اقدام نامعتبر است.');
      const rule = rules[action];
      const problem = actionProblem(rule, task, user);
      if (problem) throw new AppError(...problem);
      note = field(note, 'توضیح', 10000, 0);
      if (rule.noteRequired) requireThat(note.length > 0, 400, 'توضیح نتیجه یا دلیل اصلاح را وارد کنید.');
      if (statuses[rule.to].review) {
        requireThat(this.user(task.reviewer_id)?.active, 409, INACTIVE_REVIEWER.message, INACTIVE_REVIEWER.code);
      }
      this.db.prepare('UPDATE tasks SET status=?,version=version+1,updated_at=? WHERE id=?').run(rule.to, now(), id);
      this.event(this.task(id, user), user.id, action, note);
      return this.detail(id, user);
    });
  }
  close() { this.db.close(); }
}
