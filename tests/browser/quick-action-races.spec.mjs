import { expect, signIn, test } from './fixtures.mjs';

test('a pending one-click start stays disabled when search redraws the list', async ({ page, app, team }) => {
  const task = await team.createTask();
  await signIn(page, app, team.worker);
  const held = Promise.withResolvers();
  const release = Promise.withResolvers();
  const endpoint = `${app.url}/api/tasks/${task.id}/actions`;
  let requests = 0;
  await page.route(endpoint, async route => {
    requests++;
    const response = await route.fetch();
    held.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'شروع کار', exact: true }).click();
    await held.promise;
    const search = page.getByRole('searchbox', { name: 'جست‌وجوی عنوان کار' });
    await search.fill(task.title);
    const start = page.getByRole('button', { name: 'شروع کار', exact: true });
    await expect(start).toBeDisabled();
    await expect(start).toHaveAttribute('aria-busy', 'true');
    // A viewport change exposes the other rendering of the same pending task.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(start).toBeDisabled();
    release.resolve();
    await expect(page.getByRole('button', { name: 'ارسال نتیجه', exact: true })).toBeVisible();
    await expect(search).toHaveValue(task.title);
    expect(requests).toBe(1);
    expect((await team.worker.api(`/tasks/${task.id}`)).events.map(event => event.action)).toEqual(['start', 'created']);
  } finally { release.resolve(); }
});

test('a delayed list start cannot restore a task after reassignment removes access', async ({ page, app, team }) => {
  const task = await team.createTask();
  await signIn(page, app, team.worker);
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
    await held.promise;
    const started = await team.admin.api(`/tasks/${task.id}`);
    expect(started.status).toBe('in_progress');
    await team.admin.api(`/tasks/${task.id}`, { ...started, assignee_id: team.admin.user.id }, 'PATCH');
    await page.getByRole('button', { name: 'تازه‌سازی اطلاعات', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'در این فهرست کاری نیست', exact: true })).toBeVisible();
    const response = page.waitForResponse(result => result.url() === endpoint);
    release.resolve();
    await (await response).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole('heading', { name: 'در این فهرست کاری نیست', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: task.title, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ارسال نتیجه', exact: true })).toHaveCount(0);
    expect((await team.admin.api(`/tasks/${task.id}`)).events.map(event => event.action)).toEqual(['edited', 'start', 'created']);
  } finally { release.resolve(); }
});
