import type { FilterConfig } from '../types.js';
import type { NodeExecutor } from './context.js';
import { countRows } from '../engine/duckdb.js';
import { quoteIdent } from '../util/sqlIdent.js';

export const filter: NodeExecutor = async (ctx) => {
  const inputTable = ctx.inputs['in'] ?? ctx.inputList[0];
  if (!inputTable) throw new Error('Filter 节点缺少输入数据');

  const cfg = ctx.node.config as unknown as FilterConfig;
  const expression = (cfg?.expression ?? '').trim();
  if (!expression) throw new Error('Filter 节点缺少过滤表达式');

  await ctx.connection.run(
    `CREATE OR REPLACE TABLE ${quoteIdent(ctx.outputTable)} AS
     SELECT * FROM ${quoteIdent(inputTable)} WHERE (${expression})`,
  );
  const rowCount = await countRows(ctx.connection, ctx.outputTable);
  ctx.log('success', `Filter 完成：命中 ${rowCount} 行`);
  return { rowCount };
};
