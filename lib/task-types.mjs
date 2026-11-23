import { field, requireThat } from './validation.mjs';

export const DEFAULT_TASK_TYPE = 'standard';
export const INACTIVE_REVIEWER = {
  code: 'reviewer_inactive',
  message: 'حساب مدیر پیگیری غیرفعال است. از سازنده کار یا مدیر سیستم بخواهید مدیر پیگیری را تغییر دهد.'
};
export const TASK_TYPES = {
  standard: {
    label: 'کار معمولی',
    initialStatus: 'new',
    fields: {},
    statuses: {
      new: { label: 'آماده شروع' },
      in_progress: { label: 'در حال انجام' },
      in_review: { label: 'در انتظار بازبینی', review: true },
      changes_requested: { label: 'نیازمند اصلاح', revision: true },
      done: { label: 'تکمیل‌شده', locked: true, terminal: true }
    },
    actions: {
      start: {
        label: 'شروع کار', eventLabel: 'کار را شروع کرد',
        from: ['new', 'changes_requested'], to: 'in_progress', role: 'assignee'
      },
      submit: {
        label: 'ارسال نتیجه برای بازبینی', eventLabel: 'نتیجه را برای بازبینی فرستاد',
        from: ['in_progress', 'changes_requested'], to: 'in_review', role: 'assignee',
        noteRequired: true
      },
      approve: {
        label: 'تایید و تکمیل کار', eventLabel: 'کار را تایید کرد',
        from: ['in_review'], to: 'done', role: 'reviewer'
      },
      request_changes: {
        label: 'برگشت برای اصلاح', eventLabel: 'درخواست اصلاح ثبت کرد',
        from: ['in_review'], to: 'changes_requested', role: 'reviewer', noteRequired: true
      }
    }
  }
};

export function validateTaskTypes(types) {
  const validId = id => /^[a-z][a-z0-9_]{0,29}$/.test(id) && !Object.hasOwn(Object.prototype, id);
  const check = (condition, location) => {
    if (!condition) throw new Error(`Invalid task type definition: ${location}`);
  };
  check(Object.hasOwn(types, DEFAULT_TASK_TYPE), DEFAULT_TASK_TYPE);
  for (const [id, type] of Object.entries(types)) {
    check(validId(id) && typeof type.label === 'string', id);
    check(Object.hasOwn(type.statuses, type.initialStatus), `${id}.initialStatus`);
    for (const [key, status] of Object.entries(type.statuses)) {
      check(validId(key) && !['open', 'completed', 'revisions'].includes(key) && typeof status.label === 'string', `${id}.statuses.${key}`);
    }
    for (const [key, definition] of Object.entries(type.fields)) {
      check(validId(key) && typeof definition.label === 'string' &&
        Number.isSafeInteger(definition.maxLength) && definition.maxLength >= 1 && definition.maxLength <= 10000, `${id}.fields.${key}`);
    }
    for (const [key, rule] of Object.entries(type.actions)) {
      const location = `${id}.actions.${key}`;
      check(validId(key) && !['created', 'edited'].includes(key) &&
        typeof rule.label === 'string' && typeof rule.eventLabel === 'string', location);
      check(['assignee', 'reviewer'].includes(rule.role) && Object.hasOwn(type.statuses, rule.to), location);
      check(Array.isArray(rule.from) && rule.from.length > 0 && rule.from.every(statusId => {
        if (!Object.hasOwn(type.statuses, statusId)) return false;
        const status = type.statuses[statusId];
        return !status.terminal && (!status.review || rule.role === 'reviewer');
      }), location);
    }
  }
}

export function taskType(types, id) {
  requireThat(typeof id === 'string' && Object.hasOwn(types, id), 400, 'نوع کار نامعتبر است.', 'invalid_task_type');
  return types[id];
}

export function taskInput(input) {
  const due = input.due_date === '' ? null : (input.due_date ?? null);
  if (due !== null) {
    requireThat(typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due) &&
      Number.isFinite(Date.parse(due)) && new Date(due).toISOString().slice(0, 10) === due,
    400, 'مهلت انجام نامعتبر است.');
  }
  return {
    title: field(input.title, 'عنوان', 200),
    description: field(input.description, 'توضیح کار', 10000),
    assignee_id: field(input.assignee_id, 'انجام‌دهنده', 64),
    reviewer_id: field(input.reviewer_id, 'مدیر پیگیری', 64),
    due_date: due
  };
}

export function taskFields(type, values) {
  requireThat(values && typeof values === 'object' && !Array.isArray(values), 400, 'فیلدهای نوع کار نامعتبر است.');
  for (const name of Object.keys(values)) {
    requireThat(Object.hasOwn(type.fields, name), 400, 'فیلد ناشناخته در نوع کار.');
  }
  const entries = [];
  for (const [name, definition] of Object.entries(type.fields)) {
    const value = Object.hasOwn(values, name) ? values[name] : '';
    const normalized = field(value, definition.label, definition.maxLength, definition.required ? 1 : 0);
    if (normalized) entries.push([name, normalized]);
  }
  return Object.fromEntries(entries);
}

export function editAllowed(task, user) {
  return task.creator_id === user.id || !!user.admin;
}

export function statusLocked(status) {
  return Boolean(status.locked || status.review || status.terminal);
}

export function actionProblem(rule, task, user) {
  if (task[`${rule.role}_id`] !== user.id) return [403, 'شما مجاز به انجام این اقدام نیستید.', 'forbidden'];
  if (!rule.from.includes(task.status)) return [409, 'این اقدام در وضعیت فعلی کار امکان‌پذیر نیست.', 'invalid_transition'];
  return null;
}
