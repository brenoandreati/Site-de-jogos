import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError, requestJson } from './http';

/**
 * Cliente da WhatsApp Business Platform (Cloud API), a integração oficial da Meta.
 * Documentação: developers.facebook.com/docs/whatsapp/cloud-api
 */
export class WhatsAppClient {
  private readonly base: string;

  constructor(
    private readonly fetchImpl: typeof fetch,
    version: string,
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
  ) {
    this.base = `https://graph.facebook.com/${version}`;
  }

  private call<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    return requestJson<T>(
      this.fetchImpl,
      'WhatsApp',
      `${this.base}/${path}`,
      { ...init, headers: { authorization: `Bearer ${this.accessToken}` } },
      (status, body) => {
        const e = (body as { error?: { message?: string; code?: number; error_data?: { details?: string } } } | null)?.error;
        const code = e?.code ?? 0;
        // Limites de envio e instabilidade da Meta merecem nova tentativa; o resto não.
        const retryable = status >= 500 || status === 429 || [4, 80007, 130429, 131048, 131056, 131000].includes(code);
        return { message: e?.error_data?.details ?? e?.message ?? `HTTP ${status}`, retryable };
      },
    );
  }

  getPhoneNumber() {
    return this.call<{ id: string; display_phone_number: string; verified_name: string; quality_rating?: string }>(
      `${this.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    );
  }

  /** Inscreve o app da plataforma na conta (WABA) para receber os webhooks dela. */
  subscribeApp(wabaId: string) {
    return this.call<{ success: boolean }>(`${wabaId}/subscribed_apps`, { method: 'POST' });
  }

  async sendText(to: string, body: string) {
    const r = await this.call<SendResponse>(`${this.phoneNumberId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body } },
    });
    return messageId(r);
  }

  async sendImage(to: string, link: string, caption?: string | null) {
    const r = await this.call<SendResponse>(`${this.phoneNumberId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'image', image: { link, ...(caption ? { caption } : {}) } },
    });
    return messageId(r);
  }

  async sendTemplate(to: string, name: string, language: string, params: string[]) {
    const r = await this.call<SendResponse>(`${this.phoneNumberId}/messages`, {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name,
          language: { code: language },
          ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } : {}),
        },
      },
    });
    return messageId(r);
  }

  /** Mídias recebidas chegam só com id; a URL de download é temporária e exige o token. */
  async downloadMedia(mediaId: string): Promise<{ data: Buffer; mime: string }> {
    const meta = await this.call<{ url: string; mime_type: string }>(mediaId);
    const res = await this.fetchImpl(meta.url, { headers: { authorization: `Bearer ${this.accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new ProviderError('WhatsApp', res.status, 'Não foi possível baixar a mídia', res.status >= 500);
    return { data: Buffer.from(await res.arrayBuffer()), mime: meta.mime_type };
  }
}

type SendResponse = { messages?: { id: string }[] };
function messageId(r: SendResponse) {
  const id = r.messages?.[0]?.id;
  if (!id) throw new ProviderError('WhatsApp', 200, 'Resposta sem identificador da mensagem', false, r);
  return id;
}

/** Confere o cabeçalho X-Hub-Signature-256 (HMAC SHA-256 do corpo bruto com o App Secret). */
export function verifyMetaSignature(appSecret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Formato do webhook (apenas os campos usados).
export interface WaWebhook {
  object?: string;
  entry?: {
    id: string;
    changes?: {
      field: string;
      value: {
        metadata?: { phone_number_id: string; display_phone_number?: string };
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: WaInboundMessage[];
        statuses?: { id: string; status: 'sent' | 'delivered' | 'read' | 'failed'; timestamp: string; recipient_id: string; errors?: { code: number; title?: string; message?: string; error_data?: { details?: string } }[] }[];
      };
    }[];
  }[];
}

export interface WaInboundMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; mime_type?: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type?: string };
  video?: { id: string; mime_type?: string; caption?: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
}
