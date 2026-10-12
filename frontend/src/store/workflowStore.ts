import { create } from 'zustand';
import { api } from '@/api/client';
import { subscribeRun } from '@/api/sse';
import { NODE_META, getNodeMeta } from '@/lib/nodeMeta';
import type {
  ColumnMeta,
  NodeKind,
  NodeRunStatus,
  PreviewResult,
  RunLogEvent,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowSummary,
} from '@/types';

const MAX_LOGS = 2000;

export interface PreviewEntry {
  loading?: boolean;
  error?: string;
  data?: PreviewResult;
}

interface NodeResultState {
  rowCount: number;
  durationMs: number;
  error?: string;
}

interface WorkflowState {
  /* 工作流本身 */
  workflowId: string | null;
  workflowName: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
  dirty: boolean;

  /* 工作流列表 */
  workflowList: WorkflowSummary[];

  /* 运行状态 */
  runId: string | null;
  runStatus: 'idle' | 'running' | 'success' | 'error';
  nodeStatus: Record<string, NodeRunStatus>;
  nodeResults: Record<string, NodeResultState>;
  logs: RunLogEvent[];

  /* 阶段预览缓存 */
  previews: Record<string, PreviewEntry>;

  /* 各节点输出列（运行成功后回填，用于配置面板列下拉） */
  nodeColumns: Record<string, ColumnMeta[]>;

