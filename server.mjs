import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, AppError, requireThat, publicUser, hashPassword, verifyPassword, token } from './lib/store.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 64 * 1024;
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

function field(value, label, max, min = 1) {
  requireThat(typeof value === 'string', 400, `${label} را وارد کنید.`);
  value = value.trim();
  requireThat(value.length >= min && value.length <= max, 400, `${label} باید بین ${min} و ${max} نویسه باشد.`);
  return value;
}
function password(value) {
  requireThat(typeof value === 'string' && value.length >= 12 && value.length <= 128, 400, 'رمز عبور باید بین ۱۲ و ۱۲۸ نویسه باشد.');
  return value;
}
function loginPassword(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 128, 400, 'رمز عبور نامعتبر است.');
  return value;
}
function username(value) {
  value = field(value, 'نام کاربری', 64, 3).toLowerCase();
  requireThat(/^[a-z0-9][a-z0-9._-]+$/.test(value), 400, 'نام کاربری را با حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط وارد کنید.');
  return value;
}
function version(value) { requireThat(Number.isSafeInteger(value) && value > 0, 400, 'نسخه رکورد نامعتبر است.'); return value; }
function taskInput(body) {
  const due = body.due_date || null;
  if (due) requireThat(typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due) && Number.isFinite(Date.parse(due)) && new Date(due).toISOString().slice(0, 10) === due, 400, 'مهلت انجام نامعتبر است.');
  return { title: field(body.title, 'عنوان', 200), description: field(body.description, 'توضیح کار', 10000),
    assignee_id: field(body.assignee_id, 'انجام‌دهنده', 64), reviewer_id: field(body.reviewer_id, 'مدیر پیگیری', 64), due_date: due };
}
async function bodyOf(req) {
  requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 415, 'درخواست باید JSON باشد.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    requireThat(size <= MAX_BODY, 413, 'حجم درخواست بیش از حد مجاز است.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requireThat(body && typeof body === 'object' && !Array.isArray(body), 400, 'درخواست نامعتبر است.');
    return body;
  } catch (error) { if (error instanceof AppError) throw error; throw new AppError(400, 'درخواست JSON نامعتبر است.'); }
}

