import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const BACKUP_DIR = process.env.BACKUP_DIR || '/backup';
const DB_URL = process.env.DATABASE_URL || '';

export async function createBackup() {
  if (!DB_URL.startsWith('postgresql://')) {
    console.warn('[BACKUP] PostgreSQL URL sozlanmagan');
    return { success: false, error: 'DATABASE_URL not set' };
  }
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `falcon-backup-${timestamp}.sql.gz`;
    const filepath = path.join(BACKUP_DIR, filename);

    execSync(`pg_dump "${DB_URL}" | gzip > "${filepath}"`, { stdio: 'pipe', timeout: 120000 });

    const stats = fs.statSync(filepath);
    const oldest = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('falcon-backup-'))
      .sort()
      .slice(0, -14);

    for (const old of oldest) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
    }

    console.log(`[BACKUP] OK: ${filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    return { success: true, filename, size: stats.size, path: filepath };
  } catch (e) {
    console.error('[BACKUP] Xatolik:', e.message);
    return { success: false, error: e.message };
  }
}

export async function restoreBackup(filename) {
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return { success: false, error: 'Fayl topilmadi' };
  try {
    execSync(`gunzip -c "${filepath}" | psql "${DB_URL}"`, { stdio: 'pipe', timeout: 300000 });
    console.log(`[BACKUP] Restore OK: ${filename}`);
    return { success: true };
  } catch (e) {
    console.error('[BACKUP] Restore xatolik:', e.message);
    return { success: false, error: e.message };
  }
}

export function listBackups() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('falcon-backup-'))
      .sort()
      .reverse()
      .map(f => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size, date: fs.statSync(path.join(BACKUP_DIR, f)).mtime }));
    return { success: true, backups: files };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