  /* 画布操作 */
  addNode: (kind: NodeKind, position: { x: number; y: number }) => void;
  updateNodeName: (nodeId: string, name: string) => void;
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  setNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (edge: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => void;
  removeEdge: (edgeId: string) => void;
  selectNode: (nodeId: string | null) => void;

  /* 工作流操作 */
  newWorkflow: () => void;
  setWorkflowName: (name: string) => void;
  loadWorkflow: (id: string) => Promise<void>;
  refreshWorkflowList: () => Promise<void>;
  saveWorkflow: () => Promise<Workflow | null>;
  deleteWorkflow: (id: string) => Promise<void>;

  /* 运行与预览 */
  run: () => Promise<void>;
  loadPreview: (nodeId: string, limit?: number) => Promise<void>;
  fetchSchemas: (runId: string, nodeIds: string[]) => Promise<void>;
  clearLogs: () => void;
  clearRunState: () => void;
}

let unsubscribe: (() => void) | null = null;

function nextNodeId(nodes: WorkflowNode[]): string {
  let max = 0;
  for (const node of nodes) {
    const match = /^n(\d+)$/.exec(node.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `n${max + 1}`;
}

function nextEdgeId(edges: WorkflowEdge[]): string {
  let max = 0;
  for (const edge of edges) {
    const match = /^e(\d+)$/.exec(edge.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `e${max + 1}`;
}

function buildAdjacency(edges: WorkflowEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.source) ?? [];
    list.push(edge.target);
    map.set(edge.source, list);
  }
  return map;
}

/** 判断从 from 出发能否到达 to，用于阻止成环。 */
function reachable(edges: WorkflowEdge[], from: string, to: string): boolean {
  const adjacency = buildAdjacency(edges);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === to) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}

export const useWorkflowStore = create<WorkflowState>()((set, get) => ({
  workflowId: null,
  workflowName: '未命名工作流',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  dirty: false,

  workflowList: [],

  runId: null,
  runStatus: 'idle',
  nodeStatus: {},
  nodeResults: {},
  logs: [],
  previews: {},
  nodeColumns: {},

  addNode: (kind, position) => {
    const meta = getNodeMeta(kind);
    const node: WorkflowNode = {
      id: nextNodeId(get().nodes),
      kind,
      name: meta.label,
      position,
      config: structuredClone(meta.defaultConfig),
    };
    set((state) => ({
      nodes: [...state.nodes, node],
      selectedNodeId: node.id,
      dirty: true,
    }));
  },

  updateNodeName: (nodeId, name) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, name } : node)),
      dirty: true,
    })),

  updateNodeConfig: (nodeId, config) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, config } : node)),
      dirty: true,
      previews: {},
    })),

  setNodePosition: (nodeId, position) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
      dirty: true,
    })),

  removeNode: (nodeId) =>
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== nodeId),
      edges: state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      dirty: true,
    })),

  addEdge: ({ source, target, sourceHandle, targetHandle }) => {
    const { nodes, edges } = get();
    if (source === target) return;
    const sourceNode = nodes.find((n) => n.id === source);
    const targetNode = nodes.find((n) => n.id === target);
    if (!sourceNode || !targetNode) return;
    if (!NODE_META[sourceNode.kind].hasOutput) return;
    if (NODE_META[targetNode.kind].inputs.length === 0) return;

    const handle = targetHandle || NODE_META[targetNode.kind].inputs[0].id;
    const validHandle = NODE_META[targetNode.kind].inputs.some((input) => input.id === handle);
    if (!validHandle) return;

    // 同一目标端口只允许一条连线
    const occupied = edges.some(
      (edge) => edge.target === target && (edge.targetHandle || 'in') === handle,
    );
    if (occupied) return;

    // 阻止成环
    if (reachable(edges, target, source)) return;

    const edge: WorkflowEdge = {
      id: nextEdgeId(edges),
      source,
      target,
      sourceHandle: sourceHandle || 'out',
      targetHandle: handle,
    };
    set({ edges: [...edges, edge], dirty: true });
  },

  removeEdge: (edgeId) =>
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId),
      dirty: true,
    })),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  newWorkflow: () => {
    unsubscribe?.();
    unsubscribe = null;
    set({
      workflowId: null,
      workflowName: '未命名工作流',
      nodes: [],
      edges: [],
      selectedNodeId: null,
      dirty: false,
      runId: null,
      runStatus: 'idle',
      nodeStatus: {},
      nodeResults: {},
      logs: [],
      previews: {},
      nodeColumns: {},
    });
  },

  setWorkflowName: (name) => set({ workflowName: name, dirty: true }),

  loadWorkflow: async (id) => {
    const workflow = await api.getWorkflow(id);
    unsubscribe?.();
    unsubscribe = null;
    set({
      workflowId: workflow.id,
      workflowName: workflow.name,
      nodes: workflow.nodes,
      edges: workflow.edges.map((edge) => ({
        ...edge,
        targetHandle: edge.targetHandle || 'in',
        sourceHandle: edge.sourceHandle || 'out',
      })),
      selectedNodeId: null,
      dirty: false,
      runId: null,
      runStatus: 'idle',
      nodeStatus: {},
      nodeResults: {},
      logs: [],
      previews: {},
      nodeColumns: {},
    });
  },

  refreshWorkflowList: async () => {
    const list = await api.listWorkflows();
    set({
      workflowList: list.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        nodeCount: workflow.nodeCount ?? 0,
      })),
    });
  },

  saveWorkflow: async () => {
    const { workflowId, workflowName, nodes, edges } = get();
    const payload = { name: workflowName || '未命名工作流', nodes, edges };
    const saved = workflowId
      ? await api.updateWorkflow(workflowId, payload)
      : await api.createWorkflow(payload);
    set({ workflowId: saved.id, workflowName: saved.name, dirty: false });
    await get().refreshWorkflowList();
    return saved;
  },

  deleteWorkflow: async (id) => {
    await api.deleteWorkflow(id);
    if (get().workflowId === id) get().newWorkflow();
    await get().refreshWorkflowList();
  },

  run: async () => {
    const { nodes, edges, workflowName, workflowId, selectedNodeId } = get();
    if (nodes.length === 0) return;

    unsubscribe?.();
    unsubscribe = null;

    const initialStatus: Record<string, NodeRunStatus> = {};
    for (const node of nodes) initialStatus[node.id] = 'pending';

    set({
      runStatus: 'running',
      runId: null,
      nodeStatus: initialStatus,
      nodeResults: {},
      logs: [],
      previews: {},
      nodeColumns: {},
    });

    const workflow: Workflow = {
      id: workflowId ?? 'temp',
      name: workflowName,
      nodes,
      edges,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const { runId } = await api.runWorkflow(workflow);
      set({ runId });
      unsubscribe = subscribeRun(runId, {
        onLog: (event) =>
          set((state) => ({ logs: [...state.logs, event].slice(-MAX_LOGS) })),
        onNodeResult: (event) =>
          set((state) => {
            const nodeResults = { ...state.nodeResults };
            if (event.status !== 'running') {
              nodeResults[event.nodeId] = {
                rowCount: event.rowCount,
                durationMs: event.durationMs,
                error: event.error,
              };
            }
            return {
              nodeStatus: { ...state.nodeStatus, [event.nodeId]: event.status },
              nodeResults,
            };
          }),
        onRunStatus: (event) => {
          set({ runStatus: event.status });
          if (event.status === 'success') {
            if (selectedNodeId) void get().loadPreview(selectedNodeId);
            void get().fetchSchemas(runId, Object.keys(initialStatus));
          }
        },
        onError: () => {
          /* EventSource 断开会自动重连；结束时由 onRunStatus 关闭 */
        },
      });
    } catch (error) {
      set((state) => ({
        runStatus: 'error',
        logs: [
          ...state.logs,
          {
            runId: '',
            level: 'error' as const,
            message: error instanceof Error ? error.message : String(error),
            ts: Date.now(),
          },
        ],
      }));
    }
  },

  loadPreview: async (nodeId, limit = 200) => {
    const { runId } = get();
    if (!runId) return;
    set((state) => ({ previews: { ...state.previews, [nodeId]: { loading: true } } }));
    try {
      const data = await api.previewNode(runId, nodeId, limit);
      set((state) => ({ previews: { ...state.previews, [nodeId]: { data } } }));
    } catch (error) {
      set((state) => ({
        previews: {
          ...state.previews,
          [nodeId]: { error: error instanceof Error ? error.message : String(error) },
        },
      }));
    }
  },

  fetchSchemas: async (runId, nodeIds) => {
    const columns: Record<string, ColumnMeta[]> = {};
    await Promise.all(
      nodeIds.map(async (nodeId) => {
        if (get().nodeStatus[nodeId] !== 'success') return;
        try {
          const result = await api.previewNode(runId, nodeId, 1);
          columns[nodeId] = result.columns;
        } catch {
          /* 该阶段无数据时忽略 */
        }
      }),
    );
    set({ nodeColumns: columns });
  },

  clearLogs: () => set({ logs: [] }),

  clearRunState: () => {
    unsubscribe?.();
    unsubscribe = null;
    set({
      runId: null,
      runStatus: 'idle',
      nodeStatus: {},
      nodeResults: {},
      logs: [],
      previews: {},
      nodeColumns: {},
    });
  },
}));
