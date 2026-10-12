import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/** 运行期数据目录：SQLite、spill、上传文件都落在这里 */
export const APP_DATA_DIR =
  process.env.HUSTERYX_DATA_DIR || path.join(os.homedir(), '.husteryx');

export const SPILL_DIR = path.join(APP_DATA_DIR, 'spill');
export const UPLOAD_DIR = path.join(APP_DATA_DIR, 'uploads');
export const OUTPUT_DIR = path.join(APP_DATA_DIR, 'outputs');
export const DB_FILE = path.join(APP_DATA_DIR, 'metadata.sqlite');

export const HOST = process.env.HUSTERYX_HOST || '127.0.0.1';
export const PORT = Number(process.env.HUSTERYX_PORT || 8787);

/** 预览默认返回行数上限 */
export const PREVIEW_DEFAULT_LIMIT = 200;
export const PREVIEW_MAX_LIMIT = 5000;

/** 运行上下文保留时长（毫秒），用于运行后查看阶段缓存 */
export const RUN_TTL_MS = 30 * 60 * 1000;

/** DuckDB 内存上限，超出后自动 spill 到 SPILL_DIR 的 Parquet */
export const DUCKDB_MEMORY_LIMIT = process.env.HUSTERYX_MEMORY_LIMIT || '2GB';

export function ensureDirs(): void {
  for (const dir of [APP_DATA_DIR, SPILL_DIR, UPLOAD_DIR, OUTPUT_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
