import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { connectionsRoutes } from './routes/connections.js';
import { filesRoutes } from './routes/files.js';
import { runsRoutes } from './routes/runs.js';
import { schemaRoutes } from './routes/schema.js';
import { settingsRoutes } from './routes/settings.js';
import { workflowsRoutes } from './routes/workflows.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.HUSTERYX_LOG_LEVEL || 'info',
      transport: undefined,
    },
    bodyLimit: 64 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
  });

  app.get('/api/health', async () => ({
    ok: true,
    name: 'husteryx-backend',
    ts: Date.now(),
  }));

  await app.register(workflowsRoutes);
  await app.register(runsRoutes);
  await app.register(filesRoutes);
  await app.register(connectionsRoutes);
  await app.register(schemaRoutes);
  await app.register(settingsRoutes);

  return app;
}
