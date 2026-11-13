import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('Use before or after as the capture phase.');
const appRoot = process.argv[3] ? resolve(process.argv[3]) : root;
const output = resolve(root, 'docs/ui-comparison', phase);
const url = 'http://127.0.0.1:4311';
const instant = new Date('2026-11-13T08:30:00.000Z');

// The server creates and cleans up a disposable database. Its generated password stays in memory.
const fixture = spawn(process.execPath, ['tests/preview.mjs', '--comparison'], { cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
const fixtureExit = new Promise(resolve => {
  fixture.once('exit', resolve);
  fixture.once('error', resolve);
});
fixture.stderr.resume();
let browser;
try {
  const password = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The preview did not start on port 4311.')), 10000);
    let log = '';
    fixture.once('error', error => { clearTimeout(timer); reject(error); });
    fixture.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited with code ${code}. Is port 4311 already in use?`)); });
    fixture.stdout.on('data', chunk => {
      log += chunk;
      const match = log.match(/Temporary password: ([\w-]+)\r?\n/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  await mkdir(output, { recursive: true });
  browser = await chromium.launch();

  async function pageFor(viewport) {
    const context = await browser.newContext({ viewport, timezoneId: 'Asia/Tehran', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.clock.setFixedTime(instant);
    return page;
  }
  async function screenshot(page, name) {
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    if (!fits) throw new Error(`Horizontal overflow in ${name}.`);
    await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
    console.log(`${phase}/${name}.png`);
  }
  async function signIn(page, role) {
    await page.locator('#username').fill(`preview.${role}`);
    await page.locator('#password').fill(password);
    await page.locator('#auth-form button[type=submit]').click();
    await page.locator('#task-results .task-link:visible').first().waitFor();
  }
  async function view(page, hash) {
    await page.locator(`[data-view="${hash}"]`).click();
    await page.waitForURL(`**/#${hash}`);
  }
  async function task(page, title) {
    await page.locator('.task-link:visible').filter({ hasText: title }).click();
    await page.locator('h1').filter({ hasText: title }).waitFor();
  }

  const desktop = { width: 1440, height: 960 };
  const worker = await pageFor(desktop);
  await worker.goto(url);
  await worker.locator('#username').waitFor();
  await screenshot(worker, '01-desktop-login');
  await signIn(worker, 'worker');
  await screenshot(worker, '02-desktop-dashboard');
  await view(worker, 'mine');
  await screenshot(worker, '03-desktop-my-tasks');
  await task(worker, 'بررسی صفحه ورود در گوشی');
  await screenshot(worker, '04-desktop-task-feedback');
  await worker.locator('[data-action="submit"]').click();
  await worker.locator('#action-note').fill('مثال جدید را اضافه کردم و نتیجه را روی گوشی دوباره بررسی کردم.');
  await screenshot(worker, '05-desktop-submit-result');
  await worker.locator('#cancel-action').click();
  await worker.locator('#new-task').click();
  await worker.locator('#task-title').fill('آماده‌سازی گزارش هفته آینده');
  await worker.locator('#description').fill('پیش‌نویس گزارش و نکات جلسه را برای بازبینی آماده کنید.');
  await worker.locator('#assignee').selectOption({ label: 'همکار آزمایشی' });
  await worker.locator('#reviewer').selectOption({ label: 'بازبین آزمایشی' });
  await worker.locator('#due-date').fill('2026-11-21');
  await screenshot(worker, '06-desktop-new-task');

  const reviewer = await pageFor(desktop);
  await reviewer.goto(url);
  await signIn(reviewer, 'reviewer');
  await view(reviewer, 'review');
  await screenshot(reviewer, '07-desktop-review-queue');
  await task(reviewer, 'بازبینی متن معرفی محصول');
  await screenshot(reviewer, '08-desktop-review-detail');

  const admin = await pageFor(desktop);
  await admin.goto(url);
  await signIn(admin, 'admin');
  await view(admin, 'users');
  await admin.locator('#new-user').waitFor();
  await screenshot(admin, '09-desktop-team');

  const phone = await pageFor({ width: 390, height: 844 });
  await phone.goto(url);
  await signIn(phone, 'worker');
  await screenshot(phone, '10-phone-dashboard');
  await phone.locator('#menu').click();
  await view(phone, 'mine');
  await screenshot(phone, '11-phone-my-tasks');
  await task(phone, 'بررسی صفحه ورود در گوشی');
  await screenshot(phone, '12-phone-task-feedback');
} finally {
  await browser?.close();
  // IPC gives the child a graceful cleanup path on Windows as well as Unix.
  if (fixture.connected) fixture.disconnect();
  await fixtureExit;
}
