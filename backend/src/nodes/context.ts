import type { DuckDBConnection } from '@duckdb/node-api';
import type { WorkflowNode } from '../types.js';

export interface NodeLogLevel {
  level: 'info' | 'warn' | 'error' | 'success';
}

export interface NodeContext {
  node: WorkflowNode;
  /** targetHandle -> 上游表名（一般节点为 'in'，Join 为 'left' / 'right'） */
  inputs: Record<string, string>;
  /** 按连线顺序排列的上游表名 */
  inputList: string[];
  connection: DuckDBConnection;
  /** 本节点主输出（'out'）的表名 */
  outputTable: string;
  /** 按输出端口取表名：handle 为空 / 'out' 即主输出，其余端口（如 'f'）映射到独立表。 */
  outputTableFor: (handle?: string | null) => string;
  log: (level: NodeLogLevel['level'], message: string) => void;
}

export interface NodeResult {
  rowCount: number;
  note?: string;
}

export type NodeExecutor = (ctx: NodeContext) => Promise<NodeResult>;
