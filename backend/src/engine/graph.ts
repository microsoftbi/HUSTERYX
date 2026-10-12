import type { Workflow, WorkflowNode } from '../types.js';

export interface CompiledGraph {
  /** 拓扑排序后的节点执行顺序 */
  order: WorkflowNode[];
  /** nodeId -> (targetHandle -> 上游 nodeId) */
  inputNodes: Map<string, Record<string, string>>;
}

/** 编译 DAG：校验连线、做拓扑排序并检测环。 */
export function compileGraph(workflow: Workflow): CompiledGraph {
  const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const inputNodes = new Map<string, Record<string, string>>();

  for (const node of workflow.nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, []);
    inputNodes.set(node.id, {});
  }

  for (const edge of workflow.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      throw new Error(`连线引用了不存在的节点：${edge.source} → ${edge.target}`);
    }
    adjacency.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    const handle = edge.targetHandle || 'in';
    const bucket = inputNodes.get(edge.target)!;
    if (bucket[handle] && bucket[handle] !== edge.source) {
      throw new Error(`节点「${nodeById.get(edge.target)!.name}」的输入端口 ${handle} 有多条连线`);
    }
    bucket[handle] = edge.source;
  }

  const queue: string[] = [];
  for (const [id, degree] of indegree.entries()) {
    if (degree === 0) queue.push(id);
  }

  const order: WorkflowNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(nodeById.get(id)!);
    for (const next of adjacency.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (order.length !== workflow.nodes.length) {
    throw new Error('工作流存在环路（循环依赖），无法执行');
  }

  return { order, inputNodes };
}
