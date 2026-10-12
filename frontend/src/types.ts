/**
 * 前端类型契约，镜像 backend/src/types.ts（唯一事实来源）。
 * 修改节点配置结构时两端必须同步。
 */

export type NodeKind =
  | 'inputCsv'
  | 'inputExcel'
  | 'inputSqlServer'
  | 'select'
  | 'filter'
  | 'join'
  | 'aggregation'
  | 'sort'
  | 'outputCsv'
  | 'outputExcel'
  | 'outputSqlServer';

export interface Position {
  x: number;
  y: number;
}

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  name: string;
  position: Position;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount?: number;
}

/* ----------------------------- 节点配置 Schema ----------------------------- */

export interface SqlServerConnection {
  server: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

export interface InputCsvConfig {
  path: string;
  delimiter?: string;
  hasHeader?: boolean;
  encoding?: 'utf-8' | 'gbk';
}

export interface InputExcelConfig {
  path: string;
  sheet?: string;
  hasHeader?: boolean;
}

export interface InputSqlServerConfig {
  connection: SqlServerConnection;
  query: string;
}

export interface SelectField {
  source: string;
  alias?: string;
  include: boolean;
  order: number;
}

export interface SelectConfig {
  fields: SelectField[];
}

export interface FilterConfig {
  expression: string;
}

export type JoinType = 'inner' | 'left' | 'right' | 'full';

export interface JoinSelectField {
  side: 'left' | 'right';
  source: string;
  alias?: string;
  /** 是否输出该字段；undefined 视为输出（兼容旧配置）。数组顺序即输出顺序。 */
  include?: boolean;
}

export interface JoinConfig {
  joinType: JoinType;
  leftKey: string;
  rightKey: string;
  selectFields?: JoinSelectField[];
}

export type AggregationFn = 'sum' | 'count' | 'max' | 'min' | 'avg';

export interface AggregationItem {
  field: string;
  fn: AggregationFn;
  alias?: string;
}

export interface AggregationConfig {
  groupBy: string[];
  aggregations: AggregationItem[];
}

export interface SortItem {
  field: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export interface SortConfig {
  sorts: SortItem[];
}

export interface OutputCsvConfig {
  path: string;
  delimiter?: string;
  hasHeader?: boolean;
}

export interface OutputExcelConfig {
  path: string;
  sheet?: string;
}

export interface OutputSqlServerConfig {
  connection: SqlServerConnection;
  table: string;
  mode: 'append' | 'overwrite';
  createTable?: boolean;
}

/* ----------------------------- 运行与预览类型 ----------------------------- */

export type NodeRunStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface RunLogEvent {
  runId: string;
  nodeId?: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  ts: number;
}

export interface NodeResultEvent {
  runId: string;
  type: 'node-result';
  nodeId: string;
  status: NodeRunStatus;
  rowCount: number;
  durationMs: number;
  error?: string;
}

export interface RunStatusEvent {
  runId: string;
  type: 'run-status';
  status: 'running' | 'success' | 'error';
  message?: string;
}

export type SseEvent = RunLogEvent | NodeResultEvent | RunStatusEvent;

export interface ColumnMeta {
  name: string;
  type: string;
}

export interface PreviewResult {
  nodeId: string;
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
}

export interface RunNodeState {
  nodeId: string;
  name: string;
  kind: NodeKind;
  status: NodeRunStatus;
  rowCount: number;
  durationMs: number;
  error?: string;
}

export interface RunDetail {
  runId: string;
  status: 'running' | 'success' | 'error';
  nodes: RunNodeState[];
}

export interface FileUploadResult {
  path: string;
  name: string;
  size: number;
  sheets?: string[];
}

export interface SqlServerTestResult {
  ok: boolean;
  message: string;
  version?: string;
}

export interface ApiError {
  error: string;
  detail?: string;
}
