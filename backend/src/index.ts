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
