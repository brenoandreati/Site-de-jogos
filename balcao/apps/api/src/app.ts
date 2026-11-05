import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import type { Config } from './config';
import { createDb, createPool, type Database } from './db/client';
import { AppError } from './lib/errors';
import { loadSession } from './plugins/context';
import { EventHub } from './services/events';
import { createMailer, type Mailer } from './services/mailer';
import { LocalStorage, type StorageDriver } from './services/storage';
import { authRoutes } from './modules/auth/routes';
import { settingsRoutes } from './modules/settings/routes';
import { catalogRoutes } from './modules/catalog/routes';
import { publicMenuRoutes } from './modules/menu/routes';
import { orderRoutes } from './modules/orders/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { teamRoutes } from './modules/team/routes';
import { uploadRoutes } from './modules/uploads/routes';
import { realtimeRoutes } from './modules/realtime/routes';
import { kitchenRoutes } from './modules/kitchen/routes';
import { deliveryRoutes } from './modules/delivery/routes';
import { integrationRoutes } from './modules/integrations/routes';
import { inboxRoutes } from './modules/inbox/routes';
import { aiRoutes } from './modules/ai/routes';
import { webhookRoutes } from './modules/webhooks/routes';
import { registerJobHandlers } from './modules/jobs';
import { JobQueue } from './services/jobs';
import { SecretBox } from './lib/secrets';
import { createAiProvider, type AiProvider } from './services/ai-provider';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Database;
    pool: pg.Pool;
    hub: EventHub;
    mailer: Mailer;
    storage: StorageDriver;
    jobs: JobQueue;
    secrets: SecretBox;
    /** fetch usado pelas integrações (substituível nos testes por um provedor falso). */
    http: typeof fetch;
    ai: AiProvider | null;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface AppOverrides {
  mailer?: Mailer;
  http?: typeof fetch;
  ai?: AiProvider | null;
}

export async function buildApp(config: Config, overrides: AppOverrides = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const hub = new EventHub(config.DATABASE_URL, app.log);
  const uploadDir = path.resolve(config.UPLOAD_DIR);
  mkdirSync(uploadDir, { recursive: true });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('pool', pool);
  app.decorate('hub', hub);
  app.decorate('mailer', overrides.mailer ?? createMailer(config, app.log));
  app.decorate('storage', new LocalStorage(uploadDir));
  app.decorate('jobs', new JobQueue(db, app.log));
  app.decorate('secrets', new SecretBox(config.ENCRYPTION_KEY, config.SESSION_SECRET));
  app.decorate('http', overrides.http ?? fetch);
  app.decorate('ai', overrides.ai !== undefined ? overrides.ai : createAiProvider(config, overrides.http ?? fetch));
  app.decorateRequest('sessionCtx', null);
  app.decorateRequest('tenantCtx', null);

  await app.register(helmet, {
    // A API só entrega JSON e imagens; as páginas são servidas pelo app web.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], imgSrc: ["'self'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: { code: 'rate_limited', message: `Muitas tentativas. Aguarde ${Math.ceil(ctx.ttl / 1000)}s e tente novamente.` },
    }),
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 } });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  await app.register(fastifyStatic, {
    root: uploadDir,
    prefix: '/uploads/',
    decorateReply: false,
    immutable: true,
    maxAge: '365d',
    index: false,
    list: false,
  });

  // Proteção CSRF: requisições que alteram dados precisam de um cabeçalho customizado, que um site
  // de terceiros não consegue enviar sem CORS (e esta API não habilita CORS). Também validamos Origin.
  const trustedOrigins = new Set([new URL(config.APP_URL).origin, ...config.TRUSTED_ORIGINS]);
  app.addHook('onRequest', async (request) => {
    if (!MUTATING.has(request.method) || !request.url.startsWith('/api/')) return;
    // Webhooks vêm de servidores dos provedores e são autenticados por assinatura própria.
    if (request.url.startsWith('/api/webhooks/')) return;
    if (request.headers['x-balcao-client'] !== 'web') {
      throw new AppError(403, 'csrf', 'Requisição recusada por segurança.');
    }
    const origin = request.headers.origin;
    if (origin && !trustedOrigins.has(origin)) {
      throw new AppError(403, 'csrf', 'Origem da requisição não permitida.');
    }
  });

  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/')) await loadSession(request);
  });

  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/') && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message, fields: error.fields } });
    }
    const err = error as { statusCode?: number; code?: string; message?: string };
    if (err.statusCode === 429) {
      return reply.status(429).send(error);
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'file_too_large', message: 'A imagem deve ter no máximo 5 MB.' } });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: 'bad_request', message: 'Requisição inválida.' } });
    }
    request.log.error({ err: error }, 'erro não tratado');
    return reply
      .status(500)
      .send({ error: { code: 'internal_error', message: 'Erro inesperado. Tente novamente; se persistir, fale com o suporte.' } });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: 'Rota não encontrada.' } });
  });

  app.get('/api/health', { config: { rateLimit: false } }, async () => {
    await db.execute(sql`select 1`);
    return { ok: true, realtimeConnections: hub.connectionCount() };
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(settingsRoutes, { prefix: '/settings' });
      await api.register(catalogRoutes, { prefix: '/catalog' });
      await api.register(orderRoutes, { prefix: '/orders' });
      await api.register(dashboardRoutes, { prefix: '/dashboard' });
      await api.register(teamRoutes, { prefix: '/team' });
      await api.register(uploadRoutes, { prefix: '/uploads' });
      await api.register(realtimeRoutes, { prefix: '/realtime' });
      await api.register(publicMenuRoutes, { prefix: '/public' });
      await api.register(kitchenRoutes, { prefix: '/kitchen' });
      await api.register(deliveryRoutes, { prefix: '/delivery' });
      await api.register(integrationRoutes, { prefix: '/integrations' });
      await api.register(inboxRoutes, { prefix: '/inbox' });
      await api.register(aiRoutes, { prefix: '/ai' });
      await api.register(webhookRoutes, { prefix: '/webhooks' });
    },
    { prefix: '/api' },
  );

  registerJobHandlers(app);
  app.addHook('onReady', async () => {
    await hub.start();
    if (config.JOBS_DISABLED || config.NODE_ENV === 'test') app.jobs.attach(app);
    else app.jobs.start(app);
  });
  app.addHook('onClose', async () => {
    app.jobs.stop();
    await hub.stop();
    await pool.end();
  });

  return app;
}
