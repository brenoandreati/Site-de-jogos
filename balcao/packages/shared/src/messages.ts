import type { OrderStatus } from './orders';

/**
 * Mensagens de atualização de pedido, personalizáveis pela loja.
 * Na Fase 1 elas são usadas no botão "Avisar pelo WhatsApp" (abre o WhatsApp da equipe com o
 * texto pronto). Na Fase 2 as mesmas mensagens serão enviadas automaticamente pela Cloud API.
 *
 * Variáveis: {cliente} {pedido} {loja} {total} {link} {previsao}
 */
export const MESSAGE_TEMPLATE_KEYS = [
  'new',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'canceled',
] as const satisfies readonly OrderStatus[];
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];

export const DEFAULT_MESSAGE_TEMPLATES: Record<MessageTemplateKey, string> = {
  new: 'Oi, {cliente}! Recebemos seu pedido #{pedido} na {loja}. Total: {total}. Acompanhe aqui: {link}',
  confirmed: 'Pedido #{pedido} confirmado, {cliente}! Previsão: {previsao}. Acompanhe: {link}',
  preparing: 'Seu pedido #{pedido} já está sendo preparado.',
  ready: 'Seu pedido #{pedido} está pronto!',
  out_for_delivery: 'Seu pedido #{pedido} saiu para entrega. Já já chega aí!',
  completed: 'Pedido #{pedido} concluído. Obrigado pela preferência, {cliente}!',
  canceled: 'Seu pedido #{pedido} foi cancelado. Se tiver dúvidas, é só responder esta mensagem.',
};

export const MESSAGE_TEMPLATE_LABELS: Record<MessageTemplateKey, string> = {
  new: 'Pedido recebido',
  confirmed: 'Pedido confirmado',
  preparing: 'Em preparação',
  ready: 'Pedido pronto',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Pedido concluído',
  canceled: 'Pedido cancelado',
};

export interface MessageVariables {
  cliente: string;
  pedido: string | number;
  loja: string;
  total: string;
  link: string;
  previsao: string;
}

export function renderTemplate(template: string, vars: MessageVariables): string {
  return template.replace(/\{(cliente|pedido|loja|total|link|previsao)\}/g, (_, key: keyof MessageVariables) =>
    String(vars[key] ?? ''),
  );
}

export function resolveTemplates(custom?: Partial<Record<string, string>> | null): Record<MessageTemplateKey, string> {
  const result = { ...DEFAULT_MESSAGE_TEMPLATES };
  for (const key of MESSAGE_TEMPLATE_KEYS) {
    const value = custom?.[key];
    if (typeof value === 'string' && value.trim()) result[key] = value.trim();
  }
  return result;
}
