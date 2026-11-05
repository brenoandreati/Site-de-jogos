import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { WhatsappSettings } from '@balcao/shared';
import type { DbExecutor } from '../../db/client';
import { integrations } from '../../db/schema';
import { MercadoPagoClient } from '../../integrations/mercadopago';
import { WhatsAppClient } from '../../integrations/whatsapp';

export type Provider = 'whatsapp_cloud' | 'mercadopago';
export type IntegrationRow = typeof integrations.$inferSelect;

export interface WhatsappSecrets {
  accessToken: string;
}
export interface WhatsappConfig extends WhatsappSettings {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating?: string | null;
}

export interface MercadoPagoSecrets {
  accessToken: string;
  webhookSecret: string;
}
export interface MercadoPagoConfig {
  userId: string;
  nickname: string | null;
  liveMode: boolean;
}

export async function findIntegration(db: DbExecutor, tenantId: string, provider: Provider) {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, provider)));
  return row ?? null;
}

export function whatsappClient(app: FastifyInstance, row: IntegrationRow) {
  const config = row.config as unknown as WhatsappConfig;
  const secrets = app.secrets.open<WhatsappSecrets>(row.secrets);
  return { client: new WhatsAppClient(app.http, app.config.WHATSAPP_GRAPH_VERSION, config.phoneNumberId, secrets.accessToken), config };
}

export function mercadoPagoClient(app: FastifyInstance, row: IntegrationRow) {
  const secrets = app.secrets.open<MercadoPagoSecrets>(row.secrets);
  return { client: new MercadoPagoClient(app.http, secrets.accessToken), secrets, config: row.config as unknown as MercadoPagoConfig };
}

export async function markIntegrationError(db: DbExecutor, id: string, error: string | null) {
  await db
    .update(integrations)
    .set({ status: error ? 'error' : 'connected', lastError: error, lastCheckedAt: new Date() })
    .where(eq(integrations.id, id));
}

/** Visão segura para o painel: nunca inclui tokens. */
export function publicIntegration(row: IntegrationRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    config: row.config,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt,
    connectedAt: row.connectedAt,
  };
}
