import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, token, verifyPassword } from '../lib/store.mjs';

function setup(dbPath, values = []) {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [fileURLToPath(new URL('../scripts/setup.mjs', import.meta.url))], { env: { ...globalThis.process.env, DB_PATH: dbPath }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let step = 0;
    const prompts = ['Full name: ', 'Username (English letters/numbers, at least 3): ', 'Password (12-128 characters, input is hidden): '];
    const timeout = setTimeout(() => { process.kill(); reject(new Error('Setup timed out')); }, 10000);
    process.stdout.on('data', chunk => {
      stdout += chunk;
      if (step < values.length && stdout.includes(prompts[step])) process.stdin.write(`${values[step++]}\n`);
    });
    process.stderr.on('data', chunk => { stderr += chunk; });
    process.on('error', error => { clearTimeout(timeout); reject(error); });
    process.on('exit', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
  });
}

test('interactive setup creates one administrator without printing its password', { timeout: 20000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'taskmanager-setup-'));
  const dbPath = join(folder, 'setup.sqlite');
  t.after(() => rm(folder, { recursive: true, force: true }));
  const password = token();
  const result = await setup(dbPath, ['First Admin', 'first.admin', password]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!result.stdout.includes(password)); assert.ok(!result.stderr.includes(password));
  const store = new Store(dbPath);
  try {
    const user = store.userByName('first.admin');
    assert.equal(user.admin, 1); assert.equal(user.active, 1); assert.notEqual(user.password, password);
    assert.equal(await verifyPassword(password, user.password), true);
  } finally { store.close(); }
  const repeated = await setup(dbPath);
  assert.notEqual(repeated.code, 0); assert.match(repeated.stderr, /administrator already exists/);
});
