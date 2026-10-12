import type { FastifyInstance } from 'fastify';
import { PREVIEW_DEFAULT_LIMIT, PREVIEW_MAX_LIMIT } from '../config.js';
import { describeTable } from '../engine/duckdb.js';
import { executeWorkflow } from '../engine/executor.js';
import { createRun, getRun, subscribe } from '../engine/runStore.js';
import type { Workflow } from '../types.js';
import { quoteIdent, tableNameForNode } from '../util/sqlIdent.js';
import { initSse } from '../util/sse.js';
import { toJsonSafeRow } from '../util/values.js';

export async function runsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/runs', async (req, reply) => {
    const body = req.body as { workflow?: Workflow };
    const workflow = body?.workflow;
    if (!workflow || !Array.isArray(workflow.nodes)) {
      return reply.code(400).send({ error: '请求缺少 workflow' });
    }
    const ctx = await createRun(workflow);
    void executeWorkflow(ctx.runId).catch((error) => {
      app.log.error({ err: error, runId: ctx.runId }, '工作流执行异常');
    });
    return { runId: ctx.runId };
  });

  app.get('/api/runs/:runId/events', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    if (!getRun(runId)) return reply.code(404).send({ error: '运行不存在或已过期' });
    const res = reply.raw;
    initSse(res, req.headers.origin);
    reply.hijack();
    subscribe(runId, res);
    return reply;
  });

  app.get('/api/runs/:runId', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const ctx = getRun(runId);
    if (!ctx) return reply.code(404).send({ error: '运行不存在或已过期' });
    return {
      runId: ctx.runId,
      status: ctx.status,
      nodes: ctx.workflow.nodes.map((node) => ({
        nodeId: node.id,
        name: node.name,
        kind: node.kind,
        ...(ctx.nodeResults.get(node.id) ?? { status: ctx.nodeStatus.get(node.id) ?? 'pending', rowCount: 0, durationMs: 0 }),
      })),
    };
  });

  app.get('/api/runs/:runId/preview/:nodeId', async (req, reply) => {
    const { runId, nodeId } = req.params as { runId: string; nodeId: string };
    const query = req.query as Record<string, string | undefined>;
    const rawLimit = Number(query.limit ?? PREVIEW_DEFAULT_LIMIT);
    const limit = Math.min(
      Math.max(1, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : PREVIEW_DEFAULT_LIMIT),
      PREVIEW_MAX_LIMIT,
    );

    const ctx = getRun(runId);
    if (!ctx) return reply.code(404).send({ error: '运行不存在或已过期' });

    const result = ctx.nodeResults.get(nodeId);
    if (!result || result.status !== 'success') {
      return reply.code(409).send({
        error: '该阶段尚无可用数据',
        detail: result?.error ?? `当前状态：${result?.status ?? '未知'}`,
      });
    }

    const table = tableNameForNode(nodeId);
    const columns = await describeTable(ctx.session.connection, table);
    const reader = await ctx.session.connection.runAndReadAll(
      `SELECT * FROM ${quoteIdent(table)} LIMIT ${limit + 1}`,
    );
    const rows = reader.getRowObjectsJS() as Array<Record<string, unknown>>;
    const truncated = rows.length > limit;
    const sliced = truncated ? rows.slice(0, limit) : rows;

    return {
      nodeId,
      columns,
      rows: sliced.map((row) => toJsonSafeRow(row)),
      totalRows: result.rowCount,
      truncated,
    };
  });
}
