# HUSTERYX 第一阶段实现计划

> **For agentic workers:** 本项目为绿地脚手架，采用 Inline Execution（executing-plans）在本会话中执行。

**Goal:** 构建单机桌面低代码 ETL 工具（简易版 Alteryx）第一阶段：拖拽 DAG 画布 + 配置节点 + 运行工作流 + 点击阶段查看缓存数据。

**Architecture:** 前后端分离。前端 React + ReactFlow + Zustand 负责画布与配置；后端 Fastify(TS) 承载 DuckDB 计算引擎，DAG 拓扑调度，SSE 推送日志与样本。工作流元数据存 SQLite，中间缓存与 spill 用 Parquet。Tauri 作为最终桌面外壳（开发期用浏览器 + 独立进程）。

**Tech Stack:** React 18 / TypeScript / Vite / @xyflow/react / Zustand / TanStack Table / Tailwind + ShadCN / CodeMirror6 / Fastify / @duckdb/node-api / mssql / xlsx / better-sqlite3 / Tauri v2。

**Spec:** `INIT.md`, `TECH.md`

## Global Constraints

- 单机流式优先，**不手写 join / spill 逻辑**，全部交给 DuckDB。
- 不做分布式。
- 第一阶段输入：CSV, Excel, SQLServer；输出：CSV, Excel, SQLServer。
- 转换节点：Select, Filter, Join, Aggregation（Sum/Count/Max/Min/Avg）, Sort。
- 交互完全遵循 Alteryx：拖拽 DAG → 配置参数 → 运行工作流 → 点击阶段查看缓存数据。
- 产物目录：`/Users/wadesong/Desktop/TEST/HUSTERYX`。

## 关键契约

### 工作流 DAG JSON（前后端共享结构）

```ts
type NodeKind =
  | 'inputCsv' | 'inputExcel' | 'inputSqlServer'
  | 'select' | 'filter' | 'join' | 'aggregation' | 'sort'
  | 'outputCsv' | 'outputExcel' | 'outputSqlServer';

interface WorkflowNode {
  id: string;              // 唯一，DuckDB 表名 = "n_" + id(sanitized)
  kind: NodeKind;
  name: string;            // 用户可见名称
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

interface WorkflowEdge { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; }

interface Workflow {
  id: string; name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[];
  createdAt: number; updatedAt: number;
}
```

### 节点 config 约定

- `inputCsv`: `{ path, delimiter?: ','|'\t'|'|', hasHeader?: boolean, encoding?: 'utf-8'|'gbk' }`
- `inputExcel`: `{ path, sheet?: string, hasHeader?: boolean }`
- `inputSqlServer`: `{ connection: SqlConn, query: string }`，`SqlConn = { server, port?, database, user, password, encrypt?, trustServerCertificate? }`
- `select`: `{ fields: { source: string; alias?: string; include: boolean; order: number }[] }`
- `filter`: `{ expression: string }`（SQL 布尔表达式，如 `"amount" > 100 AND status = 'PAID'`）
- `join`: `{ joinType: 'inner'|'left'|'right'|'full', leftKey: string, rightKey: string, selectFields?: { side: 'left'|'right'; source: string; alias?: string }[] }`
- `aggregation`: `{ groupBy: string[], aggregations: { field: string; fn: 'sum'|'count'|'max'|'min'|'avg'; alias?: string }[] }`
- `sort`: `{ sorts: { field: string; direction: 'asc'|'desc'; nulls?: 'first'|'last' }[] }`
- `outputCsv`: `{ path, delimiter?: string, hasHeader?: boolean }`
- `outputExcel`: `{ path, sheet?: string }`
- `outputSqlServer`: `{ connection: SqlConn, table: string, mode: 'append'|'overwrite', createTable?: boolean }`

### 执行与预览模型

- 每次运行创建独立 DuckDB `:memory:` 实例（`temp_directory` 指向 appData/spill，Parquet 落盘）。
- 每个节点执行后物化为表 `n_<id>`；下游节点通过表名引用上游。
- 运行结束后保留运行上下文（连接与表）供预览，TTL 30 分钟 LRU 淘汰。
- 预览：`SELECT * FROM n_<id> LIMIT ?`（默认 200）。
- 日志事件：`{ runId, nodeId?, level: 'info'|'warn'|'error'|'success', message, ts }`。
- 节点结果事件：`{ nodeId, status, rowCount, durationMs, error? }`。

### HTTP / SSE API

- `GET  /api/health`
- `GET  /api/workflows` / `POST /api/workflows` / `GET|PUT|DELETE /api/workflows/:id`
- `POST /api/runs`（body: `{ workflow }`）→ `{ runId }`
- `GET  /api/runs/:runId/events`（SSE）
- `GET  /api/runs/:runId/preview/:nodeId?limit=200` → `{ columns: {name,type}[], rows: Record<string,unknown>[] }`
- `POST /api/files/upload`（multipart）→ `{ path }`
- `GET  /api/files/sheets?path=` → `{ sheets: string[] }`
- `POST /api/connections/sqlserver/test` → `{ ok, message, version? }`
- `POST /api/connections/sqlserver/columns`（body: SqlConn + table/query）→ `{ columns }`

## 目录结构

