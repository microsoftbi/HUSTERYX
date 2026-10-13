import type {
  ApiError,
  AppSettings,
  FileUploadResult,
  PreviewResult,
  RunDetail,
  SqlServerConnection,
  SqlServerTestResult,
  Workflow,
  WorkflowSummary,
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

/** 启动时解析后端基地址：Tauri 环境读取 Rust 提供的 server config。 */
export async function initApiBase(): Promise<void> {
  const { isTauri, getServerConfig } = await import('@/lib/desktop');
  if (!isTauri()) return;
  try {
    const config = await getServerConfig();
    setApiBase(config.baseUrl);
  } catch {
    /* 保持回退地址 */
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

  /* ----------------------------- 工作流 ----------------------------- */
  listWorkflows: () => request<WorkflowSummary[]>('/api/workflows'),
  getWorkflow: (id: string) => request<Workflow>(`/api/workflows/${id}`),
  createWorkflow: (body: Pick<Workflow, 'name' | 'nodes' | 'edges'>) =>
    request<Workflow>('/api/workflows', { method: 'POST', body: JSON.stringify(body) }),
  updateWorkflow: (id: string, body: Pick<Workflow, 'name' | 'nodes' | 'edges'>) =>
    request<Workflow>(`/api/workflows/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteWorkflow: (id: string) =>
    request<{ ok: boolean }>(`/api/workflows/${id}`, { method: 'DELETE' }),

  /* ----------------------------- 运行 ----------------------------- */
  runWorkflow: (workflow: Workflow) =>
    request<{ runId: string }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ workflow }),
    }),
  getRun: (runId: string) => request<RunDetail>(`/api/runs/${runId}`),
  previewNode: (runId: string, nodeId: string, limit = 10000) =>
    request<PreviewResult>(
      `/api/runs/${runId}/preview/${encodeURIComponent(nodeId)}?limit=${limit}`,
    ),

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

  /* ----------------------------- 设置 ----------------------------- */
  getSettings: () => request<AppSettings>('/api/settings'),
  updateSettings: (body: Partial<AppSettings>) =>
    request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
};

export type { RequestError };
export { RequestError as ApiRequestError };
