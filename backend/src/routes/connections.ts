import type { FastifyInstance } from 'fastify';
import sql from 'mssql';
import type { SqlServerConnection } from '../types.js';
import { buildMssqlConfig } from '../util/mssql.js';
import { isValidSqlObjectName } from '../util/sqlIdent.js';

function bracketRef(name: string): string {
  return name
    .split('.')
    .map((part) => `[${part.replace(/]/g, ']]')}]`)
    .join('.');
}

async function withPool<T>(
  conn: SqlServerConnection,
  fn: (pool: sql.ConnectionPool) => Promise<T>,
): Promise<T> {
  const pool = await new sql.ConnectionPool(buildMssqlConfig(conn)).connect();
  try {
    return await fn(pool);
  } finally {
    await pool.close().catch(() => undefined);
  }
}

export async function connectionsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/connections/sqlserver/test', async (req, reply) => {
    const body = req.body as { connection?: SqlServerConnection };
    const conn = body?.connection;
    if (!conn?.server) return reply.code(400).send({ ok: false, message: '缺少连接信息' });
    try {
      const version = await withPool(conn, async (pool) => {
        const result = await pool.request().query('SELECT @@VERSION AS version');
        return String(result.recordset?.[0]?.version ?? '');
      });
      return { ok: true, message: '连接成功', version };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post('/api/connections/sqlserver/databases', async (req, reply) => {
    const body = req.body as { connection?: SqlServerConnection };
    const conn = body?.connection;
    if (!conn?.server) return reply.code(400).send({ error: '缺少连接信息' });
    try {
      // 列出数据库不需要指定目标库，未填数据库时连到 master。
      const databases = await withPool({ ...conn, database: conn.database || 'master' }, async (pool) => {
        const result = await pool.request().query(
          // database_id > 4 排除 master/tempdb/model/msdb 系统库
          'SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name',
        );
        return (result.recordset ?? []).map((row) => String((row as { name: string }).name));
      });
      return { databases };
    } catch (error) {
      return reply.code(400).send({
        error: '获取数据库列表失败',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post('/api/connections/sqlserver/objects', async (req, reply) => {
    const body = req.body as { connection?: SqlServerConnection };
    const conn = body?.connection;
    if (!conn?.server) return reply.code(400).send({ error: '缺少连接信息' });
    if (!conn.database) return reply.code(400).send({ error: '请先选择数据库' });
    try {
      const objects = await withPool(conn, async (pool) => {
        const result = await pool.request().query(
          `SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name], TABLE_TYPE AS [type]
             FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
            ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        );
        return (result.recordset ?? []).map((row) => {
          const item = row as { schema: string; name: string; type: string };
          return {
            schema: String(item.schema),
            name: String(item.name),
            type: item.type === 'VIEW' ? ('view' as const) : ('table' as const),
          };
        });
      });
      return { objects };
    } catch (error) {
      return reply.code(400).send({
        error: '获取表/视图列表失败',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post('/api/connections/sqlserver/columns', async (req, reply) => {
    const body = req.body as {
      connection?: SqlServerConnection;
      table?: string;
      query?: string;
    };
    const conn = body?.connection;
    if (!conn?.server) return reply.code(400).send({ error: '缺少连接信息' });
    if (!body?.table && !body?.query) {
      return reply.code(400).send({ error: '需要提供 table 或 query' });
    }
    if (body.table && !isValidSqlObjectName(body.table)) {
      return reply.code(400).send({ error: `非法表名：${body.table}` });
    }

    try {
      const columns = await withPool(conn, async (pool) => {
        const sqlText = body.query
          ? `SELECT TOP 0 * FROM (${body.query}) AS __husteryx_sub`
          : `SELECT TOP 0 * FROM ${bracketRef(body.table as string)}`;
        const result = await pool.request().query(sqlText);
        const meta = result.recordset?.columns ?? {};
        return Object.values(meta).map((column) => {
          const type = (column as { type?: { declaration?: string; name?: string } }).type;
          return { name: column.name, type: type?.declaration ?? type?.name ?? 'unknown' };
        });
      });
      return { columns };
    } catch (error) {
      return reply.code(400).send({
        error: '探测列失败',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
