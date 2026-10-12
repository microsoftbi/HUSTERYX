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
