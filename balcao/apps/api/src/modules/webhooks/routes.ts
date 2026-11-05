import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { integrations, webhookEvents } from '../../db/schema';
import { verifyMercadoPagoSignature } from '../../integrations/mercadopago';
import { verifyMetaSignature, type WaWebhook } from '../../integrations/whatsapp';
import { aiEnabledFor, applyStatusUpdate, handoffToHuman, recordInbound, sendOutbound } from '../inbox/service';
import { mercadoPagoClient } from '../integrations/service';
import { syncPayment } from '../payments/service';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Webhooks dos provedores. Não usam sessão nem o cabeçalho anti-CSRF: cada um é autenticado pela
 * assinatura do próprio provedor, conferida sobre o corpo bruto da requisição.
 */
export async function webhookRoutes(app: FastifyInstance) {
  // Guarda o corpo bruto (a assinatura é calculada sobre os bytes exatos).
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 }, (request: FastifyRequest, body: Buffer, done) => {
    request.rawBody = body;
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
    } catch {
      done(null, {});
    }
  });

  // ─── WhatsApp (Meta) ───

  app.get('/whatsapp', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const token = app.config.WHATSAPP_VERIFY_TOKEN;
    if (token && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === token) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.status(403).send({ error: { code: 'forbidden', message: 'Token de verificação inválido.' } });
  });

  app.post('/whatsapp', { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (request, reply) => {
    const secret = app.config.WHATSAPP_APP_SECRET;
    const valid = !!secret && !!request.rawBody && verifyMetaSignature(secret, request.rawBody, request.headers['x-hub-signature-256'] as string | undefined);
    const payload = request.body as WaWebhook;
    const [event] = await app.db.insert(webhookEvents).values({ provider: 'whatsapp_cloud', signatureValid: valid, payload }).returning({ id: webhookEvents.id });
    if (!valid) return reply.status(401).send({ error: { code: 'invalid_signature', message: 'Assinatura inválida.' } });

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;
        const [integration] = await app.db
          .select()
          .from(integrations)
          .where(and(eq(integrations.provider, 'whatsapp_cloud'), eq(integrations.externalId, phoneNumberId)));
        if (!integration) continue;
        if (!event) continue;
        await app.db.update(webhookEvents).set({ tenantId: integration.tenantId }).where(eq(webhookEvents.id, event.id));

        const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
        for (const m of value.messages ?? []) {
          const r = await recordInbound(app, integration, m, names.get(m.from) ?? null);
          if (r.duplicate || !r.message) continue;
          const conv = r.conversation;
          if (conv.mode !== 'ai') continue;
          const ai = await aiEnabledFor(app, integration.tenantId);
          if (!ai.enabled) continue;
          const text = normalize(r.message.body ?? '');
          const keyword = (ai.settings?.handoffKeywords ?? []).find((k) => k && text.includes(normalize(k)));
          if (keyword) {
            await handoffToHuman(app, integration.tenantId, conv.id, `Cliente escreveu “${keyword}”`);
            await sendOutbound(app, {
              tenantId: integration.tenantId,
              conversationId: conv.id,
              sender: 'system',
              text: 'Certo! Já chamei alguém da equipe para continuar com você por aqui.',
            }).catch((err) => app.log.warn({ err }, 'aviso de transferência não enviado'));
            continue;
          }
          // Pequena espera junta mensagens enviadas em sequência numa única resposta.
          await app.jobs.enqueue(
            app.db,
            'ai_reply',
            { tenantId: integration.tenantId, conversationId: conv.id, messageId: r.message.id },
            { runAt: new Date(Date.now() + 1500), dedupeKey: `ai:${r.message.id}`, maxAttempts: 3 },
          );
        }
        for (const s of value.statuses ?? []) await applyStatusUpdate(app, integration.tenantId, s);
      }
    }
    if (event) await app.db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, event.id));
    return { ok: true };
  });

  // ─── Mercado Pago ───

  app.post('/mercadopago/:integrationId', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { integrationId } = request.params as { integrationId: string };
    const q = request.query as Record<string, string | undefined>;
    const body = (request.body ?? {}) as { type?: string; action?: string; data?: { id?: string | number } };
    const dataId = String(q['data.id'] ?? body.data?.id ?? '');
    const type = q.type ?? body.type ?? '';

    const [integration] = /^[0-9a-f-]{36}$/.test(integrationId)
      ? await app.db.select().from(integrations).where(and(eq(integrations.id, integrationId), eq(integrations.provider, 'mercadopago')))
      : [];
    let valid = false;
    if (integration && dataId) {
      const { secrets } = mercadoPagoClient(app, integration);
      valid = verifyMercadoPagoSignature(secrets.webhookSecret, request.headers['x-signature'] as string | undefined, request.headers['x-request-id'] as string | undefined, dataId);
    }
    const [event] = await app.db
      .insert(webhookEvents)
      .values({ provider: 'mercadopago', tenantId: integration?.tenantId ?? null, signatureValid: valid, payload: { query: q, body } })
      .returning({ id: webhookEvents.id });
    if (!integration) return reply.status(404).send({ error: { code: 'not_found', message: 'Integração não encontrada.' } });
    if (!valid) return reply.status(401).send({ error: { code: 'invalid_signature', message: 'Assinatura inválida.' } });

    if (type === 'payment' || body.action?.startsWith('payment.')) {
      // O corpo só diz "algo mudou"; o status oficial é consultado direto no Mercado Pago.
      await syncPayment(app, integration.tenantId, dataId);
    }
    if (event) await app.db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, event.id));
    return { ok: true };
  });
}
