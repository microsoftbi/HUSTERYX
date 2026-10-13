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
    // 让生效配置指向本次实际选定的端口（重启会换端口，必须同步，否则前端拿到陈旧 baseUrl）
    *state.config.lock().unwrap() = ServerConfig {
        mode: "local".into(),
        base_url: base_url.clone(),
    };

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
                    Ok(url) => eprintln!("HUSTERYX sidecar 就绪：{url}"),
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
