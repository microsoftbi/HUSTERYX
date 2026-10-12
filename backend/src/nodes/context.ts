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
  /** 本节点的输出表名 */
  outputTable: string;
  log: (level: NodeLogLevel['level'], message: string) => void;
}

export interface NodeResult {
  rowCount: number;
  note?: string;
}

export type NodeExecutor = (ctx: NodeContext) => Promise<NodeResult>;
