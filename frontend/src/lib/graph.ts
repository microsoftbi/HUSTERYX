import type { ColumnMeta, WorkflowEdge } from '@/types';

/** 找到流入某节点指定端口的上游节点 id。 */
export function upstreamNodeId(
  edges: WorkflowEdge[],
  nodeId: string,
  handle = 'in',
): string | null {
  const edge = edges.find(
    (item) => item.target === nodeId && (item.targetHandle || 'in') === handle,
  );
  return edge ? edge.source : null;
}

/**
 * 解析某节点某输入端口当前可用的列。
 * 列信息来自「上一次运行成功后」按节点回填的 schema（nodeColumns）。
 */
export function inputColumns(
  nodeColumns: Record<string, ColumnMeta[]>,
  edges: WorkflowEdge[],
  nodeId: string,
  handle = 'in',
): ColumnMeta[] {
  const upstream = upstreamNodeId(edges, nodeId, handle);
  if (!upstream) return [];
  return nodeColumns[upstream] ?? [];
}
