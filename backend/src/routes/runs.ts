import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { PREVIEW_DEFAULT_LIMIT, PREVIEW_MAX_LIMIT } from '../config.js';
import { describeTable } from '../engine/duckdb.js';
import { executeWorkflow } from '../engine/executor.js';
import { ancestorNodeIds } from '../engine/graph.js';
import {
  CacheExpiredError,
  createRun,
  getRun,
  subscribe,
  unpinCache,
} from '../engine/runStore.js';
import type { Workflow } from '../types.js';
import { quoteIdent, tableNameForNode } from '../util/sqlIdent.js';
import { initSse } from '../util/sse.js';
import { toJsonSafeRow } from '../util/values.js';

export async function runsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/runs', async (req, reply) => {
    const body = req.body as {
      workflow?: Workflow;
      targetNodeId?: string;
      /** 「缓存至此」：本次运行成功后冻结该节点及其上游。 */
      freeze?: boolean;
      /** 复用已有缓存：从缓存节点之后继续运行。 */
      cacheToken?: string;
    };
    const workflow = body?.workflow;
    if (!workflow || !Array.isArray(workflow.nodes)) {
      return reply.code(400).send({ error: '请求缺少 workflow' });
    }
    // 「运行至此」：可选目标节点，仅执行该节点及其上游。
    const targetNodeId = body?.targetNodeId;
    if (targetNodeId && !workflow.nodes.some((node) => node.id === targetNodeId)) {
      return reply.code(400).send({ error: `目标节点不存在：${targetNodeId}` });
    }

    // 「缓存至此」：必须指定目标节点，为其分配缓存令牌并在成功后钉住会话。
    if (body?.freeze) {
      if (!targetNodeId) {
        return reply.code(400).send({ error: '缓存至此需要指定目标节点' });
      }
      const freezeToken = nanoid(12);
      const ctx = await createRun(workflow, targetNodeId, { freezeToken });
      void executeWorkflow(ctx.runId).catch((error) => {
        app.log.error({ err: error, runId: ctx.runId }, '工作流执行异常');
      });
      const cachedNodeIds = [...ancestorNodeIds(workflow, targetNodeId), targetNodeId];
      return { runId: ctx.runId, cacheToken: freezeToken, cachedNodeIds };
    }

    try {
      const ctx = await createRun(
        workflow,
        targetNodeId,
        body?.cacheToken ? { reuseToken: body.cacheToken } : undefined,
      );
      void executeWorkflow(ctx.runId).catch((error) => {
        app.log.error({ err: error, runId: ctx.runId }, '工作流执行异常');
      });
      return { runId: ctx.runId };
    } catch (error) {
      if (error instanceof CacheExpiredError) {
        return reply.code(400).send({ error: '缓存已失效', code: 'CACHE_EXPIRED' });
      }
      throw error;
    }
  });

  // 取消缓存：关闭被钉住的会话并清理前端缓存状态。
  app.delete('/api/runs/cache/:cacheToken', async (req) => {
    const { cacheToken } = req.params as { cacheToken: string };
    const ok = unpinCache(cacheToken);
    return { ok };
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

    const ctx = getRun(runId);
    if (!ctx) return reply.code(404).send({ error: '运行不存在或已过期' });

    const result = ctx.nodeResults.get(nodeId);
    if (!result || result.status !== 'success') {
      return reply.code(409).send({
        error: '该阶段尚无可用数据',
        detail: result?.error ?? `当前状态：${result?.status ?? '未知'}`,
      });
    }

    // Browser 节点默认查看全部缓存数据，不受预览上限与「设置」中的行数约束。
    const node = ctx.workflow.nodes.find((item) => item.id === nodeId);
    const takeAll = node?.kind === 'browser' && query.limit === undefined;

    const table = tableNameForNode(nodeId);
    const columns = await describeTable(ctx.session.connection, table);

    let rows: Array<Record<string, unknown>>;
    let truncated = false;
    if (takeAll) {
      const reader = await ctx.session.connection.runAndReadAll(
        `SELECT * FROM ${quoteIdent(table)}`,
      );
      rows = reader.getRowObjectsJS() as Array<Record<string, unknown>>;
    } else {
      const rawLimit = Number(query.limit ?? PREVIEW_DEFAULT_LIMIT);
      const limit = Math.min(
        Math.max(1, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : PREVIEW_DEFAULT_LIMIT),
        PREVIEW_MAX_LIMIT,
      );
      const reader = await ctx.session.connection.runAndReadAll(
        `SELECT * FROM ${quoteIdent(table)} LIMIT ${limit + 1}`,
      );
      const all = reader.getRowObjectsJS() as Array<Record<string, unknown>>;
      truncated = all.length > limit;
      rows = truncated ? all.slice(0, limit) : all;
    }

    return {
      nodeId,
      columns,
      rows: rows.map((row) => toJsonSafeRow(row)),
      totalRows: result.rowCount,
      truncated,
    };
  });
}
