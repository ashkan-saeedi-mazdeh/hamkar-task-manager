// Disposable local fixture for manual browser verification. Never uses the real database.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/store.mjs';

const folder = await mkdtemp(join(tmpdir(), 'taskmanager-browser-'));
const { server, store } = createApp({ dbPath: join(folder, 'preview.sqlite') });
const comparison = process.argv.includes('--comparison');
const password = randomBytes(18).toString('base64url');
const hash = await hashPassword(password);
const admin = store.addUser({ username: 'preview.admin', name: 'مدیر آزمایشی', password: hash, admin: true }, true);
const worker = store.addUser({ username: 'preview.worker', name: 'همکار آزمایشی', password: hash });
const reviewer = store.addUser({ username: 'preview.reviewer', name: 'بازبین آزمایشی', password: hash });
store.addUser({ username: 'preview.other', name: 'عضو دیگر', password: hash });
for (const [title, status, due, description] of [
  ['آماده‌سازی گزارش ماهانه', 'new', '2026-11-15', 'آمار ماه گذشته را جمع کنید و سه نکته مهم را در ابتدای گزارش بنویسید.'],
  ['بازبینی متن معرفی محصول', 'in_review', '2026-11-10', 'متن صفحه معرفی محصول را کوتاه و روشن کنید. مخاطب باید در همان بند اول بداند محصول چه مشکلی را حل می‌کند.'],
  ['بررسی صفحه ورود در گوشی', 'changes_requested', '2026-11-12', 'صفحه ورود را روی گوشی بررسی کنید. نتیجه ورود موفق و ناموفق را با اندازه صفحه و مراحل بازتولید بنویسید.'],
  ['تکمیل راهنمای استفاده تیم', 'done', null, 'راهنمای کوتاه ساخت کار، ارسال نتیجه و درخواست اصلاح را برای همکاران آماده کنید.'],
  ['هماهنگی جلسه هفتگی', 'in_progress', null, 'زمان جلسه را با تیم هماهنگ کنید و موضوع‌های اصلی را در دستور جلسه بنویسید.']
]) {
  let task = store.createTask(admin, { title, description, assignee_id: worker.id, reviewer_id: reviewer.id, due_date: due });
  if (status !== 'new') task = store.transition(task.id, worker, { action: 'start', note: '', version: task.version });
  if (['in_review', 'changes_requested', 'done'].includes(status)) task = store.transition(task.id, worker, { action: 'submit', note: 'نتیجه اولیه آماده است. لطفا بررسی کنید.', version: task.version });
  if (status === 'changes_requested') store.transition(task.id, reviewer, { action: 'request_changes', note: 'توضیحات بخش پایانی نیاز به یک مثال دارد.', version: task.version });
  if (status === 'done') store.transition(task.id, reviewer, { action: 'approve', note: 'نتیجه تایید شد.', version: task.version });
}
if (comparison) {
  const base = Date.parse('2026-11-12T08:00:00Z');
  const taskTimes = new Map();
  const updateEvent = store.db.prepare('UPDATE events SET created_at=?, snapshot=? WHERE id=?');
  const updateTask = store.db.prepare('UPDATE tasks SET created_at=?, updated_at=? WHERE id=?');
  for (const event of store.db.prepare('SELECT * FROM events ORDER BY id').all()) {
    const updated = new Date(base + event.id * 37 * 60000).toISOString();
    const created = taskTimes.get(event.task_id)?.created || updated;
    taskTimes.set(event.task_id, { created, updated });
    const snapshot = JSON.parse(event.snapshot);
    snapshot.created_at = created;
    snapshot.updated_at = updated;
    updateEvent.run(updated, JSON.stringify(snapshot), event.id);
  }
  for (const [id, { created, updated }] of taskTimes) updateTask.run(created, updated, id);
}
server.listen(4311, '127.0.0.1', () => console.log(`Disposable browser fixture: http://127.0.0.1:4311\nUsers: preview.admin, preview.worker, preview.reviewer\nTemporary password: ${password}`));
const cleanup = () => server.close(async () => { store.close(); await rm(folder, { recursive: true, force: true }); process.exit(0); });
for (const signal of ['SIGINT', 'SIGTERM', 'disconnect']) process.once(signal, cleanup);