export function createApp({ dbPath = resolve(root, 'data/taskmanager.sqlite'), origin = '', production = false } = {}) {
  if (production && !origin.startsWith('https://')) throw new Error('Production requires APP_ORIGIN=https://your-domain');
  if (origin && new URL(origin).origin !== origin) throw new Error('APP_ORIGIN must contain only scheme and host, without a trailing slash');
  const store = new Store(dbPath);
  const attempts = new Map();
  const dummyHash = hashPassword(token());
  const secure = origin.startsWith('https://');
  const cookieName = secure ? '__Host-taskmanager' : 'taskmanager';
  const cookie = (raw, expired = false) => `${cookieName}=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expired ? 0 : 43200}${secure ? '; Secure' : ''}`;
  const allowedOrigin = req => origin || `http://${req.headers.host}`;
  function rateLimit(req, name) {
    const current = Date.now();
    for (const [key, value] of attempts) if (value.until <= current) attempts.delete(key);
    const keys = [`ip:${req.socket.remoteAddress}`, `user:${name}`];
    for (const key of keys) {
      const limit = key.startsWith('ip:') ? 30 : 10;
      const item = attempts.get(key) || { count: 0, until: current + 15 * 60 * 1000 };
      requireThat(item.count < limit && attempts.size < 10000, 429, 'تلاش‌های ورود زیاد شده است. ۱۵ دقیقه دیگر دوباره امتحان کنید.');
      item.count++;
      attempts.set(key, item);
    }
  }
  const server = http.createServer(async (req, res) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    };
    if (secure) headers['Strict-Transport-Security'] = 'max-age=31536000';
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const host = req.headers.host || '';
      if (origin) requireThat(host === new URL(origin).host, 403, 'آدرس درخواست مجاز نیست.');
      else requireThat(/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host), 403, 'برای دسترسی از شبکه، APP_ORIGIN را تنظیم کنید.');
      const path = new URL(req.url, allowedOrigin(req)).pathname;
      const method = req.method;
      if (!path.startsWith('/api/')) {
        requireThat(['GET', 'HEAD'].includes(method), 405, 'روش درخواست مجاز نیست.');
        const asset = assets[path];
        requireThat(asset, 404, 'صفحه پیدا نشد.');
        const content = await readFile(resolve(root, 'public', asset[0]));
        res.writeHead(200, { 'Content-Type': asset[1] });
        res.end(method === 'HEAD' ? undefined : content);
        return;
      }
      const mutating = !['GET', 'HEAD'].includes(method);
      if (mutating) {
        requireThat(req.headers['x-requested-with'] === 'TaskManager', 403, 'درخواست معتبر نیست.');
        requireThat(!req.headers.origin || req.headers.origin === allowedOrigin(req), 403, 'مبدا درخواست مجاز نیست.');
      }
      const body = mutating ? await bodyOf(req) : null;
      const raw = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const user = store.session(raw);
      if (path === '/api/session' && method === 'GET') return json(200, { user: publicUser(user), csrf: user?.csrf, setupRequired: store.needsSetup(), canSetup: loopback(req.socket.remoteAddress) });
      if (['/api/setup', '/api/login'].includes(path) && method === 'POST') {
        const login = username(body.username);
        rateLimit(req, login);
        let account;
        if (path === '/api/setup') {
          requireThat(loopback(req.socket.remoteAddress), 403, 'راه‌اندازی اولیه را از خود سرور انجام دهید.');
          requireThat(store.needsSetup(), 409, 'راه‌اندازی اولیه قبلا انجام شده است.');
          account = store.addUser({ username: login, name: field(body.name, 'نام', 100), password: await hashPassword(password(body.password)), admin: true }, true);
        } else {
          const candidate = store.userByName(login);
          const valid = await verifyPassword(loginPassword(body.password), candidate?.password || await dummyHash);
          const current = candidate && store.user(candidate.id);
          requireThat(current?.active && current.password === candidate.password && valid, 401, 'نام کاربری یا رمز عبور نادرست است.');
          account = publicUser(current);
        }
        const session = store.createSession(account.id);
        if (raw) store.logout(raw);
        res.setHeader('Set-Cookie', cookie(session.raw));
        return json(200, { user: account, csrf: session.csrf });
      }
      requireThat(user, 401, 'برای ادامه وارد حساب خود شوید.');
      if (mutating) requireThat(req.headers['x-csrf-token'] === user.csrf, 403, 'نشست تغییر کرده است. صفحه را تازه کنید.');
      if (path === '/api/logout' && method === 'POST') {
        store.logout(raw); res.setHeader('Set-Cookie', cookie('', true)); return json(200, { ok: true });
      }
      if (path === '/api/password' && method === 'POST') {
        rateLimit(req, user.username);
        const oldHash = user.password;
        requireThat(await verifyPassword(loginPassword(body.current_password), oldHash), 400, 'رمز فعلی نادرست است.');
        const hashed = await hashPassword(password(body.password));
        requireThat(store.user(user.id)?.password === oldHash && store.user(user.id)?.active, 409, 'حساب تغییر کرده است. دوباره وارد شوید.');
        store.setPassword(user.id, hashed);
        res.setHeader('Set-Cookie', cookie('', true)); return json(200, { ok: true });
      }
      if (path === '/api/users' && method === 'GET') return json(200, { users: store.users(user.admin), directory: store.db.prepare('SELECT id,name FROM users').all() });
      if (path === '/api/users' && method === 'POST') {
        requireThat(user.admin, 403, 'فقط مدیر سیستم می‌تواند حساب ایجاد کند.');
        const input = { username: username(body.username), name: field(body.name, 'نام', 100), password: await hashPassword(password(body.password)), admin: body.admin === true };
        requireThat(store.session(raw)?.admin, 403, 'دسترسی مدیریت تغییر کرده است.');
        return json(201, { user: store.addUser(input) });
      }
      const userMatch = path.match(/^\/api\/users\/([a-z0-9-]+)(\/password)?$/);
      if (userMatch && method === 'PATCH' && !userMatch[2]) {
        requireThat(user.admin, 403, 'دسترسی مدیریت لازم است.');
        requireThat(typeof body.active === 'boolean' && typeof body.admin === 'boolean', 400, 'وضعیت کاربر نامعتبر است.');
        return json(200, { user: store.updateUser(userMatch[1], user, { name: field(body.name, 'نام', 100), active: body.active, admin: body.admin, version: version(body.version) }) });
      }
      if (userMatch?.[2] && method === 'POST') {
        requireThat(user.admin, 403, 'دسترسی مدیریت لازم است.');
        const target = store.user(userMatch[1]);
        requireThat(target, 404, 'کاربر پیدا نشد.');
        requireThat(target.version === version(body.version), 409, 'اطلاعات کاربر تغییر کرده است.');
        const hashed = await hashPassword(password(body.password));
        requireThat(store.session(raw)?.admin, 403, 'دسترسی مدیریت تغییر کرده است.');
        requireThat(store.user(target.id)?.version === target.version, 409, 'اطلاعات کاربر تغییر کرده است.');
        store.setPassword(target.id, hashed);
        return json(200, { ok: true });
      }
      if (path === '/api/tasks' && method === 'GET') return json(200, { tasks: store.listTasks(user) });
      if (path === '/api/tasks' && method === 'POST') return json(201, store.createTask(user, taskInput(body)));
      const match = path.match(/^\/api\/tasks\/([a-z0-9-]+)(\/actions)?$/);
      if (match && method === 'GET' && !match[2]) return json(200, store.detail(match[1], user));
      if (match && method === 'PATCH' && !match[2]) {
        return json(200, store.updateTask(match[1], user, { ...taskInput(body), version: version(body.version) }));
      }
      if (match?.[2] && method === 'POST') {
        return json(200, store.transition(match[1], user, { action: field(body.action, 'اقدام', 30), note: field(body.note ?? '', 'توضیح', 10000, 0), version: version(body.version) }));
      }
      throw new AppError(404, 'مسیر پیدا نشد.');
    } catch (error) {
      if (!(error instanceof AppError)) console.error('Request failed:', error.name, error.code || 'internal');
      if (!res.headersSent) json(error.status || 500, { error: error instanceof AppError ? error.message : 'خطای داخلی سرور. دوباره تلاش کنید.' });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return { server, store };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4310);
  const host = process.env.BIND || '127.0.0.1';
  const { server, store } = createApp({ dbPath: process.env.DB_PATH || resolve(root, 'data/taskmanager.sqlite'), origin: process.env.APP_ORIGIN || '', production: process.env.NODE_ENV === 'production' });
  server.listen(port, host, () => console.log(`TaskManager ready: ${process.env.APP_ORIGIN || `http://127.0.0.1:${port}`}\n${store.needsSetup() ? 'Open the app on this computer to create the first administrator.' : 'Sign in with your account.'}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
