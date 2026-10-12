import { HOST, PORT, ensureDirs } from './config.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  ensureDirs();
  const app = await buildServer();
  try {
    await app.listen({ host: HOST, port: PORT });
    app.log.info(`HUSTERYX backend 已启动：http://${HOST}:${PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
