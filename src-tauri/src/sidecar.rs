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
