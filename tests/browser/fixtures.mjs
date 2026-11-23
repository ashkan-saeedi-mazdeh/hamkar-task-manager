import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { expect, test as base } from '@playwright/test';
import { createApp } from '../../server.mjs';

export const newPassword = () => randomBytes(24).toString('base64url');

export const test = base.extend({
  taskTypes: [undefined, { option: true }],
  app: async ({ taskTypes }, use) => {
    const { server, store } = createApp({ dbPath: ':memory:', taskTypes });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    function client() {
      let cookie = '', csrf = '';
      return async (path, body, method = body === undefined ? 'GET' : 'POST') => {
        const response = await fetch(`${url}/api${path}`, {
          method,
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'TaskManager', 'X-CSRF-Token': csrf, Cookie: cookie, Origin: url },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(5000)
        });
        const result = await response.json();
        expect(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`).toBe(true);
        if (result.csrf) csrf = result.csrf;
        if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        return result;
      };
    }

    try { await use({ url, client }); }
    finally {
      await new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
      });
      store.close();
    }
  },
  team: async ({ app }, use) => {
    const admin = { username: 'admin', name: 'مدیر تیم', password: newPassword(), api: app.client() };
    admin.user = (await admin.api('/setup', admin)).user;
    async function member(username, name) {
      const password = newPassword();
      const { user } = await admin.api('/users', { username, name, password });
      const api = app.client();
      await api('/login', { username, password });
      return { user, username, password, api };
    }
    const worker = await member('worker', 'آرمان راد');
    const reviewer = await member('reviewer', 'نیلوفر مهر');
    const createTask = (overrides = {}) => admin.api('/tasks', {
      title: 'طرح معرفی محصول', description: 'نسخه اولیه را آماده کنید.',
      assignee_id: worker.user.id, reviewer_id: reviewer.user.id, ...overrides
    });
    const action = (actor, task, name, note = '') => actor.api(`/tasks/${task.id}/actions`, { version: task.version, action: name, note });
    await use({ admin, worker, reviewer, member, createTask, action });
  }
});

export { expect };

export async function signIn(page, app, actor) {
  await page.goto(app.url);
  await page.getByLabel('نام کاربری', { exact: true }).fill(actor.username);
  await page.getByLabel('رمز عبور', { exact: true }).fill(actor.password);
  await page.getByRole('button', { name: 'ورود به فضای کار', exact: true }).click();
  await expect(page.getByRole('button', { name: 'کار جدید', exact: true })).toBeVisible();
}

export async function openTask(page, app, task) {
  await page.goto(`${app.url}/#task/${task.id}`);
  await expect(page.getByRole('heading', { level: 1, name: task.title, exact: true })).toBeVisible();
}

export async function perform(page, label, confirm, note) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog');
  if (note) await dialog.locator('textarea').fill(note);
  await dialog.getByRole('button', { name: confirm, exact: true }).click();
  await expect(dialog).toBeHidden();
}
