import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { DB_FILE, ensureDirs } from '../config.js';
import type { Workflow } from '../types.js';

ensureDirs();

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

interface WorkflowRow {
  id: string;
  name: string;
  payload: string;
  created_at: number;
  updated_at: number;
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  const parsed = JSON.parse(row.payload) as Workflow;
  return {
    ...parsed,
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWorkflows(): Array<Pick<Workflow, 'id' | 'name' | 'createdAt' | 'updatedAt'>> {
  const rows = db
    .prepare('SELECT id, name, created_at, updated_at FROM workflows ORDER BY updated_at DESC')
    .all() as Array<Omit<WorkflowRow, 'payload'>>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getWorkflow(id: string): Workflow | null {
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow | undefined;
  return row ? rowToWorkflow(row) : null;
}

export interface SaveWorkflowInput {
  id?: string;
  name: string;
  nodes: Workflow['nodes'];
  edges: Workflow['edges'];
}

export function saveWorkflow(input: SaveWorkflowInput): Workflow {
  const now = Date.now();
  const existing = input.id ? getWorkflow(input.id) : null;
  const id = existing?.id ?? input.id ?? nanoid(10);
  const workflow: Workflow = {
    id,
    name: input.name || existing?.name || '未命名工作流',
    nodes: input.nodes ?? existing?.nodes ?? [],
    edges: input.edges ?? existing?.edges ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO workflows (id, name, payload, created_at, updated_at)
     VALUES (@id, @name, @payload, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET name = @name, payload = @payload, updated_at = @updated_at`,
  ).run({
    id: workflow.id,
    name: workflow.name,
    payload: JSON.stringify(workflow),
    created_at: workflow.createdAt,
    updated_at: workflow.updatedAt,
  });
  return workflow;
}

export function deleteWorkflow(id: string): boolean {
  const info = db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  return info.changes > 0;
}
