# HUSTERYX 桌面打包设计（Tauri v2 + Node sidecar）

- 日期：2026-10-13
- 状态：已批准（sidecar 采用方案 A）
- 范围：macOS 桌面打包

## 1. 背景

HUSTERYX 定位为「单机桌面低代码 ETL 工具（简易版 Alteryx）」。当前开发形态为两个独立进程：

- 前端：React 19 + Vite，dev server `http://localhost:5173`
- 后端：Fastify + DuckDB 计算引擎，`http://127.0.0.1:8787`

仓库已含 Tauri v2 脚手架（`src-tauri/`），但 Rust 壳为空（见 `src-tauri/src/lib.rs`）：打包后仅承载前端界面，计算引擎仍需用户手动另行启动，不满足桌面应用「双击即用」的要求。

后端依赖三个原生模块（`@duckdb/node-api`、`better-sqlite3`、`mssql`），无法在 Tauri 的 Rust 内核中运行，因此 sidecar 是唯一可行的内嵌方式。

## 2. 目标

- 单个 macOS `.app` 双击启动：UI 与计算引擎一同启动、一同退出。
- 保留「连接远程后端」能力，供企业内网共享场景；本地模式为默认。
- 最大化复用现有 Node 后端代码，不重写引擎。

## 3. 非目标（YAGNI）

- 不用 Rust 重写 ETL 引擎。
- 不做多后端并发 / 集群。
- 远程模式的鉴权与 TLS 本期仅留接口，不实现。
- 本期仅 macOS；构建脚本按架构参数化，便于后续扩展 Windows / Linux。

## 4. 总体架构

```
┌─ HUSTERYX.app ───────────────────────────────────────────┐
│  Rust 主进程 (Tauri v2)                                   │
│   • 启动: 选空闲端口 → spawn Node sidecar → 等 /api/health │
│   • get_server_config() 提供给前端 (local 模式返回端口)     │
│   • 退出: kill sidecar；sidecar 崩溃 → 通知前端            │
│   • webview: 加载 frontend/dist                            │
└───────────────┬───────────────────────────────────────────┘
                │ spawn (子进程)
                ▼
┌─ Node sidecar (随包内置) ─────────────────────────────────┐
│  Fastify 127.0.0.1:<动态端口>  ← 现有 backend/dist        │
│  DuckDB / better-sqlite3 / mssql                          │
│  数据目录 ~/.husteryx (已支持 HUSTERYX_DATA_DIR)          │
└───────────────────────────────────────────────────────────┘
```

组件职责：

- **Rust 主进程**：进程编排（选端口、spawn、健康等待、退出清理）、配置读写、向前端提供 `get_server_config`。
- **Node sidecar**：现有 Fastify 服务，监听 `127.0.0.1:<动态端口>`。
- **Webview**：加载 `frontend/dist`，运行期解析 API 基址。

## 5. sidecar 打包（方案 A：内置 Node 运行时 + 精简 node_modules）

### 5.1 产物结构

```
src-tauri/resources/
  backend/            # pnpm deploy --prod 产出（含生产依赖与 .node）
    dist/
    node_modules/
    package.json
  node/
    bin/node          # 目标架构的 Node 运行时
```

### 5.2 构建流程

1. `pnpm --filter @husteryx/backend build` → `backend/dist`
2. `pnpm deploy --filter @husteryx/backend --prod ./src-tauri/resources/backend`（产出含生产依赖的独立目录）
3. 取目标架构 Node 二进制到 `resources/node/bin/node`（arm64 / x64 各一份，构建期选择）
4. `chmod +x resources/node/bin/node`
5. `tauri build`，`bundle.resources` 声明 `resources/**`
6. 签名：`resources` 内的可执行文件需随 app 一并签名

### 5.3 运行方式

Rust 用 `std::process::Command` 直接起 sidecar（不依赖 shell 插件）：

```rust
let node = resource_dir.join("node/bin/node");
let script = resource_dir.join("backend/dist/index.js");
Command::new(node)
    .arg(script)
    .env("HUSTERYX_HOST", "127.0.0.1")
    .env("HUSTERYX_PORT", port.to_string())
    .spawn()
```

