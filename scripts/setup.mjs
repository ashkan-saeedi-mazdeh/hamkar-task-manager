import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, hashPassword } from '../lib/store.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const store = new Store(process.env.DB_PATH || resolve(root, 'data/taskmanager.sqlite'));
let muted = false;
const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
const rl = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
try {
  if (!store.needsSetup()) throw new Error('An administrator already exists. Use the app to manage accounts.');
  const name = (await rl.question('Full name: ')).trim();
  const username = (await rl.question('Username (English letters/numbers, at least 3): ')).trim().toLowerCase();
  process.stdout.write('Password (12-128 characters, input is hidden): ');
  muted = true;
  const password = await rl.question('');
  muted = false; process.stdout.write('\n');
  if (!name || name.length > 100 || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username) || password.length < 12 || password.length > 128) throw new Error('Invalid name, username or password length. No account was created.');
  store.addUser({ name, username, password: await hashPassword(password), admin: true }, true);
  console.log('Administrator created. Start the app and sign in.');
} finally { rl.close(); store.close(); }
