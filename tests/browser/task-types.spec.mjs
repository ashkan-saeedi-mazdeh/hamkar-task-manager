import { testTaskTypes } from '../fixtures/task-types.mjs';
import { expect, openTask, perform, signIn, test } from './fixtures.mjs';

test.use({ taskTypes: testTaskTypes });

test('the browser creates, edits, and completes a second type from its definition', async ({ page, app, team }) => {
  const initialCode = '<b>old code</b>';
  await signIn(page, app, team.admin);
  await page.getByRole('button', { name: 'کار جدید', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('نوع کار', { exact: true }).selectOption('delivery');
  await dialog.getByLabel('عنوان کار', { exact: true }).fill('تحویل سفارش');
  await dialog.getByLabel('توضیح کار و نتیجه مورد انتظار').fill('بسته را تحویل دهید.');
  await dialog.getByLabel('انجام‌دهنده', { exact: true }).selectOption(team.worker.user.id);
  await dialog.getByLabel('مدیر پیگیری', { exact: true }).selectOption(team.reviewer.user.id);
  await dialog.getByLabel('کد رهگیری', { exact: true }).fill(initialCode);
  await dialog.getByRole('button', { name: 'ایجاد کار', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'تحویل سفارش', exact: true })).toBeVisible();
  await expect(page.locator('.detail-main').getByText(initialCode, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'ویرایش اطلاعات', exact: true }).click();
  await expect(dialog.getByLabel('نوع کار', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('کد رهگیری')).toHaveValue(initialCode);
  await dialog.getByLabel('کد رهگیری').fill('NEW-042');
  await dialog.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await expect(page.getByText('NEW-042', { exact: true }).first()).toBeVisible();
  await page.locator('.timeline li').last().locator('summary').click();
  await expect(page.locator('.timeline').getByText(initialCode, { exact: true })).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, app, team.worker);
  const [task] = (await team.worker.api('/tasks')).tasks;
  await openTask(page, app, task);
  await expect(page.getByText('نتیجه را بنویسید تا مدیر پیگیری بتواند آن را بررسی کند.')).toHaveCount(0);
  await perform(page, 'ثبت تحویل', 'ثبت تحویل', 'تحویل به گیرنده ثبت شد.');
  await expect(page.getByText('تحویل داده شد', { exact: true })).toBeVisible();
  await expect(page.getByText('تحویل به گیرنده ثبت شد.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'نمای کلی', exact: true }).click();
  const completed = page.locator('.stat-check');
  await expect(completed.locator('strong')).toHaveText('۱');
  await completed.click();
  await expect(page.getByRole('link', { name: 'تحویل سفارش', exact: true })).toBeVisible();
});

test('reviewer deactivation refreshes the blocked action on an already-open task', async ({ page, app, team }) => {
  const task = await team.action(team.worker, await team.createTask(), 'start');
  await signIn(page, app, team.worker);
  await openTask(page, app, task);
  await page.getByRole('button', { name: 'ارسال نتیجه برای بازبینی', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const note = 'نتیجه آماده است.';
  await dialog.locator('textarea').fill(note);
  await team.admin.api(`/users/${team.reviewer.user.id}`, { ...team.reviewer.user, active: false }, 'PATCH');
  await dialog.getByRole('button', { name: 'ارسال نتیجه برای بازبینی', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('حساب مدیر پیگیری غیرفعال است');
  await expect(dialog.locator('textarea')).toHaveValue(note);
  await dialog.getByRole('button', { name: 'انصراف', exact: true }).click();
  await expect(page.locator('.action-card')).toContainText('حساب مدیر پیگیری غیرفعال است');
  await expect(page.getByRole('button', { name: 'ارسال نتیجه برای بازبینی', exact: true })).toHaveCount(0);
});
