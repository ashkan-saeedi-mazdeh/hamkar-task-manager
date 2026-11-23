import { DEFAULT_TASK_TYPE, taskType } from './task-types.mjs';
import { field, requireThat, version } from './validation.mjs';

function decodeCursor(value) {
  if (value === null) return null;
  const invalid = () => requireThat(false, 400, 'نشانگر صفحه نامعتبر است.', 'invalid_cursor');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) return invalid();
  let cursor;
  try { cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { return invalid(); }
  if (!Array.isArray(cursor) || cursor.length !== 2) return invalid();
  const [date, id] = cursor;
  if (typeof date !== 'string' || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date ||
      typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) return invalid();
  return cursor;
}

function listPage(store, user, query) {
  const type = query.get('type');
  const status = query.get('status');
  const scope = query.get('scope');
  const size = query.get('limit') ?? '50';
  requireThat(/^[1-9]\d?$|^100$/.test(size), 400, 'تعداد کارها در صفحه باید بین ۱ و ۱۰۰ باشد.');
  const types = type === null ? Object.values(store.taskTypes) : [taskType(store.taskTypes, type)];
  requireThat(status === null || types.some(rule => Object.hasOwn(rule.statuses, status)), 400, 'وضعیت کار نامعتبر است.');
  requireThat(scope === null || ['assigned', 'reviewing', 'created'].includes(scope), 400, 'محدوده کارها نامعتبر است.');
  const { tasks, hasMore } = store.taskPage(user, { type, status, scope, cursor: decodeCursor(query.get('cursor')), limit: Number(size) });
  const last = tasks.at(-1);
  const next_cursor = hasMore ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString('base64url') : null;
  return { tasks, next_cursor };
}

export function taskResponse(store, user, { path, method, body, query, native }) {
  if (path === '/api/task-types' && method === 'GET') {
    return [200, { default_type: DEFAULT_TASK_TYPE, task_types: store.taskTypes }];
  }
  if (path === '/api/tasks' && method === 'GET') {
    return [200, native ? listPage(store, user, query) : {
      tasks: store.listTasks(user), default_type: DEFAULT_TASK_TYPE, task_types: store.taskTypes
    }];
  }
  if (path === '/api/tasks' && method === 'POST') return [201, store.createTask(user, body)];
  const match = path.match(/^\/api\/tasks\/([a-z0-9-]+)(\/actions)?$/);
  if (!match) return null;
  const [, id, actions] = match;
  if (!actions && method === 'GET') return [200, store.detail(id, user)];
  if (!actions && method === 'PATCH') {
    return [200, store.updateTask(id, user, { ...body, version: version(body.version) }, { partial: native })];
  }
  if (actions && method === 'POST') {
    return [200, store.transition(id, user, {
      action: field(body.action, 'اقدام', 30), note: body.note ?? '', version: version(body.version)
    })];
  }
  return null;
}
