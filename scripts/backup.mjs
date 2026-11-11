import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(process.env.DB_PATH || resolve(root, 'data/taskmanager.sqlite'));
const folder = resolve(process.env.BACKUP_DIR || resolve(root, 'backups'));
await mkdir(folder, { recursive: true, mode: 0o700 });
const target = resolve(folder, `taskmanager-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, target);
  const copy = new DatabaseSync(target);
  try {
    copy.exec('PRAGMA journal_mode = DELETE');
    const result = copy.prepare('PRAGMA integrity_check').get();
    if (Object.values(result)[0] !== 'ok') throw new Error('Backup integrity check failed');
  } finally { copy.close(); }
  await chmod(target, 0o600);
  console.log(`Verified backup: ${target}`);
} finally { db.close(); }
