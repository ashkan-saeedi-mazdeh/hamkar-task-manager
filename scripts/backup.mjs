import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, mkdtemp, chmod, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(process.env.DB_PATH || resolve(root, 'data/taskmanager.sqlite'));
const folder = resolve(process.env.BACKUP_DIR || resolve(root, 'backups'));
await mkdir(folder, { recursive: true, mode: 0o700 });
const target = resolve(folder, `taskmanager-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.sqlite`);
const db = new DatabaseSync(source, { readOnly: true });
try {
  const staging = await mkdtemp(resolve(folder, '.taskmanager-'));
  try {
    const temporary = resolve(staging, 'backup.sqlite');
    await backup(db, temporary);
    const copy = new DatabaseSync(temporary);
    try {
      // Restoring a snapshot must not bring back sessions revoked after that snapshot.
      copy.exec('PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON; DELETE FROM sessions');
      const result = copy.prepare('PRAGMA integrity_check').get();
      if (Object.values(result)[0] !== 'ok') throw new Error('Backup integrity check failed');
    } finally { copy.close(); }
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    console.log(`Verified backup: ${target}`);
  } finally { await rm(staging, { recursive: true, force: true }); }
} finally { db.close(); }
