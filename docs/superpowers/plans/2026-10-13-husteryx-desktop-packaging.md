# HUSTERYX 桌面打包实施计划（Tauri v2 + Node sidecar）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 HUSTERYX 产出可双击启动的单个 macOS `.app`，UI 与 Fastify+DuckDB 计算引擎一同启动、一同退出，并保留切换到远程后端的能力。

**Architecture:** Tauri v2 的 Rust 主进程负责编排：选一个空闲端口 → 用内置 Node 运行时 spawn 现有 `backend/dist/index.js` 作为 sidecar → 轮询 `/api/health` 就绪 → 通过 `get_server_config` 把实际 baseUrl 交给前端。前端把 API 基址从编译期常量改为运行期解析。打包阶段用 `pnpm deploy --prod` 精简后端生产依赖，连同 Node 二进制一起作为 Tauri `bundle.resources` 打进 `.app`。

**Tech Stack:** Tauri v2（Rust 2021 / crate `husteryx`）、Fastify 5 + DuckDB + better-sqlite3（Node 22 ESM）、React 19 + Vite 8 + Zustand、pnpm 10 workspace、`@tauri-apps/api` v2。

**Spec:** [2026-10-13-husteryx-desktop-packaging-design.md](file:///Users/wadesong/Desktop/TEST/HUSTERYX/docs/superpowers/specs/2026-10-13-husteryx-desktop-packaging-design.md)

## Global Constraints

- 本期仅 macOS；构建脚本按目标架构参数化，但只实现 darwin-arm64 的正确路径（`process.execPath` 即当前架构 Node）。
- 后端监听地址固定 `127.0.0.1`；端口来自 `HUSTERYX_PORT`；`HUSTERYX_PORT=0` 表示由内核分配并在就绪行打印实际端口。
- 数据目录沿用 `HUSTERYX_DATA_DIR`（默认 `~/.husteryx`）。
- Rust 必须用 `std::process::Command` 直接起 sidecar，**不引入 `tauri-plugin-shell`**。
- `pnpm dev`（纯浏览器 + 独立后端）流程必须零回归：Tauri 能力缺失时前端回退 `VITE_API_BASE` / `http://127.0.0.1:8787`。
- 不引入任何测试框架（仓库当前没有测试设施）；验证统一用可执行命令（`tsc --noEmit`、`cargo test`、`cargo check`、`curl`、`ps`、`ls`）。
- 后端包名 `@husteryx/backend`，构建产物入口 `backend/dist/index.js`；前端包名 `@husteryx/frontend`。
- 类型契约 `frontend/src/types.ts` 镜像 `backend/src/types.ts`；修改需同步。

---

### Task 1: 后端就绪输出与优雅退出

让 sidecar 在被外部进程拉起时能①按 `HUSTERYX_PORT`（含 `0`）监听、②打印一行可解析的就绪信息（含实际端口）、③在收到 `SIGTERM`/`SIGINT` 或 stdin 关闭时优雅退出。

**Files:**
- Modify: [backend/src/index.ts](file:///Users/wadesong/Desktop/TEST/HUSTERYX/backend/src/index.ts)
- Modify: [backend/src/db/sqlite.ts](file:///Users/wadesong/Desktop/TEST/HUSTERYX/backend/src/db/sqlite.ts)
- Test: 命令行验证（见步骤 2、5）

**Interfaces:**
- Consumes: `HOST`、`PORT`（已存在，`Number(process.env.HUSTERYX_PORT || 8787)`，`"0"` 会解析为 `0`，因此 `HUSTERYX_PORT=0` 天然可用）、`ensureDirs()`、`buildServer()`。
- Produces: 就绪行格式 `HUSTERYX_READY {"port":<number>,"host":"127.0.0.1"}`（写到 stdout）；`closeDb(): void`（从 `db/sqlite.ts` 导出）。

- [ ] **Step 1: 为 sqlite 增加关闭函数**

在 [backend/src/db/sqlite.ts](file:///Users/wadesong/Desktop/TEST/HUSTERYX/backend/src/db/sqlite.ts) 文件末尾（`deleteWorkflow` 之后）追加：

```ts
/** 关闭底层 SQLite 连接，供进程退出时调用。 */
export function closeDb(): void {
  try {
    db.close();
  } catch {
    /* 已关闭时忽略 */
  }
}
```

- [ ] **Step 2: 先确认现状——旧代码不打印就绪行**

Run:
```bash
pnpm --filter @husteryx/backend build && (HUSTERYX_PORT=0 node backend/dist/index.js & echo $! > /tmp/hx.pid; sleep 2; kill "$(cat /tmp/hx.pid)" 2>/dev/null)
```
Expected: 输出中**没有** `HUSTERYX_READY` 字样（只有 fastify 的启动日志），说明需要改动。

- [ ] **Step 3: 改写 index.ts**

将 [backend/src/index.ts](file:///Users/wadesong/Desktop/TEST/HUSTERYX/backend/src/index.ts) 整体替换为：

```ts
import type { AddressInfo } from 'node:net';
import { HOST, PORT, ensureDirs } from './config.js';
import { buildServer } from './server.js';
import { closeDb } from './db/sqlite.js';

async function main(): Promise<void> {
  ensureDirs();
  const app = await buildServer();

  try {
    await app.listen({ host: HOST, port: PORT });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  const address = app.server.address() as AddressInfo;
  const port = address.port;
  app.log.info(`HUSTERYX backend 已启动：http://${HOST}:${port}`);
  // 可解析就绪行：Rust 与调试脚本据此获知实际端口（HUSTERYX_PORT=0 时为内核分配值）。
  process.stdout.write(`HUSTERYX_READY ${JSON.stringify({ port, host: HOST })}\n`);

  let closing = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
      closeDb();
    } finally {
      app.log.info(`收到 ${reason}，进程退出`);
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // stdin 仅在非 TTY 时监听：sidecar 由父进程通过管道持有 stdin，管道关闭即代表应退出。
  // 在终端直接运行时 stdin 是 TTY，此时跳过，避免误判为关闭信号。
  if (!process.stdin.isTTY) {
    process.stdin.on('close', () => void shutdown('stdin close'));
    process.stdin.resume();
  }
}

void main();
```

- [ ] **Step 4: 后端类型检查**

Run: `pnpm --filter @husteryx/backend exec tsc -p tsconfig.json --noEmit`
Expected: 退出码 0，无输出。

- [ ] **Step 5: 验证就绪行与动态端口**

Run:
```bash
pnpm --filter @husteryx/backend build
HUSTERYX_PORT=0 node backend/dist/index.js > /tmp/hx-ready.log 2>&1 &
HX_PID=$!
sleep 2
grep HUSTERYX_READY /tmp/hx-ready.log
PORT=$(grep -o '"port":[0-9]*' /tmp/hx-ready.log | head -1 | cut -d: -f2)
curl -s -o /dev/null -w "health=%{http_code}\n" "http://127.0.0.1:${PORT}/api/health"
kill "$HX_PID"; sleep 1
```
Expected: 出现 `HUSTERYX_READY {"port":<N>,"host":"127.0.0.1"}`，且 `health=200`。

- [ ] **Step 6: 提交**

```bash
git add backend/src/index.ts backend/src/db/sqlite.ts
git commit -m "feat(backend): 输出可解析就绪行并在退出信号下优雅关闭"
```

---

### Task 2: Rust sidecar 模块（选端口 / 启动 / 健康等待 / 终止）

新增一个独立的 Rust 模块，封装所有与 Node 子进程相关的纯逻辑，便于单独测试与复用。

**Files:**
- Create: `src-tauri/src/sidecar.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/src/sidecar.rs` 内的 `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: 无（仅标准库 + `libc`）。
- Produces:
  - `pub struct SidecarSpec { pub node_bin: PathBuf, pub script: PathBuf, pub port: u16, pub data_dir: Option<PathBuf> }`
  - `pub fn pick_free_port() -> io::Result<u16>`
  - `pub fn spawn(spec: &SidecarSpec) -> io::Result<Child>`
  - `pub fn health_ok(port: u16) -> bool`
  - `pub fn wait_until_ready(port: u16, timeout: Duration) -> bool`

- [ ] **Step 1: 添加 libc 依赖**

在 [src-tauri/Cargo.toml](file:///Users/wadesong/Desktop/TEST/HUSTERYX/src-tauri/Cargo.toml) 的 `[dependencies]` 段（`serde_json = "1"` 之后）追加一行：

```toml
libc = "0.2"
```

- [ ] **Step 2: 写失败测试**

创建 `src-tauri/src/sidecar.rs`，先只写结构体与测试：

```rust
use std::io;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_free_port_returns_bindable_port() {
        let port = pick_free_port().expect("应能选到空闲端口");
        assert!(port > 0);
        // 立即可以重新绑定，说明该端口确实空闲
        let listener = TcpListener::bind(("127.0.0.1", port)).expect("端口应可绑定");
        drop(listener);
    }

    #[test]
    fn health_ok_is_false_for_closed_port() {
        let port = pick_free_port().expect("选端口");
        assert!(!health_ok(port));
    }

    #[test]
    fn health_ok_is_true_for_a_listening_socket() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("绑定");
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 128];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
            }
        });
        assert!(health_ok(port));
    }

    #[test]
    fn wait_until_ready_times_out_when_nothing_listens() {
        let port = pick_free_port().expect("选端口");
        let start = Instant::now();
        assert!(!wait_until_ready(port, Duration::from_millis(400)));
        assert!(start.elapsed() >= Duration::from_millis(400));
    }
}
```

（`pick_free_port` / `health_ok` / `wait_until_ready` 尚未定义，因此该测试当前无法编译。）

- [ ] **Step 3: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml sidecar`
Expected: 编译错误 `cannot find function pick_free_port in this scope`（或同类未定义错误）。

- [ ] **Step 4: 实现完整模块**

把 `src-tauri/src/sidecar.rs` 替换为（测试保留在文件末尾）：

```rust
use std::io;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// sidecar 启动参数。
pub struct SidecarSpec {
    pub node_bin: PathBuf,
    pub script: PathBuf,
    pub port: u16,
    pub data_dir: Option<PathBuf>,
}

/// 选一个空闲端口：绑定 :0 后读取实际端口并立即释放。
pub fn pick_free_port() -> io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

/// 按规格启动 Node sidecar。
pub fn spawn(spec: &SidecarSpec) -> io::Result<Child> {
    let mut cmd = Command::new(&spec.node_bin);
    cmd.arg(&spec.script)
        .env("HUSTERYX_HOST", "127.0.0.1")
        .env("HUSTERYX_PORT", spec.port.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    if let Some(dir) = &spec.data_dir {
        cmd.env("HUSTERYX_DATA_DIR", dir);
    }
    cmd.spawn()
}

/// 对 /api/health 发一个最小 HTTP/1.1 GET，判断是否返回 200。
pub fn health_ok(port: u16) -> bool {
    use std::io::{Read, Write};
    let addr = match format!("127.0.0.1:{port}").parse() {
        Ok(addr) => addr,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request =
        format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 64];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => String::from_utf8_lossy(&buf[..n]).contains("200"),
        _ => false,
    }
}

/// 轮询健康检查直到就绪或超时。
pub fn wait_until_ready(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if health_ok(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml sidecar`
Expected: `test result: ok. 4 passed`。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/sidecar.rs src-tauri/Cargo.toml
git commit -m "feat(tauri): 新增 sidecar 选端口/启动/健康等待模块"
```

---

### Task 3: Tauri 集成（状态、命令、生命周期、打包配置）

把 sidecar 模块接入 Tauri：`setup` 里在生产构建启动引擎，暴露 `get_server_config`/`set_server_config`/`restart_sidecar` 三个命令，退出与关窗时终止子进程，崩溃/超时通过事件通知前端，并在 `tauri.conf.json` 里声明资源与 macOS 权限。

**Files:**
- Modify: [src-tauri/src/lib.rs](file:///Users/wadesong/Desktop/TEST/HUSTERYX/src-tauri/src/lib.rs)
- Modify: [src-tauri/tauri.conf.json](file:///Users/wadesong/Desktop/TEST/HUSTERYX/src-tauri/tauri.conf.json)
- Create: `src-tauri/entitlements.plist`

**Interfaces:**
- Consumes: `sidecar::pick_free_port` / `sidecar::spawn` / `sidecar::wait_until_ready` / `SidecarSpec`（Task 2）。
- Produces:
  - Tauri 命令 `get_server_config() -> { mode: string, baseUrl: string }`
  - Tauri 命令 `set_server_config(mode: string, baseUrl: string) -> { mode, baseUrl }`
  - Tauri 命令 `restart_sidecar() -> { mode, baseUrl }`
  - 事件 `sidecar-ready`（payload: 端口 number）、`sidecar-error`（payload: 字符串）、`sidecar-exit`（payload: 退出码 number | null）。
  - 资源运行时路径：`<resource_dir>/backend/dist/index.js`、`<resource_dir>/node/bin/node`。

- [ ] **Step 1: 重写 lib.rs**

将 [src-tauri/src/lib.rs](file:///Users/wadesong/Desktop/TEST/HUSTERYX/src-tauri/src/lib.rs) 整体替换为：

```rust
// HUSTERYX 桌面外壳（Tauri v2）。
//
// 生产构建：Rust 主进程选空闲端口 → spawn 内置 Node sidecar（backend/dist/index.js）
// → 轮询 /api/health → 通过 get_server_config 把实际 baseUrl 交给前端。
// 开发构建（debug）：不启动 sidecar，前端复用外部 http://127.0.0.1:8787。
mod sidecar;

use serde::{Deserialize, Serialize};
use std::process::Child;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub mode: String,
    pub base_url: String,
}

pub struct AppState {
    /// 当前对前端生效的连接配置
    pub config: Mutex<ServerConfig>,
    /// 本地 sidecar 的基址（debug 下为外部默认地址）
    pub local_base_url: Mutex<String>,
    /// sidecar 子进程句柄
    pub child: Mutex<Option<Child>>,
}

const DEFAULT_LOCAL: &str = "http://127.0.0.1:8787";
const READY_TIMEOUT: Duration = Duration::from_secs(30);

/// 终止 sidecar：先 SIGTERM 等 3s，超时再强杀。
fn terminate_sidecar(state: &AppState) {
    let mut guard = state.child.lock().unwrap();
    if let Some(mut child) = guard.take() {
        #[cfg(unix)]
        unsafe {
            libc::kill(child.id() as i32, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
            }
        }
    }
}

/// 启动 sidecar 并写入状态，返回本地基址。
fn spawn_sidecar(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<String, Box<dyn std::error::Error>> {
    terminate_sidecar(state);

    let port = sidecar::pick_free_port()?;
    let resource_dir = app.path().resource_dir()?;
    let spec = sidecar::SidecarSpec {
        node_bin: resource_dir.join("node").join("bin").join("node"),
        script: resource_dir.join("backend").join("dist").join("index.js"),
        port,
        data_dir: None,
    };
    let child = sidecar::spawn(&spec)?;
    *state.child.lock().unwrap() = Some(child);

    let base_url = format!("http://127.0.0.1:{port}");
    *state.local_base_url.lock().unwrap() = base_url.clone();

    let app_handle = app.clone();
    std::thread::spawn(move || {
        if !sidecar::wait_until_ready(port, READY_TIMEOUT) {
            let _ = app_handle.emit("sidecar-error", "计算引擎启动超时（30s）");
            return;
        }
        let _ = app_handle.emit("sidecar-ready", port);
        // 持续监视：子进程退出时通知前端
        loop {
            std::thread::sleep(Duration::from_millis(1000));
            let st = app_handle.state::<AppState>();
            let mut guard = st.child.lock().unwrap();
            match guard.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => {
                        let _ = app_handle.emit("sidecar-exit", status.code());
                        break;
                    }
                    Ok(None) => {}
                    Err(_) => break,
                },
                None => break,
            }
        }
    });

    Ok(base_url)
}

#[tauri::command]
fn get_server_config(state: tauri::State<AppState>) -> ServerConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn set_server_config(state: tauri::State<AppState>, mode: String, base_url: String) -> ServerConfig {
    let resolved = if mode == "local" {
        state.local_base_url.lock().unwrap().clone()
    } else {
        base_url
    };
    let mut cfg = state.config.lock().unwrap();
    cfg.mode = if mode == "local" { "local".into() } else { "remote".into() };
    cfg.base_url = resolved;
    cfg.clone()
}

#[tauri::command]
fn restart_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<ServerConfig, String> {
    if cfg!(debug_assertions) {
        return Err("开发模式不内置计算引擎，请用 pnpm dev 启动后端".into());
    }
    spawn_sidecar(&app, &state).map_err(|e| e.to_string())?;
    Ok(state.config.lock().unwrap().clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(AppState {
                config: Mutex::new(ServerConfig {
                    mode: "local".into(),
                    base_url: DEFAULT_LOCAL.into(),
                }),
                local_base_url: Mutex::new(DEFAULT_LOCAL.into()),
                child: Mutex::new(None),
            });

            // 仅生产构建内置 sidecar；debug 复用外部 :8787
            if !cfg!(debug_assertions) {
                let state = app.state::<AppState>();
                match spawn_sidecar(&app.handle().clone(), &state) {
                    Ok(url) => {
                        let mut cfg = state.config.lock().unwrap();
                        cfg.mode = "local".into();
                        cfg.base_url = url.clone();
                        eprintln!("HUSTERYX sidecar 就绪：{url}");
                    }
                    Err(e) => eprintln!("HUSTERYX sidecar 启动失败：{e}"),
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let state = window.app_handle().state::<AppState>();
                terminate_sidecar(&state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_server_config,
            set_server_config,
            restart_sidecar
        ])
        .build(tauri::generate_context!())
        .expect("error while building HUSTERYX tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                let state = app_handle.state::<AppState>();
                terminate_sidecar(&state);
            }
        });
}
```

- [ ] **Step 2: 编译检查**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: `Finished`，无 error（`warning: unused ...` 可忽略）。

- [ ] **Step 3: 新增 entitlements**

创建 `src-tauri/entitlements.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

- [ ] **Step 4: 更新 tauri.conf.json**

将 [src-tauri/tauri.conf.json](file:///Users/wadesong/Desktop/TEST/HUSTERYX/src-tauri/tauri.conf.json) 整体替换为：

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "HUSTERYX",
  "version": "0.1.0",
  "identifier": "com.husteryx.app",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "pnpm --filter @husteryx/frontend build",
    "frontendDist": "../frontend/dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "HUSTERYX · 低代码 ETL",
        "width": 1440,
        "height": 900,
        "minWidth": 1024,
        "minHeight": 680,
        "resizable": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "category": "DeveloperTool",
    "shortDescription": "单机桌面低代码 ETL 工具",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "resources": {
      "resources/backend": "backend",
      "resources/node": "node"
    },
    "macOS": {
      "minimumSystemVersion": "11.0",
      "entitlements": "entitlements.plist"
    }
  }
}
```

- [ ] **Step 5: 检查配置可被解析**

Run: `pnpm tauri info`
Expected: 正常输出环境信息，且不报 `tauri.conf.json` 解析错误（若报 `resources` 路径不存在属预期，资源在 Task 6 才生成）。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/entitlements.plist
git commit -m "feat(tauri): 编排 sidecar 生命周期并暴露 server config 命令"
```

---

### Task 4: 前端运行期 API 基址解析

把 `API_BASE` 从编译期常量改为运行期可变值：Tauri 环境启动时向 Rust 要 baseUrl，纯浏览器环境保持现有回退。

**Files:**
- Modify: [frontend/package.json](file:///Users/wadesong/Desktop/TEST/HUSTERYX/frontend/package.json)
- Modify: [frontend/src/types.ts](file:///Users/wadesong/Desktop/TEST/HUSTERYX/frontend/src/types.ts)
- Create: `frontend/src/lib/desktop.ts`
- Modify: [frontend/src/api/client.ts](file:///Users/wadesong/Desktop/TEST/HUSTERYX/frontend/src/api/client.ts)
- Modify: [frontend/src/api/sse.ts](file:///Users/wadesong/Desktop/TEST/HUSTERYX/frontend/src/api/sse.ts)
- Modify: [frontend/src/main.tsx](file:///Users/wadesong/Desktop/TEST/HUSTERYX/frontend/src/main.tsx)

**Interfaces:**
- Consumes: Tauri 命令 `get_server_config` / `set_server_config`（Task 3）。
- Produces:
  - `frontend/src/types.ts`: `export interface ServerConfig { mode: 'local' | 'remote'; baseUrl: string }`
  - `frontend/src/lib/desktop.ts`: `isTauri(): boolean`、`getServerConfig(): Promise<ServerConfig>`、`setServerConfig(mode: string, baseUrl: string): Promise<ServerConfig>`
  - `frontend/src/api/client.ts`: `getApiBase(): string`、`setApiBase(base: string): void`、`initApiBase(): Promise<void>`（移除原来的 `export const API_BASE`）

- [ ] **Step 1: 安装 Tauri 前端 API**

Run: `pnpm --filter @husteryx/frontend add @tauri-apps/api@^2`
Expected: `frontend/package.json` 的 `dependencies` 中出现 `"@tauri-apps/api"`。

- [ ] **Step 2: 增加 ServerConfig 类型**

在 [frontend/src/types.ts](file:///Users/wadesong/Desktop/TEST/HUSTERYX/frontend/src/types.ts) 末尾（`AppSettings` 之后）追加：

```ts
/* ----------------------------- 桌面连接配置 ----------------------------- */

export interface ServerConfig {
  /** local = 内置引擎；remote = 企业服务器 */
  mode: 'local' | 'remote';
  baseUrl: string;
}
```

- [ ] **Step 3: 创建 desktop 桥接**

创建 `frontend/src/lib/desktop.ts`：

```ts
import type { ServerConfig } from '@/types';

/** 是否运行在 Tauri webview 中。 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 懒加载 Tauri core，避免纯浏览器环境因缺少宿主而报错。 */
async function callTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export function getServerConfig(): Promise<ServerConfig> {
  return callTauri<ServerConfig>('get_server_config');
}

export function setServerConfig(mode: string, baseUrl: string): Promise<ServerConfig> {
  return callTauri<ServerConfig>('set_server_config', { mode, baseUrl });
}
```

- [ ] **Step 4: 改造 client.ts**

编辑 [frontend/src/api/client.ts](file:///Users/wadesong/Desktop/TEST/HUSTERYX/frontend/src/api/client.ts)：

（a）把第 13-16 行的常量替换为运行期可变值：

```ts
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
```

（b）把 `request` 内的 `` `${API_BASE}${path}` `` 改为 `` `${apiBase}${path}` ``：

```ts
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
```

- [ ] **Step 5: 改造 sse.ts**

编辑 [frontend/src/api/sse.ts](file:///Users/wadesong/Desktop/TEST/HUSTERYX/frontend/src/api/sse.ts)：

把第 1 行改为 `import { getApiBase } from '@/api/client';`，
把第 24 行改为：

```ts
  const source = new EventSource(`${getApiBase()}/api/runs/${runId}/events`);
```

- [ ] **Step 6: main.tsx 启动前排程**

将 [frontend/src/main.tsx](file:///Users/wadesong/Desktop/TEST/HUSTERYX/frontend/src/main.tsx) 整体替换为：

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import { initApiBase } from '@/api/client';
import '@/index.css';

async function bootstrap(): Promise<void> {
  // 先确定后端基址，再渲染，避免首屏请求打到错误地址
  await initApiBase();

  const container = document.getElementById('root');
  if (!container) throw new Error('未找到 #root 容器');

  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
```

- [ ] **Step 7: 类型检查**

Run: `pnpm --filter @husteryx/frontend typecheck`
Expected: 退出码 0，无输出。

- [ ] **Step 8: 回归验证（浏览器流程不变）**

确保 `pnpm dev` 正在运行，然后：
Run: `curl -s -o /dev/null -w "front=%{http_code} api=%{http_code}\n" http://localhost:5173/ http://127.0.0.1:8787/api/health`
Expected: 两个请求分别返回 200（顺序输出，如 `front=200 api=200`）。

- [ ] **Step 9: 提交**

```bash
git add frontend/package.json pnpm-lock.yaml frontend/src/types.ts frontend/src/lib/desktop.ts frontend/src/api/client.ts frontend/src/api/sse.ts frontend/src/main.tsx
git commit -m "feat(frontend): API 基址改为运行期解析，桌面版读取 Rust 配置"
```

---

### Task 5: 前端连接设置 UI（本地 / 远程切换）

扩展系统配置对话框：桌面版可在「本地内置引擎」与「远程服务器」之间切换，保存后写入 Rust 配置、更新运行期基址并重载；浏览器版只读展示当前基址。

**Files:**
- Modify: [frontend/src/components/settings/SettingsDialog.tsx](file:///Users/wadesong/Desktop/TEST/HUSTERYX/frontend/src/components/settings/SettingsDialog.tsx)

**Interfaces:**
- Consumes: `getApiBase` / `setApiBase`（Task 4）、`isTauri` / `getServerConfig` / `setServerConfig`（Task 4）、`useWorkflowStore` 的 `settings` / `updateSettings`（已存在）。
- Produces: 无对外接口（仅 UI）。

- [ ] **Step 1: 整体替换 SettingsDialog.tsx**

将 [frontend/src/components/settings/SettingsDialog.tsx](file:///Users/wadesong/Desktop/TEST/HUSTERYX/frontend/src/components/settings/SettingsDialog.tsx) 整体替换为：

```tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApiBase, setApiBase } from '@/api/client';
import { getServerConfig, isTauri, setServerConfig } from '@/lib/desktop';
import { useWorkflowStore } from '@/store/workflowStore';

const MIN_LIMIT = 1;
const MAX_LIMIT = 10000;

type ConnMode = 'local' | 'remote';

/** 系统配置子窗体：预览缓存行数 + 后端连接方式。 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const previewRowLimit = useWorkflowStore((s) => s.settings.previewRowLimit);
  const updateSettings = useWorkflowStore((s) => s.updateSettings);

  const [value, setValue] = useState(String(previewRowLimit));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desktop = isTauri();
  const [mode, setMode] = useState<ConnMode>('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [initialMode, setInitialMode] = useState<ConnMode>('local');
  const [initialRemoteUrl, setInitialRemoteUrl] = useState('');

  // 每次打开时以当前配置初始化
  useEffect(() => {
    if (!open) return;
    setValue(String(previewRowLimit));
    setSaving(false);
    setError(null);
    void (async () => {
      if (!desktop) {
        setMode('local');
        setRemoteUrl(getApiBase());
        setInitialMode('local');
        setInitialRemoteUrl(getApiBase());
        return;
      }
      const config = await getServerConfig();
      const nextMode: ConnMode = config.mode === 'remote' ? 'remote' : 'local';
      const nextRemote = nextMode === 'remote' ? config.baseUrl : '';
      setMode(nextMode);
      setRemoteUrl(nextRemote);
      setInitialMode(nextMode);
      setInitialRemoteUrl(nextRemote);
    })();
  }, [open, previewRowLimit, desktop]);

  const parsed = Number(value);
  const invalid = !Number.isInteger(parsed) || parsed < MIN_LIMIT || parsed > MAX_LIMIT;
  const remoteInvalid = mode === 'remote' && !/^https?:\/\//.test(remoteUrl.trim());

  const handleSave = async () => {
    if (invalid) {
      setError(`请输入 ${MIN_LIMIT} - ${MAX_LIMIT} 之间的整数`);
      return;
    }
    if (remoteInvalid) {
      setError('远程地址需以 http:// 或 https:// 开头');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateSettings({ previewRowLimit: parsed });

      const connChanged =
        desktop &&
        (mode !== initialMode ||
          (mode === 'remote' && remoteUrl.trim().replace(/\/$/, '') !== initialRemoteUrl));
      if (connChanged) {
        const config = await setServerConfig(mode, mode === 'remote' ? remoteUrl.trim() : '');
        setApiBase(config.baseUrl);
        window.location.reload();
        return;
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>系统配置</DialogTitle>
          <DialogDescription>配置数据预览行数与后端连接方式。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="preview-row-limit">预览缓存行数</Label>
          <Input
            id="preview-row-limit"
            type="number"
            min={MIN_LIMIT}
            max={MAX_LIMIT}
            step={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            范围 {MIN_LIMIT} - {MAX_LIMIT}，默认 10000。数据预览最多显示该行数，超出部分以「仅显示前 X / Y 行」提示。
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <Label>后端连接</Label>
          {desktop ? (
            <>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'local' ? 'default' : 'outline'}
                  onClick={() => setMode('local')}
                >
                  本地（内置引擎）
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'remote' ? 'default' : 'outline'}
                  onClick={() => setMode('remote')}
                >
                  远程服务器
                </Button>
              </div>
              {mode === 'remote' && (
                <Input
                  placeholder="http://10.0.0.5:8787"
                  value={remoteUrl}
                  onChange={(event) => setRemoteUrl(event.target.value)}
                />
              )}
              <p className="text-xs text-muted-foreground">切换连接后应用将自动重新加载。</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              当前为浏览器模式，后端地址：{getApiBase()}（由 VITE_API_BASE 决定）。
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || invalid || remoteInvalid}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @husteryx/frontend typecheck`
Expected: 退出码 0，无输出。

- [ ] **Step 3: 浏览器模式回归**

在 `pnpm dev` 运行中，浏览器打开 `http://localhost:5173`，点击顶部 ribbon「配置」：
Expected: 对话框显示「后端连接」区块，提示为浏览器模式并显示 `http://127.0.0.1:8787`；修改预览行数保存后重新打开仍生效。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/settings/SettingsDialog.tsx
git commit -m "feat(frontend): 系统配置支持本地/远程后端切换"
```

---

### Task 6: 打包流水线（staging 脚本 + 构建脚本 + 验证）

新增一个 Node 脚本，把「后端构建产物 + 生产依赖 + Node 运行时」staging 到 `src-tauri/resources`，并把它接进 `desktop:build`。

**Files:**
- Create: `scripts/prepare-sidecar.mjs`
- Modify: [package.json](file:///Users/wadesong/Desktop/TEST/HUSTERYX/package.json)
- Modify: [.gitignore](file:///Users/wadesong/Desktop/TEST/HUSTERYX/.gitignore)

**Interfaces:**
- Consumes: `pnpm --filter @husteryx/backend build`（已存在）、`pnpm deploy`（pnpm 10）、`process.execPath`。
- Produces: 目录结构 `src-tauri/resources/backend/{dist,node_modules,package.json}`、`src-tauri/resources/node/bin/node`（可执行）。

- [ ] **Step 1: 创建 staging 脚本**

创建 `scripts/prepare-sidecar.mjs`：

```js
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'src-tauri', 'resources');
const backendDest = path.join(dest, 'backend');

function run(cmd, args) {
  console.log(`[prepare-sidecar] ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
}

// 1. 构建后端
run('pnpm', ['--filter', '@husteryx/backend', 'build']);

// 2. 部署生产依赖（pnpm 10 需 --legacy 才能部署非 inject 的 workspace 包）
rmSync(backendDest, { recursive: true, force: true });
mkdirSync(backendDest, { recursive: true });
run('pnpm', ['deploy', '--filter', '@husteryx/backend', '--prod', '--legacy', backendDest]);

// 3. 显式补齐构建产物与 package.json（deploy 不保证包含 dist）
cpSync(path.join(root, 'backend', 'dist'), path.join(backendDest, 'dist'), { recursive: true });
cpSync(path.join(root, 'backend', 'package.json'), path.join(backendDest, 'package.json'));

if (!existsSync(path.join(backendDest, 'node_modules', '@duckdb'))) {
  throw new Error('deploy 未包含 @duckdb 生产依赖，请检查 pnpm deploy 输出');
}
if (!existsSync(path.join(backendDest, 'dist', 'index.js'))) {
  throw new Error('缺少 backend/dist/index.js');
}

// 4. 内置当前架构的 Node 运行时
const nodeDest = path.join(dest, 'node', 'bin', 'node');
mkdirSync(path.dirname(nodeDest), { recursive: true });
cpSync(process.execPath, nodeDest);
chmodSync(nodeDest, 0o755);

console.log(`[prepare-sidecar] 完成：${dest}`);
```

- [ ] **Step 2: 接入构建脚本**

把 [package.json](file:///Users/wadesong/Desktop/TEST/HUSTERYX/package.json) 的 `scripts` 改为：

```json
  "scripts": {
    "dev": "concurrently -k -n backend,frontend -c blue,green \"pnpm --filter @husteryx/backend dev\" \"pnpm --filter @husteryx/frontend dev\"",
    "dev:backend": "pnpm --filter @husteryx/backend dev",
    "dev:frontend": "pnpm --filter @husteryx/frontend dev",
    "build": "pnpm --filter @husteryx/backend build && pnpm --filter @husteryx/frontend build",
    "desktop:prepare": "node scripts/prepare-sidecar.mjs",
    "tauri": "tauri",
    "desktop": "tauri dev",
    "desktop:build": "pnpm desktop:prepare && tauri build"
  },
```

- [ ] **Step 3: 忽略生成目录**

在 [.gitignore](file:///Users/wadesong/Desktop/TEST/HUSTERYX/.gitignore) 的 `# build output` 段追加一行：

```
src-tauri/resources/
```

- [ ] **Step 4: 运行 staging 并检查产物**

Run:
```bash
pnpm desktop:prepare
ls src-tauri/resources
ls src-tauri/resources/backend
ls -l src-tauri/resources/node/bin/node
ls src-tauri/resources/backend/node_modules | head -20
```
Expected: `resources/` 下含 `backend` 和 `node`；`backend/` 下含 `dist`、`node_modules`、`package.json`；`node/bin/node` 权限含 `x`（如 `-rwxr-xr-x`）。

- [ ] **Step 5: 单独启动 staged 后端验证可运行**

Run:
```bash
HUSTERYX_PORT=0 HUSTERYX_DATA_DIR=/tmp/hx-sidecar-data src-tauri/resources/node/bin/node src-tauri/resources/backend/dist/index.js > /tmp/hx-staged.log 2>&1 &
SP=$!
sleep 3
grep HUSTERYX_READY /tmp/hx-staged.log
kill "$SP"; sleep 1
```
Expected: 日志中出现 `HUSTERYX_READY {"port":<N>,...}`，说明内置 Node + 精简依赖可独立拉起引擎。

- [ ] **Step 6: 构建 .app**

Run: `pnpm desktop:build`
Expected: 构建成功，产出 `src-tauri/target/release/bundle/macos/HUSTERYX.app`（以及 dmg）。

- [ ] **Step 7: 校验资源落地路径**

Run:
```bash
ls -l src-tauri/target/release/bundle/macos/HUSTERYX.app/Contents/Resources
```
Expected: 看到 `backend/` 与 `node/`。
若实际路径与 `Resources/backend`、`Resources/node` 不符（例如多了一层 `resources/`），则相应修改 [src-tauri/src/lib.rs](file:///Users/wadesong/Desktop/TEST/HUSTERYX/src-tauri/src/lib.rs) 中 `resource_dir().join(...)` 的拼接后再重新 `pnpm desktop:build`，直到一致。

- [ ] **Step 8: 端到端冒烟验证**

Run:
```bash
"src-tauri/target/release/bundle/macos/HUSTERYX.app/Contents/MacOS/HUSTERYX"
```
（保持窗口打开，从终端输出的 `HUSTERYX sidecar 就绪：http://127.0.0.1:<PORT>` 记下 `<PORT>`，另开终端执行：）
```bash
curl -s -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:<PORT>/api/health
ps aux | grep '[b]ackend/dist/index.js'
```
Expected: `health=200`；`ps` 能查到 node 子进程。

- [ ] **Step 9: 关闭窗口后子进程消失**

关闭 HUSTERYX 窗口，然后：
Run: `sleep 2; ps aux | grep '[b]ackend/dist/index.js' || echo "sidecar 已退出"`
Expected: 输出 `sidecar 已退出`（无残留进程）。

- [ ] **Step 10: 提交**

```bash
git add scripts/prepare-sidecar.mjs package.json .gitignore
git commit -m "build(desktop): 新增 sidecar staging 脚本与 desktop:build 流程"
```

---

## Self-Review

**1. Spec 覆盖检查**

| Spec 章节 | 对应 Task |
|---|---|
| §4 总体架构（Rust 编排 / sidecar / webview） | Task 2、Task 3 |
| §5.1 产物结构（backend/ + node/bin/node） | Task 6 Step 1、Step 4 |
| §5.2 构建流程（build → deploy → Node 二进制 → chmod → bundle.resources → 签名） | Task 6 Step 1-6；签名走 `bundle.macOS.entitlements`（Task 3 Step 3-4） |
| §5.3 运行方式（`std::process::Command`，env 传端口） | Task 2 Step 4（`sidecar::spawn`）、Task 3 Step 1 |
| §6 后端改动（端口归属、host、优雅退出、数据目录、就绪行） | Task 1 全部 Step |
| §7 Rust/Tauri（选端口、debug 分流、健康等待、命令、生命周期、崩溃通知） | Task 2、Task 3 |
| §8 前端改动（client.ts / sse.ts 运行期基址、连接设置 UI） | Task 4、Task 5 |
| §9 开发体验（`pnpm dev` / `desktop` / `desktop:build`） | Task 4 Step 8、Task 6 Step 2 |
| §10 错误处理（超时/崩溃事件、端口占用用 :0） | Task 2（`pick_free_port`）、Task 3（`sidecar-error` / `sidecar-exit` 事件）；前端提示 UI 见下方说明 |
| §11 验证计划 | Task 1 Step 5、Task 4 Step 8、Task 6 Step 4-9 |
| §12 风险（原生模块跨架构、签名/entitlement、deploy 兼容性） | Task 3 Step 3（entitlements）、Task 6 Step 1（deploy + 断言）、Task 6 Step 4-5（实测） |

已识别缺口（不阻塞本期，且不属于 spec 明确要求实现项）：
- §10「sidecar 启动失败 / 超时」的**前端错误页 + 重试按钮**：spec 描述为处理策略，本计划仅实现 Rust 侧事件发射（Task 3）。前端的 `sidecar-error` / `sidecar-exit` 监听与重试 UI 未拆为独立 Task；若需要，可作为后续增量任务（消费已 emit 的三个事件，调用 `restart_sidecar`）。当前 `restart_sidecar` 命令已就绪可直接被它使用。

**2. 占位符扫描**

已逐 Task 检查：无 `TBD`/`TODO`/「稍后实现」；所有代码步骤均给出可直接粘贴的完整代码或明确的 old→new 替换；验证步骤均给出可执行命令与预期输出。

**3. 类型一致性检查**

- Rust：`ServerConfig { mode, base_url }` + `#[serde(rename_all = "camelCase")]` ↔ 前端 `ServerConfig { mode, baseUrl }`、UI 读取 `config.baseUrl`（Task 5）一致。
- 命令名：Rust `get_server_config` / `set_server_config` / `restart_sidecar` ↔ `frontend/src/lib/desktop.ts` 中 `invoke('get_server_config')` / `invoke('set_server_config', { mode, baseUrl })` 一致；Rust 形参 `base_url` 由 Tauri 自动映射自 JS `baseUrl`。
- 资源路径：`tauri.conf.json` 的 `resources.{ "resources/backend": "backend", "resources/node": "node" }` ↔ `lib.rs` 的 `resource_dir().join("backend")` / `join("node")` 一致；Task 6 Step 7 提供实测校验并在不一致时指明修改点。
- 前端导出：`getApiBase` / `setApiBase` / `initApiBase`（client.ts）在 `sse.ts`、`main.tsx`、`SettingsDialog.tsx` 中的引用名一致；`isTauri` / `getServerConfig` / `setServerConfig`（desktop.ts）在 `SettingsDialog.tsx` 中引用名一致。
- 后端：`closeDb` 在 `sqlite.ts` 导出、在 `index.ts` 导入使用一致；就绪行前缀 `HUSTERYX_READY` 在 Task 1 生产、Task 1 Step 5 与 Task 6 Step 5 消费一致。
