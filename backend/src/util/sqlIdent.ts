/** SQL 标识符与字面量的安全处理，避免拼接注入。 */

/** 用双引号包裹标识符并转义内部双引号。 */
export function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** 转义单引号字符串字面量。 */
export function quoteString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** 由节点 id 推导出稳定的 DuckDB 表名。 */
export function tableNameForNode(nodeId: string): string {
  const safe = String(nodeId).replace(/[^a-zA-Z0-9_]/g, '_');
  return `n_${safe}`;
}

/** 校验表名是否安全（用于 SQLServer 输出等场景）。 */
export function isValidSqlObjectName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
