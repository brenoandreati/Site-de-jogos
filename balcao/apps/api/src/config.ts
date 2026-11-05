import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  APP_URL: z.url().default('http://localhost:3000'),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET precisa ter pelo menos 32 caracteres'),
  UPLOAD_DIR: z.string().default('./storage/uploads'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Balcão <nao-responda@balcao.app>'),
  /** Chave das credenciais de integrações (openssl rand -base64 32). Obrigatória em produção. */
  ENCRYPTION_KEY: z.string().optional(),
  /** Endereço público pelo qual os provedores alcançam os webhooks (padrão: APP_URL, que repassa /api). */
  PUBLIC_WEBHOOK_URL: z.url().optional(),
  // WhatsApp Business Platform (Cloud API): credenciais do app Meta da plataforma.
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().default('v23.0'),
  // Assistente de IA (Anthropic Claude).
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  /** Desliga a fila de tarefas neste processo (os testes executam as tarefas manualmente). */
  JOBS_DISABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  /** Origens extras aceitas em requisições que alteram dados (além de APP_URL). */
  TRUSTED_ORIGINS: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])),
  /**
   * Proxies confiáveis para ler o IP real do cliente (X-Forwarded-For): IPs/CIDRs separados por
   * vírgula, ou "true". Em desenvolvimento o app web (Next.js) repassa as
   * requisições a partir de 127.0.0.1. Nunca use "true" com a API exposta diretamente.
   */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v): boolean | string => {
      if (!v || v === 'false') return false;
      if (v === 'true') return true;
      return v;
    }),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${details}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.ENCRYPTION_KEY) {
    throw new Error('Configuração inválida:\n  - ENCRYPTION_KEY: obrigatória em produção para cifrar as credenciais das integrações');
  }
  return parsed.data;
}

export function webhookBaseUrl(config: Config) {
  return (config.PUBLIC_WEBHOOK_URL ?? config.APP_URL).replace(/\/$/, '');
}
