import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';
import { AppError } from '../lib/errors';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  /** true quando há um provedor real configurado. */
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

/**
 * E-mail transacional.
 * - Com RESEND_API_KEY: envia de verdade pela API da Resend.
 * - Sem chave, fora de produção: escreve a mensagem no log da API (útil para desenvolver).
 * - Sem chave, em produção: recusa o envio com erro explícito. Nada é dado como "enviado" sem ter sido.
 */
export function createMailer(config: Config, log: FastifyBaseLogger): Mailer {
  if (config.RESEND_API_KEY) {
    const apiKey = config.RESEND_API_KEY;
    return {
      configured: true,
      async send(message) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: config.EMAIL_FROM,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          log.error({ status: res.status, body: body.slice(0, 500) }, 'falha ao enviar e-mail');
          throw new AppError(502, 'email_failed', 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.');
        }
      },
    };
  }

  if (config.NODE_ENV !== 'production') {
    return {
      configured: false,
      async send(message) {
        log.info({ to: message.to, subject: message.subject }, `[e-mail de desenvolvimento — não enviado]\n${message.text}`);
      },
    };
  }

  return {
    configured: false,
    async send() {
      throw new AppError(503, 'email_not_configured', 'O envio de e-mails não está configurado nesta instalação.');
    },
  };
}
