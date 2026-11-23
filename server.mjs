import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, publicUser, hashPassword, verifyPassword, token } from './lib/store.mjs';
import { taskResponse } from './lib/task-api.mjs';
import { AppError, field, requireThat, version } from './lib/validation.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 64 * 1024;
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/vazirmatn.woff2': ['vazirmatn.woff2', 'font/woff2']
};
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const errorCodes = {
  400: 'invalid_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
  405: 'method_not_allowed', 409: 'conflict', 413: 'body_too_large', 415: 'unsupported_media_type',
  429: 'rate_limited', 500: 'internal_error'
};

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
async function bodyOf(req) {
  requireThat(req.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json', 415, 'درخواست باید JSON باشد.');
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

export function createApp({ dbPath = resolve(root, 'data/taskmanager.sqlite'), origin = '', production = false, taskTypes } = {}) {
  if (production && !origin.startsWith('https://')) throw new Error('Production requires APP_ORIGIN=https://your-domain');
  if (origin && new URL(origin).origin !== origin) throw new Error('APP_ORIGIN must contain only scheme and host, without a trailing slash');
  const store = new Store(dbPath, taskTypes);
  const attempts = new Map();
  const dummyHash = hashPassword(token());
  const secure = origin.startsWith('https://');
  const cookieName = secure ? '__Host-taskmanager' : 'taskmanager';
  const cookie = (raw, expired = false) => `${cookieName}=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expired ? 0 : 43200}${secure ? '; Secure' : ''}`;
  const allowedOrigin = req => origin || `http://${req.headers.host}`;
  // A local reverse proxy can also appear to connect from loopback.
  const canSetup = req => !production && !origin && loopback(req.socket.remoteAddress);
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
    let native = false;
    try {
      const url = new URL(req.url, 'http://localhost');
      native = url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/');
      const host = req.headers.host || '';
      if (origin) requireThat(host === new URL(origin).host, 403, 'آدرس درخواست مجاز نیست.');
      else requireThat(/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host), 403, 'برای دسترسی از شبکه، APP_ORIGIN را تنظیم کنید.');
      const path = native ? '/api' + (url.pathname.slice('/api/v1'.length) || '/') : url.pathname;
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
      if (native) {
        requireThat(!req.headers.origin, 403, 'این مسیر برای برنامه‌های بومی است.');
      } else if (mutating) {
        requireThat(req.headers['x-requested-with'] === 'TaskManager', 403, 'درخواست معتبر نیست.');
        requireThat(!req.headers.origin || req.headers.origin === allowedOrigin(req), 403, 'مبدا درخواست مجاز نیست.');
      }
      const hasBody = native ? ['POST', 'PATCH'].includes(method) : mutating;
      const body = hasBody ? await bodyOf(req) : null;
      const raw = native
        ? req.headers.authorization?.match(/^Bearer (tm_[A-Za-z0-9_-]{43})$/i)?.[1]
        : req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1).match(/^[A-Za-z0-9_-]{43}$/)?.[0];
      const user = store.session(raw);
      if (!native && path === '/api/session' && method === 'GET') return json(200, { user: publicUser(user), csrf: user?.csrf, setupRequired: store.needsSetup(), canSetup: canSetup(req) });
      const loginPath = native ? path === '/api/session' : ['/api/setup', '/api/login'].includes(path);
      if (loginPath && method === 'POST') {
        const setup = path === '/api/setup';
        if (setup) {
          requireThat(canSetup(req), 403, 'برای راه‌اندازی اولیه از دستور راه‌اندازی روی سرور استفاده کنید.');
          requireThat(store.needsSetup(), 409, 'راه‌اندازی اولیه قبلا انجام شده است.');
        }
        const login = username(body.username);
        rateLimit(req, login);
        let account;
        if (setup) {
          account = store.addUser({ username: login, name: field(body.name, 'نام', 100), password: await hashPassword(password(body.password)), admin: true }, true);
        } else {
          const candidate = store.userByName(login);
          const valid = await verifyPassword(loginPassword(body.password), candidate?.password || await dummyHash);
          const current = candidate && store.user(candidate.id);
          requireThat(current?.active && current.password === candidate.password && valid, 401, 'نام کاربری یا رمز عبور نادرست است.');
          account = publicUser(current);
        }
        const session = store.createSession(account.id, native);
        if (raw) store.logout(raw);
        if (native) return json(200, { user: account, access_token: session.raw, token_type: 'Bearer', expires_at: session.expires });
        res.setHeader('Set-Cookie', cookie(session.raw));
        return json(200, { user: account, csrf: session.csrf });
      }
      requireThat(user, 401, 'برای ادامه وارد حساب خود شوید.');
      if (native && path === '/api/session' && method === 'GET') return json(200, { user: publicUser(user) });
      if (native && path === '/api/session' && method === 'DELETE') {
        store.logout(raw);
        res.writeHead(204);
        return res.end();
      }
      if (!native && mutating) requireThat(req.headers['x-csrf-token'] === user.csrf, 403, 'نشست تغییر کرده است. صفحه را تازه کنید.');
      if (!native && path === '/api/logout' && method === 'POST') {
        store.logout(raw); res.setHeader('Set-Cookie', cookie('', true)); return json(200, { ok: true });
      }
      if (path === '/api/password' && method === 'POST') {
        rateLimit(req, user.username);
        const oldHash = user.password;
        requireThat(await verifyPassword(loginPassword(body.current_password), oldHash), 400, 'رمز فعلی نادرست است.');
        const hashed = await hashPassword(password(body.password));
        const current = store.session(raw);
        requireThat(current?.id === user.id, 401, 'نشست پایان یافته است. دوباره وارد شوید.');
        requireThat(current.password === oldHash, 409, 'حساب تغییر کرده است. دوباره وارد شوید.');
        store.setPassword(user.id, hashed);
        if (!native) res.setHeader('Set-Cookie', cookie('', true));
        return json(200, { ok: true });
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
      const result = taskResponse(store, user, { path, method, body, query: url.searchParams, native });
      if (result) {
        const [status, value] = result;
        if (native && status === 201) res.setHeader('Location', `/api/v1/tasks/${value.id}`);
        return json(status, value);
      }
      throw new AppError(404, 'مسیر پیدا نشد.');
    } catch (error) {
      if (!(error instanceof AppError)) console.error('Request failed:', error.name, error.code || 'internal');
      if (res.headersSent) return res.end();
      const status = error instanceof AppError ? error.status : 500;
      const message = error instanceof AppError ? error.message : 'خطای داخلی سرور. دوباره تلاش کنید.';
      if (native && status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
      json(status, native ? { error: message, code: error instanceof AppError && error.code || errorCodes[status] } : { error: message });
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
