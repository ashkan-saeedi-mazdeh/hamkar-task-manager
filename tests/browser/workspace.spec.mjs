import { expect, openTask, signIn, test } from './fixtures.mjs';

test('assignee starts and submits from a filtered list without visiting the task', async ({ page, app, team }) => {
  const task = await team.createTask({ title: 'گزارش هفتگی' });
  await signIn(page, app, team.worker);
  await page.getByRole('link', { name: 'کارهای من', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'کارهای من', exact: true })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'جست‌وجوی عنوان کار' });
  await search.fill('گزارش');
  const listUrl = page.url();
  await page.getByRole('button', { name: 'شروع کار', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ارسال نتیجه', exact: true })).toBeVisible();
  expect(page.url()).toBe(listUrl);

  await page.getByRole('button', { name: 'ارسال نتیجه', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(task.title, { exact: true })).toBeVisible();
  await dialog.getByLabel('نتیجه انجام کار').fill('همه آمارها بررسی شد.');
  await dialog.getByRole('button', { name: 'ارسال نتیجه برای بازبینی', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('table').getByText('در انتظار بازبینی', { exact: true })).toBeVisible();
  await expect(search).toHaveValue('گزارش');
  expect(page.url()).toBe(listUrl);
  const saved = await team.worker.api(`/tasks/${task.id}`);
  expect(saved.events.map(event => event.action)).toEqual(['submit', 'start', 'created']);
  expect(saved.events[0].note).toBe('همه آمارها بررسی شد.');
});

test('a stale list submission retains the note and reloads the task before retry', async ({ page, app, team }) => {
  let task = await team.createTask();
  task = await team.action(team.worker, task, 'start');
  await signIn(page, app, team.worker);
  await page.getByRole('button', { name: 'ارسال نتیجه', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const note = dialog.getByLabel('نتیجه انجام کار');
  await note.fill('این نوشته هنوز ارسال نشده است.');
  await team.admin.api(`/tasks/${task.id}`, { version: task.version, title: 'عنوان تازه کار', description: task.description, assignee_id: task.assignee_id, reviewer_id: task.reviewer_id }, 'PATCH');
  await dialog.getByRole('button', { name: 'ارسال نتیجه برای بازبینی', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('این کار تغییر کرده است');
  await expect(note).toHaveValue('این نوشته هنوز ارسال نشده است.');
  await dialog.getByRole('button', { name: 'انصراف', exact: true }).click();
  await expect(page.getByRole('link', { name: 'عنوان تازه کار', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: task.title, exact: true })).toHaveCount(0);
  expect((await team.worker.api(`/tasks/${task.id}`)).events[0].action).toBe('edited');
});

test('a filtered list keeps its search, loaded rows, scroll and focus after opening a task', async ({ page, app, team }) => {
  await page.setViewportSize({ width: 390, height: 540 });
  for (let i = 1; i <= 55; i++) await team.createTask({ title: `گزارش فروش ${i}` });
  const wanted = (await team.worker.api('/tasks')).tasks.at(-1);
  await signIn(page, app, team.worker);
  await page.getByRole('searchbox', { name: 'جست‌وجوی عنوان کار' }).fill('گزارش فروش');
  await page.getByRole('button', { name: 'فیلترها', exact: true }).click();
  await page.getByLabel('فیلتر وضعیت').selectOption('new');
  await page.getByRole('button', { name: 'نمایش کارهای بیشتر' }).click();
  const link = page.getByRole('link', { name: wanted.title, exact: true });
  await link.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY);
  const listUrl = page.url();
  await link.click();
  await expect(page.getByRole('heading', { level: 1, name: wanted.title, exact: true })).toBeFocused();
  await page.getByRole('link', { name: 'بازگشت به کارها', exact: true }).click();
  await expect(link).toBeFocused();
  await expect(page.getByRole('searchbox', { name: 'جست‌وجوی عنوان کار' })).toHaveValue('گزارش فروش');
  await expect(page.getByLabel('فیلتر وضعیت')).toHaveValue('new');
  expect(page.url()).toBe(listUrl);
  expect(await page.evaluate(() => window.scrollY)).toBe(y);
});

test('shortcuts do not intercept typing or a dialog and respect reduced motion', async ({ page, app, team }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await team.createTask();
  await signIn(page, app, team.worker);
  await page.keyboard.press('Alt+f');
  const search = page.getByRole('searchbox', { name: 'جست‌وجوی عنوان کار' });
  await expect(search).toBeFocused();
  await page.keyboard.press('Alt+n');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('main').focus();
  await page.keyboard.press('Alt+n');
  const dialog = page.getByRole('dialog');
  const title = dialog.getByLabel('عنوان کار');
  await expect(title).toBeFocused();
  await expect(dialog).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Alt+f');
  await expect(title).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('review detail brings the submission and actions into a narrow viewport', async ({ page, browser, app, team }) => {
  let task = await team.createTask({ title: 'بازبینی صفحه معرفی محصول', description: 'متن توضیحات. '.repeat(180) });
  task = await team.action(team.worker, task, 'start');
  task = await team.action(team.worker, task, 'submit', 'متن جدید را روی گوشی بررسی کردم.');
  await page.setViewportSize({ width: 320, height: 568 });
  await signIn(page, app, team.reviewer);
  await page.getByRole('link', { name: 'بازبینی نتیجه', exact: true }).click();
  const result = page.getByRole('heading', { name: 'آخرین نتیجه ارسال‌شده', exact: true });
  await expect(result).toBeInViewport();
  await expect(page.getByRole('button', { name: 'تایید و تکمیل کار', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'برگشت برای اصلاح', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  const context = await browser.newContext();
  try {
    const admin = await context.newPage();
    await signIn(admin, app, team.admin);
    await openTask(admin, app, task);
    await expect(admin.getByRole('heading', { name: 'آخرین نتیجه ارسال‌شده', exact: true })).toBeVisible();
    await expect(admin.getByRole('button', { name: 'تایید و تکمیل کار', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
