import fs from 'node:fs';
import XLSX from 'xlsx';
import type { InputExcelConfig } from '../types.js';
import type { NodeExecutor } from './context.js';
import { materializeRows } from '../engine/ingest.js';
import { dedupeNames } from '../util/format.js';
import { resolveInputPath } from '../util/io.js';

export const inputExcel: NodeExecutor = async (ctx) => {
  const cfg = ctx.node.config as unknown as InputExcelConfig;
  if (!cfg?.path) throw new Error('Excel 输入节点缺少文件路径');

  const filePath = resolveInputPath(cfg.path);
  if (!fs.existsSync(filePath)) throw new Error(`Excel 文件不存在：${filePath}`);

  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName =
    cfg.sheet && workbook.SheetNames.includes(cfg.sheet)
      ? cfg.sheet
      : workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel 文件不包含任何工作表');

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });

  const hasHeader = cfg.hasHeader !== false;
  let columns: string[];
  let dataRows: unknown[][];

  if (hasHeader) {
    const headerRow = matrix[0] ?? [];
    columns = dedupeNames(
      headerRow.map((v, i) =>
        v === null || v === undefined || v === '' ? `column_${i + 1}` : String(v),
      ),
    );
    dataRows = matrix.slice(1);
  } else {
    const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
    columns = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
    dataRows = matrix;
  }

  const rows = dataRows.map((row) => {
    const record: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      record[column] = row[index] ?? null;
    });
    return record;
  });

  const rowCount = await materializeRows(ctx.connection, ctx.outputTable, rows, columns);
  ctx.log('success', `已读取 Excel 工作表「${sheetName}」：${rowCount} 行`);
  return { rowCount, note: sheetName };
};
