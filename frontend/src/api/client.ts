import type {
  ApiError,
  AppSettings,
  FileUploadResult,
  PreviewResult,
  RunDetail,
  SqlObjectRef,
  SqlServerConnection,
  SqlServerTestResult,
  Workflow,
} from '@/types';

/** 后端基地址：纯浏览器 dev 回退到 VITE_API_BASE / :8787，Tauri 环境由 initApiBase 设定。 */
let apiBase: string =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ??
  'http://127.0.0.1:8787';

export function getApiBase(): string {
  return apiBase;
}

export function setApiBase(base: string): void {
  apiBase = base.replace(/\/$/, '');
}

/** 当前连接模式：browser=纯浏览器 dev；local=内置引擎；remote=远程服务器。 */
let apiMode: 'browser' | 'local' | 'remote' = 'browser';

/** 启动时解析后端基地址：Tauri 环境读取 Rust 提供的 server config。 */
export async function initApiBase(): Promise<void> {
  const { isTauri, getServerConfig } = await import('@/lib/desktop');
  if (!isTauri()) return;
  try {
    const config = await getServerConfig();
    setApiBase(config.baseUrl);
    apiMode = config.mode;
  } catch {
    /* 保持回退地址 */
  }
}

/**
 * 内置 sidecar 场景下，后端进程（Node+Fastify+DuckDB 冷启动约 1s）晚于 webview 首屏就绪，
 * 若首屏请求过早发起会连接被拒且不会自动恢复。这里在渲染前轮询 /api/health，就绪后再渲染；
 * 超时则照常渲染，由界面呈现离线状态。远程/纯浏览器模式不阻塞。
 */
export async function waitForBackendReady(
  timeoutMs = 20000,
  intervalMs = 250,
): Promise<boolean> {
  if (apiMode !== 'local') return true;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await api.health();
      if (res.ok) return true;
    } catch {
      /* 后端尚未监听，稍后重试 */
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

class RequestError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = payload as ApiError | undefined;
    throw new RequestError(err?.error ?? `请求失败 (${res.status})`, res.status, err?.detail);
  }
  return payload as T;
}

export const api = {
  health: () => request<{ ok: boolean; name: string; ts: number }>('/api/health'),

  /* ----------------------------- 运行 ----------------------------- */
  runWorkflow: (
    workflow: Workflow,
    targetNodeId?: string,
    opts?: { freeze?: boolean; cacheToken?: string },
  ) =>
    request<{ runId: string; cacheToken?: string; cachedNodeIds?: string[] }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        workflow,
        ...(targetNodeId ? { targetNodeId } : {}),
        ...(opts?.freeze ? { freeze: true } : {}),
        ...(opts?.cacheToken ? { cacheToken: opts.cacheToken } : {}),
      }),
    }),
  /** 取消缓存：关闭后端被钉住的会话。 */
  deleteCache: (cacheToken: string) =>
    request<{ ok: boolean }>(`/api/runs/cache/${encodeURIComponent(cacheToken)}`, {
      method: 'DELETE',
    }),
  getRun: (runId: string) => request<RunDetail>(`/api/runs/${runId}`),
  /** limit 省略时不带行数参数：Browser 节点据此返回全部缓存数据。 */
  previewNode: (runId: string, nodeId: string, limit?: number) => {
    const base = `/api/runs/${runId}/preview/${encodeURIComponent(nodeId)}`;
    return request<PreviewResult>(limit === undefined ? base : `${base}?limit=${limit}`);
  },

  /* ----------------------------- 文件 ----------------------------- */
  uploadFile: async (file: File): Promise<FileUploadResult> => {
    const form = new FormData();
    form.append('file', file);
    return request<FileUploadResult>('/api/files/upload', { method: 'POST', body: form });
  },
  listSheets: (path: string) =>
    request<{ sheets: string[] }>(`/api/files/sheets?path=${encodeURIComponent(path)}`),

  /* ----------------------------- 结构探测 ----------------------------- */
  csvSchema: (body: { path: string; delimiter?: string; hasHeader?: boolean; encoding?: string }) =>
    request<{ columns: { name: string; type: string }[] }>('/api/schema/csv', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  excelSchema: (body: { path: string; sheet?: string; hasHeader?: boolean }) =>
    request<{ columns: { name: string; type: string }[] }>('/api/schema/excel', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /* ----------------------------- 连接 ----------------------------- */
  testSqlServer: (connection: SqlServerConnection) =>
    request<SqlServerTestResult>('/api/connections/sqlserver/test', {
      method: 'POST',
      body: JSON.stringify({ connection }),
    }),
  sqlServerColumns: (body: { connection: SqlServerConnection; table?: string; query?: string }) =>
    request<{ columns: { name: string; type: string }[] }>('/api/connections/sqlserver/columns', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listSqlDatabases: (connection: SqlServerConnection) =>
    request<{ databases: string[] }>('/api/connections/sqlserver/databases', {
      method: 'POST',
      body: JSON.stringify({ connection }),
    }),
  listSqlObjects: (connection: SqlServerConnection) =>
    request<{ objects: SqlObjectRef[] }>('/api/connections/sqlserver/objects', {
      method: 'POST',
      body: JSON.stringify({ connection }),
    }),

  /* ----------------------------- 设置 ----------------------------- */
  getSettings: () => request<AppSettings>('/api/settings'),
  updateSettings: (body: Partial<AppSettings>) =>
    request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
};

export type { RequestError };
export { RequestError as ApiRequestError };