```
HUSTERYX/
├── package.json / pnpm-workspace.yaml / tsconfig.base.json / .gitignore
├── backend/src/{index,server,config,types}.ts
├── backend/src/db/sqlite.ts
├── backend/src/engine/{duckdb,graph,executor,registry,runStore}.ts
├── backend/src/nodes/{inputCsv,inputExcel,inputSqlServer,outputCsv,outputExcel,outputSqlServer,select,filter,join,aggregation,sort}.ts
├── backend/src/routes/{workflows,runs,files,connections}.ts
├── backend/src/util/{sqlIdent,sse,pagination}.ts
├── frontend/src/{main,App,index.css,types}.tsx|ts
├── frontend/src/api/{client,sse}.ts
├── frontend/src/store/workflowStore.ts
├── frontend/src/components/ui/*            # ShadCN 风格原子组件
├── frontend/src/components/canvas/*        # ReactFlow + 节点 + 工具栏
├── frontend/src/components/panels/*        # 各节点配置面板
├── frontend/src/components/preview/*       # 预览表 + 日志
├── frontend/src/pages/Workbench.tsx
└── src-tauri/{Cargo.toml,tauri.conf.json,build.rs,src/main.rs}
```

## 任务拆分

### Task 1 脚手架与根配置
Files: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `README.md`
- [ ] 根 package.json 定义 workspaces 与 `dev`（并发起前后端）、`build`。
- [ ] tsconfig.base.json 共享编译选项。
- [ ] 验证 `pnpm -w install` 成功。

### Task 2 后端骨架
Files: `backend/package.json`, `backend/tsconfig.json`, `backend/src/{types,config,server,index}.ts`, `backend/src/db/sqlite.ts`
- [ ] 定义 types 契约；SQLite 建表 workflows。
- [ ] Fastify 注册 cors/multipart/路由；`/api/health` 返回 ok。
- [ ] 验证 `curl :8787/api/health`。

### Task 3 引擎
Files: `engine/{duckdb,graph,runStore,registry,executor}.ts`, `util/{sqlIdent,sse}.ts`
- [ ] DuckDB 单例实例管理 + 每 run 连接；temp_directory 指向 spill。
- [ ] 拓扑排序 + 环检测；执行器逐节点派发并 emit 事件。
- [ ] runStore 保存 run 状态、节点结果、预览数据源；LRU/TTL。
- [ ] 验证：手工构造 CSV→Select 工作流，POST /api/runs 后 SSE 收到节点结果，preview 返回数据。

### Task 4 输入节点
Files: `nodes/{inputCsv,inputExcel,inputSqlServer}.ts`
- [ ] CSV 用 `read_csv_auto`（含 delimiter/encoding/header 选项）。
- [ ] Excel 用 `xlsx` 解析为行 → 写入 DuckDB 表（类型推断）。
- [ ] SQLServer 用 `mssql` 查询 → 写入 DuckDB 表（按列元数据建表、批量插入）。
- [ ] 验证：三类输入各自 preview 有数据。

### Task 5 转换节点
Files: `nodes/{select,filter,join,aggregation,sort}.ts`
- [ ] Select 投影/重命名/重排；Filter 表达式过滤；Join 多类型；Aggregation group by + 5 聚合；Sort 多键排序。
- [ ] 验证：对样例数据逐一 preview 正确。

### Task 6 输出节点与 API
Files: `nodes/{outputCsv,outputExcel,outputSqlServer}.ts`, `routes/{workflows,runs,files,connections}.ts`
- [ ] CSV 用 `COPY ... TO (FORMAT CSV, HEADER)`；Excel 用 xlsx 写文件；SQLServer 建表+批量写回。
- [ ] 文件上传、Excel 工作表列表、SQLServer 连接测试与列探测路由。
- [ ] 验证：端到端运行含输出的工作流，产物文件/表落盘正确。

### Task 7 前端基础
Files: `frontend/*` 配置与 `src/{main,App,index.css,types}.ts(x)`, `api/*`, `store/workflowStore.ts`, `components/ui/*`
- [ ] Vite + Tailwind + ShadCN 原子组件（button/input/select/dialog/tabs/table/sheet/label/textarea）。
- [ ] Zustand store：nodes/edges/选中节点/运行状态/预览缓存。
- [ ] API client + SSE 客户端。
- [ ] 验证：`pnpm dev` 前端可启动，健康检查通过。

### Task 8 前端画布
Files: `components/canvas/{FlowCanvas,NodeCard,NodePalette,Toolbar}.tsx`, `pages/Workbench.tsx`
- [ ] 左侧节点面板拖拽生成节点；ReactFlow 连线；删除/选中。
- [ ] 工具栏：新建/保存/加载/运行；阶段状态着色。
- [ ] 验证：拖拽连线保存后重新加载 DAG 一致。

### Task 9 前端面板
Files: `components/panels/*`, `components/preview/{DataPreview,RunLog}.tsx`
- [ ] 各节点配置面板；Filter/Select 表达式 CodeMirror6。
- [ ] 点击节点 → 右侧 Sheet 面板：配置 Tab + 预览 Tab（TanStack Table 虚拟滚动/分页）。
- [ ] 运行日志面板消费 SSE。
- [ ] 验证：运行后点击阶段可看到缓存数据。

### Task 10 Tauri 壳与联调
Files: `src-tauri/*`, 根 `package.json` 脚本
- [ ] tauri.conf.json 指向前端 dev/build，配置 backend 为 sidecar。
- [ ] `pnpm dev` 一键起前后端；端到端跑通一个完整工作流。
- [ ] 验证：完整流程录制为验证记录。

## 验证方式

- 提供 `samples/` 样例 CSV/Excel。
- 端到端脚本：启动后端 → 构造含 CSV→Filter→Aggregation→Output CSV 的工作流 → 断言 SSE 事件与产物内容。
