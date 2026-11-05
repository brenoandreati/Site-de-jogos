import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cofre de credenciais das integrações (tokens da WhatsApp, Mercado Pago…).
 * AES-256-GCM com chave de ENCRYPTION_KEY (32 bytes em base64). O banco guarda só o texto cifrado;
 * as credenciais nunca são devolvidas ao navegador.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(encryptionKey: string | undefined, fallbackSecret: string) {
    if (encryptionKey) {
      const key = Buffer.from(encryptionKey, 'base64');
      if (key.length !== 32) throw new Error('ENCRYPTION_KEY deve ter 32 bytes em base64 (openssl rand -base64 32)');
      this.key = key;
    } else {
      // Sem chave dedicada, deriva uma do segredo da sessão (aceitável em desenvolvimento).
      this.key = createHash('sha256').update(`balcao-secrets:${fallbackSecret}`).digest();
    }
  }

  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join('.');
  }

  open<T>(sealed: string): T {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Credencial cifrada em formato desconhecido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as T;
  }
}

/** Mostra só o fim de um token (ex.: "••••a9F2") para o painel identificar qual está em uso. */
export function maskSecret(value: string): string {
  return `••••${value.slice(-4)}`;
}
