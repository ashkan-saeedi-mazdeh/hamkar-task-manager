import { expect, newPassword, openTask, perform, signIn, test } from './fixtures.mjs';

test('first administrator can set up the workspace, add staff, and assign a task', async ({ page, app }) => {
  await page.goto(app.url);
  await page.getByLabel('نام و نام خانوادگی', { exact: true }).fill('سارا راد');
  await page.getByLabel('نام کاربری', { exact: true }).fill('sara');
  await page.getByLabel('رمز عبور', { exact: true }).fill(newPassword());
  await page.getByRole('button', { name: 'ساخت حساب و ورود', exact: true }).click();
  await page.getByRole('link', { name: 'اعضای تیم', exact: true }).click();
  for (const [username, name] of [['arman', 'آرمان'], ['niloufar', 'نیلوفر']]) {
    await page.getByRole('button', { name: 'عضو جدید', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('نام و نام خانوادگی', { exact: true }).fill(name);
    await dialog.getByLabel('نام کاربری', { exact: true }).fill(username);
    await dialog.getByLabel('رمز عبور اولیه', { exact: true }).fill(newPassword());
    await dialog.getByRole('button', { name: 'ساخت حساب', exact: true }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await page.getByRole('link', { name: 'نمای کلی', exact: true }).click();
  await page.getByRole('button', { name: 'کار جدید', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('عنوان کار', { exact: true }).fill('آماده‌سازی راهنما');
  await form.getByLabel('توضیح کار و نتیجه مورد انتظار', { exact: true }).fill('راهنمای شروع را بنویسید.');
  await form.getByLabel('انجام‌دهنده', { exact: true }).selectOption({ label: 'آرمان' });
  await form.getByLabel('مدیر پیگیری', { exact: true }).selectOption({ label: 'نیلوفر' });
  await form.getByLabel('مهلت انجام (اختیاری)', { exact: true }).fill('2028-02-29');
  await form.getByRole('button', { name: 'ایجاد کار', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'آماده‌سازی راهنما' })).toBeVisible();
  await expect(page.getByText('سارا راد کار را ایجاد کرد')).toBeVisible();
  await page.reload();
  await expect(page.getByText('راهنمای شروع را بنویسید.', { exact: true })).toBeVisible();
  await expect(page.getByText('آماده شروع', { exact: true })).toBeVisible();
});

test('assignee and reviewer complete a revision cycle with separate browser sessions', async ({ page, browser, app, team }) => {
  const task = await team.createTask();
  const reviewerContext = await browser.newContext();
  try {
    const reviewer = await reviewerContext.newPage();
    await signIn(page, app, team.worker);
    await openTask(page, app, task);
    await perform(page, 'شروع کار', 'شروع انجام کار');
    await perform(page, 'ارسال نتیجه برای بازبینی', 'ارسال نتیجه برای بازبینی', 'نسخه اول آماده است.');
    await expect(page.getByText('در انتظار بازبینی', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'تایید و تکمیل کار' })).toHaveCount(0);

    await signIn(reviewer, app, team.reviewer);
    await reviewer.getByRole('link', { name: /بازبینی‌های من/ }).click();
    await reviewer.getByRole('link', { name: new RegExp(task.title) }).click();
    await expect(reviewer.locator('.action-card').getByText('نسخه اول آماده است.', { exact: true })).toBeVisible();
    await perform(reviewer, 'برگشت برای اصلاح', 'درخواست اصلاح', 'مثال دوم را اضافه کنید.');
    await expect(reviewer.getByText('نیازمند اصلاح', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'تازه‌سازی اطلاعات' }).click();
    await expect(page.getByRole('heading', { name: 'چه چیزی نیاز به اصلاح دارد؟' })).toBeVisible();
    await expect(page.locator('.detail-card .description').filter({ hasText: 'مثال دوم را اضافه کنید.' })).toBeVisible();
    await perform(page, 'شروع اصلاحات', 'شروع انجام کار');
    await perform(page, 'ارسال نتیجه برای بازبینی', 'ارسال نتیجه برای بازبینی', 'مثال دوم اضافه شد.');
    await expect(page.getByText('در انتظار بازبینی', { exact: true })).toBeVisible();

    await reviewer.getByRole('button', { name: 'تازه‌سازی اطلاعات' }).click();
    await perform(reviewer, 'تایید و تکمیل کار', 'تایید نهایی نتیجه', 'نتیجه تایید شد.');
    await expect(reviewer.getByText('تکمیل‌شده', { exact: true })).toBeVisible();
    await expect(reviewer.locator('.timeline li')).toHaveCount(7);
    for (const note of ['نسخه اول آماده است.', 'مثال دوم را اضافه کنید.', 'مثال دوم اضافه شد.', 'نتیجه تایید شد.']) {
      await expect(reviewer.locator('.timeline').getByText(note, { exact: true })).toBeVisible();
    }
    await expect(reviewer.getByRole('button', { name: 'تایید و تکمیل کار' })).toHaveCount(0);
  } finally { await reviewerContext.close(); }
});

test('search and role filters combine without showing tasks outside the selected view', async ({ page, app, team }) => {
  await team.createTask({ title: 'گزارش فروش' });
  let submitted = await team.createTask({ title: 'گزارش ساخت' });
  submitted = await team.action(team.worker, submitted, 'start');
  await team.action(team.worker, submitted, 'submit', 'ساخت آماده است.');
  await team.createTask({ title: 'بازبینی طراحی', assignee_id: team.reviewer.user.id, reviewer_id: team.worker.user.id });
  await signIn(page, app, team.admin);
  const search = page.getByRole('searchbox', { name: 'جست‌وجوی عنوان کار' });
  const results = page.locator('#task-results table tbody');
  await expect(results.getByRole('row')).toHaveCount(3);
  await search.fill('گزارش');
  await expect(results.getByRole('row')).toHaveCount(2);
  await page.getByRole('button', { name: 'فیلترها', exact: true }).click();
  await page.getByLabel('فیلتر وضعیت').selectOption('in_review');
  await expect(results.getByRole('row')).toHaveCount(1);
  await expect(results.getByRole('row')).toContainText('گزارش ساخت');
  await page.getByLabel('فیلتر انجام‌دهنده').selectOption(team.reviewer.user.id);
  await expect(page.getByRole('heading', { name: 'در این فهرست کاری نیست' })).toBeVisible();
  await page.getByLabel('فیلتر انجام‌دهنده').selectOption(team.worker.user.id);
  await page.getByLabel('فیلتر مدیر پیگیری').selectOption(team.worker.user.id);
  await expect(page.getByRole('heading', { name: 'در این فهرست کاری نیست' })).toBeVisible();
  await page.getByLabel('فیلتر مدیر پیگیری').selectOption(team.reviewer.user.id);
  await expect(results.getByRole('row')).toContainText('گزارش ساخت');
});

test('mobile view uses cards and the menu remains accessible by keyboard', async ({ page, app, team }) => {
  await team.createTask();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, app, team.worker);
  await expect(page.locator('.mobile-card')).toBeVisible();
  await expect(page.locator('.table-scroll')).toBeHidden();
  const menu = page.getByRole('button', { name: 'باز کردن منو' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await menu.focus();
  await menu.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  const close = page.getByRole('button', { name: 'بستن منو' });
  await expect(close).toBeFocused();
  await close.press('Enter');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  const skip = page.getByRole('link', { name: 'رفتن به محتوای اصلی' });
  await skip.focus();
  await skip.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('user-supplied markup is displayed as text in task lists, details and history', async ({ page, app, team }) => {
  const markup = '<img src=x onerror=alert(1)>';
  const name = `<i>Reviewer</i>`;
  const named = await team.member('markup-reviewer', name);
  let task = await team.createTask({ title: markup, description: `Description ${markup}`, reviewer_id: named.user.id });
  task = await team.action(team.worker, task, 'start');
  task = await team.action(team.worker, task, 'submit', `Result ${markup}`);
  await signIn(page, app, team.worker);
  await expect(page.getByRole('link', { name: new RegExp('img src=x') })).toBeVisible();
  await expect(page.locator('tbody').getByText(name, { exact: true })).toBeVisible();
  await openTask(page, app, task);
  await expect(page.getByText(`Description ${markup}`, { exact: true })).toBeVisible();
  await expect(page.locator('.action-card').getByText(`Result ${markup}`, { exact: true })).toBeVisible();
  await expect(page.locator('i').filter({ hasText: /Reviewer/ })).toHaveCount(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});

test('a stale edit reports the conflict and preserves the unsaved draft', async ({ page, app, team }) => {
  const task = await team.createTask();
  await signIn(page, app, team.admin);
  await openTask(page, app, task);
  await page.getByRole('button', { name: 'ویرایش اطلاعات', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = dialog.getByLabel('عنوان کار', { exact: true });
  await title.fill('پیش‌نویس محلی');
  await team.admin.api(`/tasks/${task.id}`, { ...task, title: 'تغییر ذخیره‌شده' }, 'PATCH');
  await dialog.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('این کار تغییر کرده است');
  await expect(title).toHaveValue('پیش‌نویس محلی');
  await dialog.getByRole('button', { name: 'انصراف', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'تغییر ذخیره‌شده' })).toBeVisible();
  expect((await team.admin.api(`/tasks/${task.id}`)).events).toHaveLength(2);
});

test('a delayed conflict refresh never replaces the task opened next', async ({ page, app, team }) => {
  const first = await team.createTask({ title: 'کار اول' });
  const second = await team.createTask({ title: 'کار دوم' });
  await signIn(page, app, team.admin);
  await openTask(page, app, first);
  await page.getByRole('button', { name: 'ویرایش اطلاعات', exact: true }).click();
  const draft = page.getByRole('dialog');
  await draft.getByLabel('عنوان کار', { exact: true }).fill('پیش‌نویس');
  await team.admin.api(`/tasks/${first.id}`, { ...first, title: 'تغییر همکار' }, 'PATCH');

  const requested = Promise.withResolvers();
  const release = Promise.withResolvers();
  const detailUrl = `${app.url}/api/tasks/${first.id}`;
  await page.route(detailUrl, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    requested.resolve();
    await release.promise;
    await route.fulfill({ response });
  });

  try {
    await draft.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
    await requested.promise;
    await openTask(page, app, second);
    const response = page.waitForResponse(r => r.url() === detailUrl && r.request().method() === 'GET');
    release.resolve();
    await (await response).finished();
    // Let the page consume the released response and paint before checking what it rendered.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.title);
  } finally { release.resolve(); }
});

test('selecting the current mobile menu item closes it without discarding the filter', async ({ page, app, team }) => {
  await team.createTask({ title: 'گزارش فروش' });
  await team.createTask({ title: 'بازبینی طراحی' });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, app, team.worker);
  const search = page.getByRole('searchbox', { name: 'جست‌وجوی عنوان کار' });
  await search.fill('گزارش');
  const menu = page.getByRole('button', { name: 'باز کردن منو' });
  await menu.click();
  await page.getByRole('link', { name: 'نمای کلی', exact: true }).click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await expect(search).toHaveValue('گزارش');
  await expect(page.locator('.mobile-card')).toHaveCount(1);
  await expect(page.locator('.mobile-card')).toContainText('گزارش فروش');
});

test('a saved edit is shown when a separate list refresh would fail', async ({ page, app, team }) => {
  const task = await team.createTask({ title: 'پیش از ویرایش' });
  await signIn(page, app, team.admin);
  await openTask(page, app, task);
  await page.route(`${app.url}/api/tasks`, route => route.abort());
  await page.getByRole('button', { name: 'ویرایش اطلاعات', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('عنوان کار', { exact: true }).fill('پس از ویرایش');
  await dialog.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'پس از ویرایش' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('تغییرات ذخیره شد.');
  await page.getByRole('link', { name: 'بازگشت به کارها', exact: true }).click();
  await expect(page.getByRole('link', { name: /پس از ویرایش/ })).toBeVisible();
});

test('a task link opened before sign-in returns to that task after login', async ({ page, app, team }) => {
  const task = await team.createTask();
  const url = `${app.url}/#task/${task.id}`;
  await page.goto(url);
  await page.getByLabel('نام کاربری', { exact: true }).fill(team.worker.username);
  await page.getByLabel('رمز عبور', { exact: true }).fill(team.worker.password);
  await page.getByRole('button', { name: 'ورود به فضای کار', exact: true }).click();
  await expect(page.getByRole('heading', { name: task.title, level: 1, exact: true })).toBeVisible();
  await expect(page).toHaveURL(url);
});

test('a saved account update reports success separately from a failed list refresh', async ({ page, app, team }) => {
  await signIn(page, app, team.admin);
  await page.getByRole('link', { name: 'اعضای تیم', exact: true }).click();
  const card = page.getByRole('article').filter({ hasText: team.worker.user.name });
  await card.getByRole('button', { name: 'مدیریت حساب', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const newName = 'آرمان بهار';
  await dialog.getByLabel('نام و نام خانوادگی', { exact: true }).fill(newName);
  await page.route(`${app.url}/api/users`, route => route.abort());
  await dialog.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('اطلاعات حساب ذخیره شد. تازه‌سازی فهرست ممکن نشد.');
  const { users } = await team.admin.api('/users');
  expect(users.find(user => user.id === team.worker.user.id).name).toBe(newName);
});

test('a revoked session clears the task view and asks the user to sign in again', async ({ page, app, team }) => {
  const task = await team.createTask();
  await signIn(page, app, team.worker);
  await openTask(page, app, task);
  await team.admin.api(`/users/${team.worker.user.id}`, { ...team.worker.user, active: false }, 'PATCH');
  await page.getByRole('button', { name: 'تازه‌سازی اطلاعات', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ورود به فضای کار', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('نشست پایان یافته است.');
});

test('a delayed successful save cannot replace a newer saved task revision', async ({ page, app, team }) => {
  const task = await team.createTask();
  const secondTitle = 'ویرایش نخست';
  const latestTitle = 'آخرین ویرایش';
  await signIn(page, app, team.admin);
  await openTask(page, app, task);

  const held = Promise.withResolvers();
  const release = Promise.withResolvers();
  const endpoint = `${app.url}/api/tasks/${task.id}`;
  const firstEdit = request => request.method() === 'PATCH' && request.postDataJSON().version === task.version;
  await page.route(endpoint, async route => {
    if (!firstEdit(route.request())) return route.continue();
    const response = await route.fetch();
    held.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  const edit = async title => {
    await page.getByRole('button', { name: 'ویرایش اطلاعات', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('عنوان کار', { exact: true }).fill(title);
    await dialog.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  };
  try {
    await edit(secondTitle);
    await held.promise;
    await page.getByRole('dialog').getByRole('button', { name: 'انصراف', exact: true }).click();
    await page.getByRole('button', { name: 'تازه‌سازی اطلاعات' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(secondTitle);
    await edit(latestTitle);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(latestTitle);

    const response = page.waitForResponse(r => r.url() === endpoint && firstEdit(r.request()));
    release.resolve();
    await (await response).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(latestTitle);
    const current = await team.admin.api(`/tasks/${task.id}`);
    expect(current.title).toBe(latestTitle);
    expect(current.events).toHaveLength(3);
  } finally { release.resolve(); }
});

test('saving the signed-in account closes any dialog when it ends the session', async ({ page, app, team }) => {
  await signIn(page, app, team.admin);
  await page.getByRole('link', { name: 'اعضای تیم', exact: true }).click();
  await page.getByRole('article').filter({ hasText: team.admin.name }).getByRole('button', { name: 'مدیریت حساب', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('نام و نام خانوادگی', { exact: true }).fill('نام تازه مدیر');
  const held = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route(`${app.url}/api/users/${team.admin.user.id}`, async route => {
    const response = await route.fetch();
    held.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await dialog.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
    await held.promise;
    await dialog.getByRole('button', { name: 'انصراف', exact: true }).click();
    await page.getByRole('button', { name: 'عضو جدید', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'افزودن همکار جدید' })).toBeVisible();
    release.resolve();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'ورود به فضای کار', exact: true })).toBeVisible();
  } finally { release.resolve(); }
});

test('a delayed action cannot restore a task after its assignment is removed', async ({ page, app, team }) => {
  const task = await team.createTask();
  await signIn(page, app, team.worker);
  await openTask(page, app, task);
  const held = Promise.withResolvers();
  const release = Promise.withResolvers();
  const endpoint = `${app.url}/api/tasks/${task.id}/actions`;
  await page.route(endpoint, async route => {
    const response = await route.fetch();
    held.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'شروع کار', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'شروع انجام کار', exact: true }).click();
    await held.promise;
    const started = await team.admin.api(`/tasks/${task.id}`);
    expect(started.status).toBe('in_progress');
    await team.admin.api(`/tasks/${task.id}`, { ...started, assignee_id: team.admin.user.id }, 'PATCH');
    await dialog.getByRole('button', { name: 'انصراف', exact: true }).click();
    await page.getByRole('button', { name: 'تازه‌سازی اطلاعات' }).click();
    const denied = page.getByRole('heading', { name: 'دریافت کار ممکن نشد', exact: true });
    await expect(denied).toBeVisible();

    const response = page.waitForResponse(r => r.url() === endpoint);
    release.resolve();
    await (await response).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(denied).toBeVisible();
    await page.getByRole('link', { name: 'بازگشت به کارها', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'در این فهرست کاری نیست', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(task.title) })).toHaveCount(0);
  } finally { release.resolve(); }
});
