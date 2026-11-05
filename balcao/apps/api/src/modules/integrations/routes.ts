import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { mercadoPagoConnectSchema, mercadoPagoWebhookSecretSchema, whatsappConnectSchema, whatsappSettingsSchema } from '@balcao/shared';
import { webhookBaseUrl } from '../../config';
import { integrations } from '../../db/schema';
import { audit } from '../../lib/audit';
import { AppError, conflict, isUniqueViolation, notFound, parse, unprocessable } from '../../lib/errors';
import { maskSecret } from '../../lib/secrets';
import { MercadoPagoClient } from '../../integrations/mercadopago';
import { ProviderError } from '../../integrations/http';
import { WhatsAppClient } from '../../integrations/whatsapp';
import { requireTenant, tenantCtx } from '../../plugins/context';
import { findIntegration, markIntegrationError, mercadoPagoClient, publicIntegration, whatsappClient, type WhatsappConfig } from './service';

export async function integrationRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', { preHandler: requireTenant('settings', 'view') }, async (request) => {
    const ctx = tenantCtx(request);
    const wa = await findIntegration(db, ctx.tenantId, 'whatsapp_cloud');
    const mp = await findIntegration(db, ctx.tenantId, 'mercadopago');
    const base = webhookBaseUrl(app.config);
    return {
      whatsapp: publicIntegration(wa),
      mercadopago: mp ? { ...publicIntegration(mp)!, webhookConfigured: !!mercadoPagoClient(app, mp).secrets.webhookSecret } : null,
      platform: {
        whatsappAppConfigured: !!(app.config.WHATSAPP_APP_SECRET && app.config.WHATSAPP_VERIFY_TOKEN),
        whatsappWebhookUrl: `${base}/api/webhooks/whatsapp`,
        mercadopagoWebhookUrl: mp ? `${base}/api/webhooks/mercadopago/${mp.id}` : null,
        aiAvailable: !!app.ai,
      },
    };
  });

  // ─── WhatsApp ───

  app.post('/whatsapp', { preHandler: requireTenant('settings', 'manage'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const ctx = tenantCtx(request);
    const input = parse(whatsappConnectSchema, request.body);
    if (!app.config.WHATSAPP_APP_SECRET || !app.config.WHATSAPP_VERIFY_TOKEN) {
      throw new AppError(503, 'whatsapp_platform_not_configured', 'A integração com a WhatsApp ainda não foi configurada nesta instalação (App Secret e token de verificação da plataforma).');
    }
    const client = new WhatsAppClient(app.http, app.config.WHATSAPP_GRAPH_VERSION, input.phoneNumberId, input.accessToken);
    let phone;
    try {
      // Confere o token e o número de verdade na Meta antes de salvar.
      phone = await client.getPhoneNumber();
      await client.subscribeApp(input.wabaId);
    } catch (err) {
      if (err instanceof ProviderError) throw unprocessable(`A Meta recusou os dados: ${err.message}`, undefined, 'whatsapp_rejected');
      throw err;
    }
    const previous = await findIntegration(db, ctx.tenantId, 'whatsapp_cloud');
    const prevConfig = (previous?.config ?? {}) as Partial<WhatsappConfig>;
    const config: WhatsappConfig = {
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name,
      qualityRating: phone.quality_rating ?? null,
      autoNotify: prevConfig.autoNotify ?? { new: true, confirmed: true, out_for_delivery: true, ready: true, canceled: true },
      templates: prevConfig.templates ?? {},
    };
    try {
      await db.transaction(async (tx) => {
        const values = {
          status: 'connected' as const,
          externalId: input.phoneNumberId,
          config: config as unknown as Record<string, unknown>,
          secrets: app.secrets.seal({ accessToken: input.accessToken }),
          lastError: null,
          lastCheckedAt: new Date(),
          connectedAt: new Date(),
        };
        if (previous) await tx.update(integrations).set(values).where(eq(integrations.id, previous.id));
        else await tx.insert(integrations).values({ ...values, tenantId: ctx.tenantId, provider: 'whatsapp_cloud' });
        await audit(tx, request, {
          action: 'integration.whatsapp_connected',
          entityType: 'integration',
          summary: `WhatsApp conectado: ${phone.display_phone_number} (token ${maskSecret(input.accessToken)})`,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err, 'integrations_provider_external_key')) throw conflict('Este número já está conectado a outro estabelecimento.');
      throw err;
    }
    return publicIntegration(await findIntegration(db, ctx.tenantId, 'whatsapp_cloud'));
  });

  app.post('/whatsapp/check', { preHandler: requireTenant('settings', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const row = await findIntegration(db, ctx.tenantId, 'whatsapp_cloud');
    if (!row) throw notFound('WhatsApp não conectado.');
    const { client, config } = whatsappClient(app, row);
    try {
      const phone = await client.getPhoneNumber();
      await db
        .update(integrations)
        .set({ config: { ...config, displayPhoneNumber: phone.display_phone_number, verifiedName: phone.verified_name, qualityRating: phone.quality_rating ?? null } })
        .where(eq(integrations.id, row.id));
      await markIntegrationError(db, row.id, null);
    } catch (err) {
      await markIntegrationError(db, row.id, err instanceof Error ? err.message : String(err));
    }
    return publicIntegration(await findIntegration(db, ctx.tenantId, 'whatsapp_cloud'));
  });

  app.put('/whatsapp/settings', { preHandler: requireTenant('settings', 'edit') }, async (request) => {
    const ctx = tenantCtx(request);
    const input = parse(whatsappSettingsSchema, request.body);
    const row = await findIntegration(db, ctx.tenantId, 'whatsapp_cloud');
    if (!row) throw notFound('WhatsApp não conectado.');
    await db.transaction(async (tx) => {
      await tx
        .update(integrations)
        .set({ config: { ...row.config, autoNotify: input.autoNotify, templates: input.templates } })
        .where(and(eq(integrations.id, row.id), eq(integrations.tenantId, ctx.tenantId)));
      await audit(tx, request, { action: 'integration.whatsapp_settings', entityType: 'integration', entityId: row.id, summary: 'Mensagens automáticas da WhatsApp atualizadas', changes: input });
    });
    return publicIntegration(await findIntegration(db, ctx.tenantId, 'whatsapp_cloud'));
  });

  app.delete('/whatsapp', { preHandler: requireTenant('settings', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(integrations)
        .where(and(eq(integrations.tenantId, ctx.tenantId), eq(integrations.provider, 'whatsapp_cloud')))
        .returning();
      if (!row) throw notFound('WhatsApp não conectado.');
      await audit(tx, request, { action: 'integration.whatsapp_disconnected', entityType: 'integration', entityId: row.id, summary: 'WhatsApp desconectado' });
    });
    return { ok: true };
  });

  // ─── Mercado Pago ───

  app.post('/mercadopago', { preHandler: requireTenant('settings', 'manage'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const ctx = tenantCtx(request);
    const input = parse(mercadoPagoConnectSchema, request.body);
    let me;
    try {
      me = await new MercadoPagoClient(app.http, input.accessToken).me();
    } catch (err) {
      if (err instanceof ProviderError) throw unprocessable(`O Mercado Pago recusou o token: ${err.message}`, { accessToken: 'Token recusado' }, 'mercadopago_rejected');
      throw err;
    }
    const previous = await findIntegration(db, ctx.tenantId, 'mercadopago');
    const values = {
      status: 'connected' as const,
      // Uma conta Mercado Pago pode atender mais de uma loja; o webhook é roteado pelo id da integração.
      externalId: null,
      config: { userId: String(me.id), nickname: me.nickname ?? null, liveMode: input.accessToken.startsWith('APP_USR-') },
      secrets: app.secrets.seal({ accessToken: input.accessToken, webhookSecret: input.webhookSecret }),
      lastError: null,
      lastCheckedAt: new Date(),
      connectedAt: new Date(),
    };
    await db.transaction(async (tx) => {
      if (previous) await tx.update(integrations).set(values).where(eq(integrations.id, previous.id));
      else await tx.insert(integrations).values({ ...values, tenantId: ctx.tenantId, provider: 'mercadopago' });
      await audit(tx, request, {
        action: 'integration.mercadopago_connected',
        entityType: 'integration',
        summary: `Mercado Pago conectado (conta ${me.id}, token ${maskSecret(input.accessToken)})`,
      });
    });
    return publicIntegration(await findIntegration(db, ctx.tenantId, 'mercadopago'));
  });

  app.put('/mercadopago/webhook-secret', { preHandler: requireTenant('settings', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    const { webhookSecret } = parse(mercadoPagoWebhookSecretSchema, request.body);
    const row = await findIntegration(db, ctx.tenantId, 'mercadopago');
    if (!row) throw notFound('Mercado Pago não conectado.');
    const { secrets } = mercadoPagoClient(app, row);
    await db.transaction(async (tx) => {
      await tx
        .update(integrations)
        .set({ secrets: app.secrets.seal({ ...secrets, webhookSecret }) })
        .where(and(eq(integrations.id, row.id), eq(integrations.tenantId, ctx.tenantId)));
      await audit(tx, request, { action: 'integration.mercadopago_webhook', entityType: 'integration', entityId: row.id, summary: 'Assinatura do webhook do Mercado Pago atualizada' });
    });
    return { ok: true };
  });

  app.delete('/mercadopago', { preHandler: requireTenant('settings', 'manage') }, async (request) => {
    const ctx = tenantCtx(request);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(integrations)
        .where(and(eq(integrations.tenantId, ctx.tenantId), eq(integrations.provider, 'mercadopago')))
        .returning();
      if (!row) throw notFound('Mercado Pago não conectado.');
      await audit(tx, request, { action: 'integration.mercadopago_disconnected', entityType: 'integration', entityId: row.id, summary: 'Mercado Pago desconectado' });
    });
    return { ok: true };
  });
}
