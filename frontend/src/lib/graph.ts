import type { WorkflowEdge } from '@/types';

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
