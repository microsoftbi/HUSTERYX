import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import XLSX from 'xlsx';
import { UPLOAD_DIR, ensureDirs } from '../config.js';
import { resolveInputPath } from '../util/io.js';

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._\u4e00-\u9fa5-]/g, '_');
}

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/files/upload', async (req, reply) => {
    ensureDirs();
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: '未收到上传文件' });

    const storedName = `${Date.now()}_${sanitizeFilename(file.filename || 'upload')}`;
    const dest = path.join(UPLOAD_DIR, storedName);

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      return reply.code(400).send({
        error: '读取上传文件失败',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    await fs.promises.writeFile(dest, buffer);

    let sheets: string[] | undefined;
    if (/\.xlsx?$/i.test(storedName)) {
      try {
        sheets = XLSX.readFile(dest, { bookSheets: true }).SheetNames;
      } catch {
        sheets = undefined;
      }
    }

    return { path: storedName, name: file.filename, size: buffer.length, sheets };
  });

  app.get('/api/files/sheets', async (req, reply) => {
    const query = req.query as { path?: string };
    if (!query.path) return reply.code(400).send({ error: '缺少 path 参数' });
    const full = resolveInputPath(query.path);
    if (!fs.existsSync(full)) return reply.code(404).send({ error: `文件不存在：${full}` });
    try {
      const workbook = XLSX.readFile(full, { bookSheets: true });
      return { sheets: workbook.SheetNames };
    } catch (error) {
      return reply.code(400).send({
        error: '解析 Excel 失败',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
