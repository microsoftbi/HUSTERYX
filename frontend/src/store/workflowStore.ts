import { create } from 'zustand';
import { api, ApiRequestError } from '@/api/client';
import { subscribeRun } from '@/api/sse';
import { NODE_META, getNodeMeta } from '@/lib/nodeMeta';
import { ancestorNodeIds } from '@/lib/graph';
import type {
  AppSettings,
  ColumnMeta,
  NodeKind,
  NodeRunStatus,
  PreviewResult,
  RunLogEvent,
  SqlServerConnection,
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
  /* 本次运行的节点范围（「运行至此」时为该节点及其上游，全量运行时为全部节点） */
  runScope: string[];

  /* 「缓存至此」状态：缓存令牌、被冻结的节点集合、边界节点 */
  cacheToken: string | null;
  cachedNodeIds: string[];
  cacheBoundaryNodeId: string | null;

  /* 阶段预览缓存 */
  previews: Record<string, PreviewEntry>;

  /* 各节点输出列（运行成功后回填，用于配置面板列下拉） */
  nodeColumns: Record<string, ColumnMeta[]>;

  /* 各输入节点探测得到的数据结构（配置完成后自动探测） */
  inputSchemas: Record<string, ColumnMeta[]>;
  inputSchemaSignatures: Record<string, string>;

  /* 应用设置（全局，所有组件共用） */
  settings: AppSettings;

  /* 画布操作 */
  addNode: (kind: NodeKind, position: { x: number; y: number }) => void;
  updateNodeName: (nodeId: string, name: string) => void;
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  setNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (edge: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => void;
  removeEdge: (edgeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  probeInputNode: (nodeId: string) => Promise<void>;
  probeAllInputs: () => Promise<void>;

  /* 应用设置 */
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;

  /* 工作流操作 */
  newWorkflow: () => void;
  setWorkflowName: (name: string) => void;
  loadWorkflow: (id: string) => Promise<void>;
  refreshWorkflowList: () => Promise<void>;
  saveWorkflow: () => Promise<Workflow | null>;
  deleteWorkflow: (id: string) => Promise<void>;

  /* 运行与预览 */
  run: (targetNodeId?: string, opts?: { freeze?: boolean }) => Promise<void>;
  /** 「缓存至此」：运行至该节点后冻结该节点及其上游，后续运行从缓存之后继续。 */
  cacheTo: (nodeId: string) => Promise<void>;
  /** 取消缓存：关闭后端被钉住会话并清空本地缓存状态。 */
  clearCache: () => Promise<void>;
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

interface ProbePlan {
  signature: string;
  fetch: () => Promise<{ columns: ColumnMeta[] }>;
}

/** 依据输入节点配置构造结构探测请求；配置不完整时返回 null。 */
function buildProbePlan(node: WorkflowNode): ProbePlan | null {
  const cfg = node.config;
  switch (node.kind) {
    case 'inputCsv': {
      const path = String(cfg.path ?? '');
      if (!path) return null;
      const delimiter = cfg.delimiter as string | undefined;
      const hasHeader = cfg.hasHeader !== false;
      const encoding = cfg.encoding as string | undefined;
      return {
        signature: JSON.stringify(['csv', path, delimiter ?? ',', hasHeader, encoding ?? 'utf-8']),
        fetch: () => api.csvSchema({ path, delimiter, hasHeader, encoding }),
      };
    }
    case 'inputExcel': {
      const path = String(cfg.path ?? '');
      if (!path) return null;
      const sheet = cfg.sheet as string | undefined;
      const hasHeader = cfg.hasHeader !== false;
      return {
        signature: JSON.stringify(['excel', path, sheet ?? '', hasHeader]),
        fetch: () => api.excelSchema({ path, sheet, hasHeader }),
      };
    }
    case 'inputSqlServer': {
      const connection = cfg.connection as SqlServerConnection | undefined;
      const query = String(cfg.query ?? '');
      if (!connection?.server || !connection.database || !connection.user || !query) return null;
      return {
        signature: JSON.stringify([
          'sqlserver',
          connection.server,
          connection.port ?? 1433,
          connection.database,
          connection.user,
          query,
        ]),
        fetch: () => api.sqlServerColumns({ connection, query }),
      };
    }
    default:
      return null;
  }
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
  runScope: [],
  cacheToken: null,
  cachedNodeIds: [],
  cacheBoundaryNodeId: null,
  inputSchemas: {},
  inputSchemaSignatures: {},
  settings: { previewRowLimit: 10000 },

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
    const sourceOutputs = NODE_META[sourceNode.kind].outputs;
    if (sourceOutputs.length === 0) return;
    if (NODE_META[targetNode.kind].inputs.length === 0) return;

    const srcHandle = sourceHandle || sourceOutputs[0].id;
    if (!sourceOutputs.some((output) => output.id === srcHandle)) return;

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
      sourceHandle: srcHandle,
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

  probeInputNode: async (nodeId) => {
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const plan = buildProbePlan(node);
    if (!plan) return;
    if (get().inputSchemaSignatures[nodeId] === plan.signature) return;

    const signature = plan.signature;
    let columns: ColumnMeta[] = [];
    try {
      const result = await plan.fetch();
      columns = result.columns;
    } catch {
      columns = [];
    }
    set((state) => ({
      inputSchemas: { ...state.inputSchemas, [nodeId]: columns },
      inputSchemaSignatures: { ...state.inputSchemaSignatures, [nodeId]: signature },
    }));
  },

  probeAllInputs: async () => {
    await Promise.all(get().nodes.map((node) => get().probeInputNode(node.id)));
  },

  loadSettings: async () => {
    try {
      const settings = await api.getSettings();
      set({ settings });
    } catch {
      /* 后端不可用时沿用当前默认值 */
    }
  },

  updateSettings: async (patch) => {
    const settings = await api.updateSettings({ ...get().settings, ...patch });
    set({ settings, previews: {} });
    // 已选节点的预览按新行数立即重取
    const { selectedNodeId, runStatus, nodeStatus } = get();
    if (selectedNodeId && runStatus === 'success' && nodeStatus[selectedNodeId] === 'success') {
      void get().loadPreview(selectedNodeId);
    }
  },

  newWorkflow: () => {
    unsubscribe?.();
    unsubscribe = null;
    const token = get().cacheToken;
    if (token) void api.deleteCache(token).catch(() => {});
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
      runScope: [],
      cacheToken: null,
      cachedNodeIds: [],
      cacheBoundaryNodeId: null,
      inputSchemas: {},
      inputSchemaSignatures: {},
    });
  },

  setWorkflowName: (name) => set({ workflowName: name, dirty: true }),

  loadWorkflow: async (id) => {
    const workflow = await api.getWorkflow(id);
    unsubscribe?.();
    unsubscribe = null;
    const token = get().cacheToken;
    if (token) void api.deleteCache(token).catch(() => {});
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
      runScope: [],
      cacheToken: null,
      cachedNodeIds: [],
      cacheBoundaryNodeId: null,
      inputSchemas: {},
      inputSchemaSignatures: {},
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

  run: async (targetNodeId, opts) => {
    const {
      nodes,
      edges,
      workflowName,
      workflowId,
      selectedNodeId,
      nodeStatus,
      nodeResults,
      previews,
      nodeColumns,
      cacheToken,
      cachedNodeIds,
    } = get();
    if (nodes.length === 0) return;

    unsubscribe?.();
    unsubscribe = null;

    const freeze = opts?.freeze === true;
    // 复用缓存：全量运行且存在有效缓存时，自动从缓存之后继续。
    const reuseToken = !freeze && !targetNodeId && cacheToken ? cacheToken : undefined;
    // 「运行至此」时执行范围为该节点及其全部上游祖先；全量运行时为 null。
    const scope = targetNodeId
      ? new Set([...ancestorNodeIds(edges, targetNodeId), targetNodeId])
      : null;

    let nextNodeStatus: Record<string, NodeRunStatus>;
    let nextNodeResults: Record<string, NodeResultState>;
    let nextPreviews: Record<string, PreviewEntry>;
    let nextNodeColumns: Record<string, ColumnMeta[]>;
    let runScopeIds: string[];

    if (reuseToken) {
      // 复用缓存：缓存节点保留既有成功结果，其余节点重置为待运行。
      nextNodeStatus = {};
      for (const node of nodes) nextNodeStatus[node.id] = 'pending';
      nextNodeResults = {};
      nextPreviews = {};
      nextNodeColumns = {};
      for (const id of cachedNodeIds) {
        nextNodeStatus[id] = 'success';
        if (nodeResults[id]) nextNodeResults[id] = nodeResults[id];
        if (previews[id]) nextPreviews[id] = previews[id];
        if (nodeColumns[id]) nextNodeColumns[id] = nodeColumns[id];
      }
      runScopeIds = nodes.map((node) => node.id);
    } else if (scope) {
      // 局部运行：只把范围内置为 pending，范围外的节点状态与结果原样保留。
      nextNodeStatus = { ...nodeStatus };
      nextNodeResults = { ...nodeResults };
      nextPreviews = { ...previews };
      nextNodeColumns = { ...nodeColumns };
      runScopeIds = [...scope];
      for (const id of scope) {
        nextNodeStatus[id] = 'pending';
        delete nextNodeResults[id];
        delete nextPreviews[id];
        delete nextNodeColumns[id];
      }
    } else {
      // 全量运行：行为与改造前一致。
      nextNodeStatus = {};
      for (const node of nodes) nextNodeStatus[node.id] = 'pending';
      nextNodeResults = {};
      nextPreviews = {};
      nextNodeColumns = {};
      runScopeIds = nodes.map((node) => node.id);
    }

    set({
      runStatus: 'running',
      runId: null,
      nodeStatus: nextNodeStatus,
      nodeResults: nextNodeResults,
      logs: [],
      previews: nextPreviews,
      nodeColumns: nextNodeColumns,
      runScope: runScopeIds,
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
      const res = await api.runWorkflow(workflow, targetNodeId, {
        ...(freeze ? { freeze: true } : {}),
        ...(reuseToken ? { cacheToken: reuseToken } : {}),
      });
      set({ runId: res.runId });
      // 「缓存至此」：记录缓存令牌与被冻结的节点集合。
      if (freeze && res.cacheToken) {
        set({
          cacheToken: res.cacheToken,
          cachedNodeIds: res.cachedNodeIds ?? [],
          cacheBoundaryNodeId: targetNodeId ?? null,
        });
      }
      const runId = res.runId;
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
            void get().fetchSchemas(runId, runScopeIds);
          }
        },
        onError: () => {
          /* EventSource 断开会自动重连；结束时由 onRunStatus 关闭 */
        },
      });
    } catch (error) {
      // 缓存已失效：清空缓存状态并自动回退到从头运行一次。
      if (reuseToken && error instanceof ApiRequestError && error.status === 400) {
        set({ cacheToken: null, cachedNodeIds: [], cacheBoundaryNodeId: null });
        await get().run();
        return;
      }
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

  cacheTo: async (nodeId) => {
    // 替换已有缓存：先解除旧缓存，再运行至该节点并冻结。
    if (get().cacheToken) await get().clearCache();
    await get().run(nodeId, { freeze: true });
  },

  clearCache: async () => {
    const token = get().cacheToken;
    if (token) {
      try {
        await api.deleteCache(token);
      } catch {
        /* 后端可能已重启或缓存已失效，忽略即可 */
      }
    }
    set({ cacheToken: null, cachedNodeIds: [], cacheBoundaryNodeId: null });
  },

  loadPreview: async (nodeId, limit) => {
    const { runId, settings, nodes } = get();
    if (!runId) return;
    // Browser 节点默认查看全部缓存数据，忽略「设置」中的行数上限。
    const isBrowser = nodes.find((node) => node.id === nodeId)?.kind === 'browser';
    const effectiveLimit = limit ?? (isBrowser ? undefined : settings.previewRowLimit);
    set((state) => ({ previews: { ...state.previews, [nodeId]: { loading: true } } }));
    try {
      const data = await api.previewNode(runId, nodeId, effectiveLimit);
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
      runScope: [],
    });
  },
}));
