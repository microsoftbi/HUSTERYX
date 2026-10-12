前端：React + TypeScript + ReactFlow + ShadCN UI + Zustand + TanStack Table
打包：Tauri（桌面应用，单机运行）
引擎核心：DuckDB（列式引擎，自动spill、join、聚合） + Apache Arrow（数据包内存格式）
Web服务层：Fastify（Node TS）
公式编辑器：CodeMirror6
持久化：SQLite（工作流元数据） + Parquet（spill和中间缓存）
通信：SSE推送运行日志、数据预览
