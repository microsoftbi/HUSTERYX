import type { FastifyInstance } from 'fastify';
import { deleteWorkflow, getWorkflow, listWorkflows, saveWorkflow } from '../db/sqlite.js';
import type { WorkflowEdge, WorkflowNode } from '../types.js';

export async function workflowsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/workflows', async () => listWorkflows());

  app.get('/api/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const workflow = getWorkflow(id);
    if (!workflow) return reply.code(404).send({ error: '工作流不存在' });
    return workflow;
  });

  app.post('/api/workflows', async (req, reply) => {
    const body = req.body as {
      name?: string;
      nodes?: WorkflowNode[];
      edges?: WorkflowEdge[];
    };
    if (!body?.name) return reply.code(400).send({ error: '缺少工作流名称' });
    return saveWorkflow({
      name: body.name,
      nodes: body.nodes ?? [],
      edges: body.edges ?? [],
    });
  });

  app.put('/api/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getWorkflow(id)) return reply.code(404).send({ error: '工作流不存在' });
    const body = req.body as {
      name?: string;
      nodes?: WorkflowNode[];
      edges?: WorkflowEdge[];
    };
    return saveWorkflow({
      id,
      name: body?.name ?? '未命名工作流',
      nodes: body?.nodes ?? [],
      edges: body?.edges ?? [],
    });
  });

  app.delete('/api/workflows/:id', async (req) => {
    const { id } = req.params as { id: string };
    const ok = deleteWorkflow(id);
    return { ok };
  });
}
