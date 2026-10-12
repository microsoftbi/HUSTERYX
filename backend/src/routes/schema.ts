import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { InputCsvConfig, InputExcelConfig } from '../types.js';
import { closeSession, createSession, describeTable } from '../engine/duckdb.js';
import { normalizeDelimiter } from '../util/format.js';
import { readExcelSheet } from '../util/excel.js';
import { decodeFileToUtf8, resolveInputPath, safeUnlink, tempPath } from '../util/io.js';
import { quoteString } from '../util/sqlIdent.js';

/** 从数据行中推断某列的粗略类型（仅用于结构预览展示）。 */
function inferType(rows: unknown[][], index: number): string {
  for (const row of rows.slice(0, 200)) {
    const value = row[index];
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'number') return 'DOUBLE';
    if (typeof value === 'boolean') return 'BOOLEAN';
    return 'VARCHAR';
  }
  return 'VARCHAR';
}

export async function schemaRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/schema/csv', async (req, reply) => {
    const cfg = req.body as Partial<InputCsvConfig>;
    if (!cfg?.path) return reply.code(400).send({ error: '缺少文件路径' });

    const sourcePath = resolveInputPath(cfg.path);
    if (!fs.existsSync(sourcePath)) {
      return reply.code(404).send({ error: `文件不存在：${sourcePath}` });
    }

    const delimiter = normalizeDelimiter(cfg.delimiter);
    const hasHeader = cfg.hasHeader !== false;

    let readPath = sourcePath;
    let tempFile: string | null = null;
    if (cfg.encoding === 'gbk') {
      const text = decodeFileToUtf8(sourcePath, 'gbk');
      tempFile = tempPath('.csv');
      fs.writeFileSync(tempFile, text, 'utf-8');
      readPath = tempFile;
    }

    const session = await createSession();
    try {
      await session.connection.run(
        `CREATE OR REPLACE VIEW __husteryx_probe AS
         SELECT * FROM read_csv_auto(${quoteString(readPath)}, delim = ${quoteString(delimiter)}, header = ${hasHeader ? 'true' : 'false'}, sample_size = -1)`,
      );
      const columns = await describeTable(session.connection, '__husteryx_probe');
      return { columns };
    } catch (error) {
      return reply.code(400).send({
        error: '解析 CSV 失败',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      closeSession(session);
      if (tempFile) safeUnlink(tempFile);
    }
  });

  app.post('/api/schema/excel', async (req, reply) => {
    const cfg = req.body as Partial<InputExcelConfig>;
    if (!cfg?.path) return reply.code(400).send({ error: '缺少文件路径' });

    try {
      const { columns, dataRows } = readExcelSheet(cfg.path, cfg.sheet, cfg.hasHeader !== false);
      return {
        columns: columns.map((name, index) => ({ name, type: inferType(dataRows, index) })),
      };
    } catch (error) {
      return reply.code(400).send({
        error: '解析 Excel 失败',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
