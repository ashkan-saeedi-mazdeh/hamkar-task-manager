// Disposable local fixture for manual browser verification. Never uses the real database.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/store.mjs';

const folder = await mkdtemp(join(tmpdir(), 'taskmanager-browser-'));
const { server, store } = createApp({ dbPath: join(folder, 'preview.sqlite') });
const password = randomBytes(18).toString('base64url');
const hash = await hashPassword(password);
const admin = store.addUser({ username: 'preview.admin', name: 'مدیر آزمایشی', password: hash, admin: true }, true);
const worker = store.addUser({ username: 'preview.worker', name: 'همکار آزمایشی', password: hash });
const reviewer = store.addUser({ username: 'preview.reviewer', name: 'بازبین آزمایشی', password: hash });
store.addUser({ username: 'preview.other', name: 'عضو دیگر', password: hash });
for (const [title, status, due] of [
  ['آماده‌سازی گزارش ماهانه', 'new', '2026-11-15'],
  ['بازبینی متن معرفی محصول', 'in_review', '2026-11-10'],
  ['بررسی صفحه ورود در گوشی', 'changes_requested', '2026-11-12'],
  ['تکمیل راهنمای استفاده تیم', 'done', null],
  ['هماهنگی جلسه هفتگی', 'in_progress', null]
]) {
  let task = store.createTask(admin, { title, description: 'این یک کار آزمایشی برای بررسی برنامه است. نتیجه را با توضیح روشن برای مدیر پیگیری بفرستید.', assignee_id: worker.id, reviewer_id: reviewer.id, due_date: due });
  if (status !== 'new') task = store.transition(task.id, worker, { action: 'start', note: '', version: task.version });
  if (['in_review', 'changes_requested', 'done'].includes(status)) task = store.transition(task.id, worker, { action: 'submit', note: 'نتیجه اولیه آماده است. لطفا بررسی کنید.', version: task.version });
  if (status === 'changes_requested') store.transition(task.id, reviewer, { action: 'request_changes', note: 'توضیحات بخش پایانی نیاز به یک مثال دارد.', version: task.version });
  if (status === 'done') store.transition(task.id, reviewer, { action: 'approve', note: 'نتیجه تایید شد.', version: task.version });
}
server.listen(4311, '127.0.0.1', () => console.log(`Disposable browser fixture: http://127.0.0.1:4311\nUsers: preview.admin, preview.worker, preview.reviewer\nTemporary password: ${password}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { store.close(); await rm(folder, { recursive: true, force: true }); process.exit(0); }));
