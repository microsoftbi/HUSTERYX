import type { FastifyInstance } from 'fastify';
import { PREVIEW_DEFAULT_LIMIT, PREVIEW_MAX_LIMIT } from '../config.js';
import { getSetting, setSetting } from '../db/sqlite.js';
import type { AppSettings } from '../types.js';

const PREVIEW_ROW_LIMIT_KEY = 'previewRowLimit';

/** 行数上限统一收敛到 [1, PREVIEW_MAX_LIMIT] 的整数。 */
function clampLimit(value: number): number {
  return Math.min(Math.max(1, Math.trunc(value)), PREVIEW_MAX_LIMIT);
}

function readSettings(): AppSettings {
  const raw = getSetting(PREVIEW_ROW_LIMIT_KEY);
  const parsed = Number(raw);
  return {
    previewRowLimit:
      raw !== null && Number.isFinite(parsed) ? clampLimit(parsed) : PREVIEW_DEFAULT_LIMIT,
  };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => readSettings());

  app.put('/api/settings', async (req, reply) => {
    const body = req.body as { previewRowLimit?: unknown };
    const value = Number(body?.previewRowLimit);
    if (!Number.isFinite(value)) {
      return reply.code(400).send({ error: 'previewRowLimit 必须是数字' });
    }
    const previewRowLimit = clampLimit(value);
    setSetting(PREVIEW_ROW_LIMIT_KEY, String(previewRowLimit));
    return { previewRowLimit } satisfies AppSettings;
  });
}
