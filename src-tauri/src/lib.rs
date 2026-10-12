// HUSTERYX 桌面外壳。
//
// 第一阶段仅承载前端界面：界面通过 HTTP/SSE 与独立运行的 Fastify + DuckDB
// 计算引擎（默认 http://127.0.0.1:8787）通信。后续可将引擎改为 Tauri sidecar。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running HUSTERYX tauri application");
}
