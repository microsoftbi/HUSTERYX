import type { ServerResponse } from 'node:http';
import { nanoid } from 'nanoid';
import { RUN_TTL_MS } from '../config.js';
import type {
  NodeResultEvent,
  NodeRunStatus,
  RunLogEvent,
  RunStatusEvent,
  SseEvent,
  Workflow,
} from '../types.js';
import { closeSession, createSession, type DuckSession } from './duckdb.js';

export interface NodeResultState {
  status: NodeRunStatus;
  rowCount: number;
  durationMs: number;
  error?: string;
}

export interface RunContext {
  runId: string;
  workflow: Workflow;
  session: DuckSession;
  status: 'running' | 'success' | 'error';
  nodeStatus: Map<string, NodeRunStatus>;
  nodeResults: Map<string, NodeResultState>;
  subscribers: Set<ServerResponse>;
  events: SseEvent[];
  createdAt: number;
  lastAccess: number;
}

const MAX_BUFFERED_EVENTS = 5000;
const runs = new Map<string, RunContext>();
let evictor: NodeJS.Timeout | null = null;

function startEvictor(): void {
  if (evictor) return;
  evictor = setInterval(() => {
    const now = Date.now();
    for (const [runId, ctx] of runs.entries()) {
      if (now - ctx.lastAccess > RUN_TTL_MS) {
        disposeRun(runId);
      }
    }
  }, 60_000);
  evictor.unref?.();
}

export async function createRun(workflow: Workflow): Promise<RunContext> {
  startEvictor();
  const session = await createSession();
  const now = Date.now();
  const ctx: RunContext = {
    runId: nanoid(12),
    workflow,
    session,
    status: 'running',
    nodeStatus: new Map(),
    nodeResults: new Map(),
    subscribers: new Set(),
    events: [],
    createdAt: now,
    lastAccess: now,
  };
  for (const node of workflow.nodes) {
    ctx.nodeStatus.set(node.id, 'pending');
  }
  runs.set(ctx.runId, ctx);
  return ctx;
}

export function getRun(runId: string): RunContext | null {
  const ctx = runs.get(runId);
  if (ctx) ctx.lastAccess = Date.now();
  return ctx ?? null;
}

export function disposeRun(runId: string): void {
  const ctx = runs.get(runId);
  if (!ctx) return;
  for (const res of ctx.subscribers) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  closeSession(ctx.session);
  runs.delete(runId);
}

export function subscribe(runId: string, res: ServerResponse): boolean {
  const ctx = getRun(runId);
  if (!ctx) return false;
  ctx.lastAccess = Date.now();
  for (const event of ctx.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  ctx.subscribers.add(res);
  res.on('close', () => {
    ctx.subscribers.delete(res);
  });
  return true;
}

export function publishEvent(ctx: RunContext, event: SseEvent): void {
  ctx.lastAccess = Date.now();
  ctx.events.push(event);
  if (ctx.events.length > MAX_BUFFERED_EVENTS) {
    ctx.events.splice(0, ctx.events.length - MAX_BUFFERED_EVENTS);
  }
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of ctx.subscribers) {
    try {
      res.write(payload);
    } catch {
      ctx.subscribers.delete(res);
    }
  }
}

export function publishLog(
  ctx: RunContext,
  level: RunLogEvent['level'],
  message: string,
  nodeId?: string,
): void {
  publishEvent(ctx, { runId: ctx.runId, nodeId, level, message, ts: Date.now() });
}

export function publishNodeResult(
  ctx: RunContext,
  nodeId: string,
  status: NodeRunStatus,
  rowCount: number,
  durationMs: number,
  error?: string,
): void {
  const event: NodeResultEvent = {
    runId: ctx.runId,
    type: 'node-result',
    nodeId,
    status,
    rowCount,
    durationMs,
    error,
  };
  publishEvent(ctx, event);
}

export function publishRunStatus(
  ctx: RunContext,
  status: RunStatusEvent['status'],
  message?: string,
): void {
  publishEvent(ctx, { runId: ctx.runId, type: 'run-status', status, message });
}

export function listRuns(): Array<Pick<RunContext, 'runId' | 'status' | 'createdAt'>> {
  return [...runs.values()].map((ctx) => ({
    runId: ctx.runId,
    status: ctx.status,
    createdAt: ctx.createdAt,
  }));
}
