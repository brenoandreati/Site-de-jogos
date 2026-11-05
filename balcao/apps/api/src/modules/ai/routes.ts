import type { FastifyInstance } from 'fastify';
import { and, eq, gte, sql } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { aiSettingsSchema, aiTestSchema } from '@balcao/shared';
import { aiSettings, aiUsage } from '../../db/schema';
import { audit } from '../../lib/audit';
import { AppError, parse, unprocessable } from '../../lib/errors';
import { requireTenant, tenantCtx } from '../../plugins/context';
import { loadAiSettings, runAgent } from './agent';

export async function aiRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/settings', { preHandler: requireTenant('ai_assistant', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const settings = await loadAiSettings(app, ctx.tenantId);
    const since = new Date(Date.now() - 30 * 24 * 3600_000);
    const [usage] = await db
      .select({
        replies: sql<number>`count(*) filter (where ${aiUsage.purpose} = 'reply')::int`,
        tests: sql<number>`count(*) filter (where ${aiUsage.purpose} = 'test')::int`,
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::bigint`.mapWith(Number),
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::bigint`.mapWith(Number),
        cacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::bigint`.mapWith(Number),
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.tenantId, ctx.tenantId), gte(aiUsage.createdAt, since)));
    return { settings, available: !!app.ai, model: app.ai?.model ?? null, usage30d: usage };
  });

  app.put('/settings', { preHandler: requireTenant('ai_assistant', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const input = parse(aiSettingsSchema, request.body);
    if (input.enabled && !app.ai) {
      throw unprocessable('O assistente de IA não está disponível nesta instalação (falta a chave da Anthropic no servidor).', { enabled: 'Indisponível' });
    }
    await db.transaction(async (tx) => {
      await tx
        .insert(aiSettings)
        .values({ tenantId: ctx.tenantId, settings: input as unknown as Record<string, unknown>, updatedByUserId: ctx.user.id })
        .onConflictDoUpdate({ target: aiSettings.tenantId, set: { settings: input as unknown as Record<string, unknown>, updatedByUserId: ctx.user.id, updatedAt: new Date() } });
      await audit(tx, request, {
        action: 'ai.settings_updated',
        entityType: 'ai_settings',
        summary: `Assistente de IA ${input.enabled ? 'ativado' : 'desativado'} (${input.assistantName})`,
      });
    });
    return { settings: input, available: !!app.ai, model: app.ai?.model ?? null };
  });

  /** Conversa de teste no painel: usa a IA de verdade com o cardápio atual, mas nunca registra pedidos. */
  app.post('/test', { preHandler: requireTenant('ai_assistant', 'edit'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const ctx = tenantCtx(request);
    const input = parse(aiTestSchema, request.body);
    if (input.messages.at(-1)?.role !== 'user') throw unprocessable('A última mensagem do teste deve ser do cliente.');
    const settings = await loadAiSettings(app, ctx.tenantId);
    try {
      const result = await runAgent(
        { app, tenantId: ctx.tenantId, branchId: ctx.branchId, mode: 'test', customer: { id: null, name: 'Cliente de teste', phone: null }, settings },
        input.messages.map((m) => ({ role: m.role, content: m.text })),
      );
      return { reply: result.text, handoff: result.handoff, toolCalls: result.toolCalls, usage: result.usage };
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new AppError(502, 'ai_provider_error', `A IA não respondeu (${err.status ?? 'sem status'}). Tente de novo em instantes.`);
      }
      throw err;
    }
  });
}
