import Database from 'better-sqlite3';
import { DB_FILE, ensureDirs } from '../config.js';

ensureDirs();

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`,
  ).run({ key, value });
}

/** 关闭底层 SQLite 连接，供进程退出时调用。 */
export function closeDb(): void {
  try {
    db.close();
  } catch {
    /* 已关闭时忽略 */
  }
}