## 6. 后端改动（最小）

- **端口归属**：由 Rust 主进程选定空闲端口并通过 `HUSTERYX_PORT` 传入（见 §7），后端按给定端口监听。后端额外支持 `HUSTERYX_PORT=0`（由内核分配）作为独立启动时的回退能力，此路径下需打印实际端口。
- `HOST` 固定 `127.0.0.1`（仅本机可连）。
- 优雅退出：监听 `SIGTERM` / `SIGINT` 与 `stdin` 关闭，关闭 Fastify 与 DuckDB 实例后退出。
- 数据目录沿用 `HUSTERYX_DATA_DIR`（默认 `~/.husteryx`）。
- 启动完成后输出一行可解析的就绪信息（含实际端口），供调试与回退路径读取。

现有 `backend/src/config.ts` 已支持 `HUSTERYX_HOST` / `HUSTERYX_PORT` / `HUSTERYX_DATA_DIR`；`backend/src/server.ts` 已有 `GET /api/health`，可直接用于健康等待。

## 7. Rust / Tauri 改动

- `setup()`：
  - 选端口：`TcpListener::bind("127.0.0.1:0")` 取端口后释放。
  - 生产构建 spawn sidecar；debug 构建跳过（复用外部 `:8787`）。
  - 轮询 `GET /api/health` 直到就绪或超时。
- Tauri 命令：
  - `get_server_config() -> { mode, baseUrl }`
  - `set_server_config(mode, baseUrl)`
  - `restart_sidecar()`（可选）
- 生命周期：`RunEvent::Exit` / 窗口销毁 → kill 子进程（含进程组）。
- 崩溃处理：监听子进程退出并 `emit` 事件，前端提示。

## 8. 前端改动

- `frontend/src/api/client.ts`：`API_BASE` 由编译期常量改为运行期解析。
  - 启动流程：Tauri 环境调用 `get_server_config()` 设定 baseUrl；纯浏览器环境回退 `VITE_API_BASE` / `:8787`（现有 dev 流程零影响）。
- `frontend/src/api/sse.ts`：同样使用运行期 baseUrl。
- 连接设置 UI：本地 / 远程切换，写入配置后刷新（复用或扩展 `SettingsDialog`）。

## 9. 开发体验

- `pnpm dev`：保持两进程形态，日常快速迭代不变。
- `pnpm desktop`（`tauri dev`）：Rust 在 debug 构建下不启 sidecar。
- `pnpm desktop:build`：走完整 sidecar 打包。

## 10. 错误处理

| 场景 | 处理 |
|---|---|
| sidecar 启动失败 | 窗口显示错误页 + 重试按钮 |
| 健康检查超时 | 同上，附日志路径 |
| sidecar 运行中崩溃 | 前端提示 + 可重启 |
| 端口被占用 | 用 `:0` 动态分配，基本避免 |
| 远程模式连不上 | 连接设置页报错，保留切回本地 |

## 11. 验证计划

- 开发：`pnpm dev` 现有流程不回归。
- 桌面 dev：`pnpm desktop` 能加载 UI 并连上手动后端。
- 打包：`pnpm desktop:build` 产出 `.app`，双击启动后：
  - 前端连上 sidecar（`/api/health` 返回 200）
  - 运行 `samples/workflow_join_aggregation.json` 成功
  - 关闭窗口后 `node` 子进程消失（`ps` 验证）
  - 切换远程模式并能连回
- 数据目录：`~/.husteryx/metadata.sqlite` 正常读写。

## 12. 风险

- 原生模块跨架构：需分别为 arm64 / x64 产出 sidecar。
- macOS 签名 / 公证：内置 Node 与 `.node` 需一并签名；hardened runtime 下需为 Node 开启 JIT 相关 entitlement（如 `com.apple.security.cs.allow-jit`、`allow-unsigned-executable-memory`）。
- `pnpm deploy` 与 workspace 生产依赖裁剪的兼容性需实测。

## 13. 后续（不在本期）

- 远程模式鉴权（token）/ TLS。
- Windows / Linux 打包。
- 自动更新。
