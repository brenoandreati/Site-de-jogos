import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  AI_TONE_LABELS,
  FULFILLMENT_LABELS,
  HANDOFF_TRIGGERS,
  HANDOFF_TRIGGER_LABELS,
  ORDER_STATUS_CUSTOMER_LABELS,
  PAYMENT_METHOD_LABELS,
  WEEKDAYS,
  aiSettingsSchema,
  describeAvailability,
  describeGroupRule,
  formatBRL,
  getStoreAvailability,
  localTime,
  type FulfillmentType,
  type PaymentMethod,
} from '@balcao/shared';
import { aiSettings, aiUsage, branches, conversations, deliveryZones, openingHours, orders, tenants } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { loadPricingProducts, loadPublicCatalog } from '../catalog/service';
import { createOrder, quoteOrder } from '../orders/service';

export type AiSettings = z.output<typeof aiSettingsSchema>;

export const DEFAULT_AI_SETTINGS: AiSettings = aiSettingsSchema.parse({
  enabled: false,
  assistantName: 'Assistente virtual',
  tone: 'friendly',
});

export async function loadAiSettings(app: FastifyInstance, tenantId: string): Promise<AiSettings> {
  const [row] = await app.db.select().from(aiSettings).where(eq(aiSettings.tenantId, tenantId));
  if (!row) return DEFAULT_AI_SETTINGS;
  const parsed = aiSettingsSchema.safeParse(row.settings);
  return parsed.success ? parsed.data : DEFAULT_AI_SETTINGS;
}

export interface AgentContext {
  app: FastifyInstance;
  tenantId: string;
  branchId: string;
  mode: 'live' | 'test';
  conversationId?: string;
  customer: { id: string | null; name: string; phone: string | null } | null;
  settings: AiSettings;
}

export interface AgentResult {
  text: string | null;
  handoff: string | null;
  order: { number: number; token: string } | null;
  toolCalls: { name: string; input: unknown; output: unknown; isError: boolean }[];
  usage: { input: number; output: number; cacheRead: number };
}

interface Draft {
  id: string;
  createdAt: number;
  params: {
    fulfillment: FulfillmentType;
    paymentMethod: PaymentMethod;
    changeForCents: number | null;
    deliveryZoneId: string | null;
    address: { zipCode: null; street: string; number: string; complement: string | null; neighborhood: string; city: string; state: string; reference: string | null } | null;
    tableNumber: string | null;
    notes: string | null;
    items: { productId: string; quantity: number; notes: string | null; modifiers: { modifierId: string; quantity: number }[] }[];
  };
  totalCents: number;
}

// Rascunhos do chat de teste ficam só em memória (nada é gravado em modo de teste).
const testDrafts = new Map<string, Draft>();

const MAX_STEPS = 6;
const DRAFT_TTL_MS = 30 * 60 * 1000;

// ───────────────────────────── Prompt ─────────────────────────────

async function storeContext(app: FastifyInstance, tenantId: string, branchId: string) {
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, tenantId));
  const [branch] = await app.db.select().from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)));
  if (!tenant || !branch) throw new AppError(404, 'not_found', 'Loja não encontrada.');
  const hours = await app.db
    .select({ weekday: openingHours.weekday, opensAt: openingHours.opensAt, closesAt: openingHours.closesAt })
    .from(openingHours)
    .where(eq(openingHours.branchId, branch.id))
    .orderBy(asc(openingHours.weekday), asc(openingHours.opensAt));
  const zones = await app.db
    .select()
    .from(deliveryZones)
    .where(and(eq(deliveryZones.branchId, branch.id), eq(deliveryZones.isActive, true)))
    .orderBy(asc(deliveryZones.name));
  const catalog = await loadPublicCatalog(app.db, tenantId);
  return { tenant, branch, hours, zones, catalog };
}

/** Parte estável do prompt (fica em cache): identidade, regras, dados da loja, cardápio e FAQ. */
export function buildSystemPrompt(store: Awaited<ReturnType<typeof storeContext>>, settings: AiSettings) {
  const { tenant, branch, hours, zones, catalog } = store;
  const lines: string[] = [];
  lines.push(
    `Você é ${settings.assistantName}, atendente virtual da ${tenant.tradeName} no WhatsApp. Seu trabalho é atender clientes: tirar dúvidas, apresentar o cardápio, recomendar, montar e registrar pedidos.`,
    `Tom: ${AI_TONE_LABELS[settings.tone]}. Escreva como uma pessoa da loja escreveria no WhatsApp: mensagens curtas, naturais, em português do Brasil, sem formalidade excessiva e sem repetir as mesmas frases. Use *negrito* do WhatsApp com moderação; não use títulos, tabelas nem markdown de links.`,
  );
  if (settings.personality) lines.push(`Personalidade: ${settings.personality}`);
  if (settings.greeting) lines.push(`Ao iniciar uma conversa, cumprimente com base nesta saudação da loja: "${settings.greeting}"`);

  lines.push(
    '',
    'Regras que você sempre segue:',
    '- Preços, produtos, adicionais e taxas: use só o que está no cardápio abaixo ou o que as ferramentas devolverem. Nunca invente nada.',
    '- Disponibilidade muda ao longo do dia: antes de oferecer ou fechar um item, confirme com a ferramenta consultar_produto.',
    '- Para fechar um pedido: monte com montar_pedido, mostre ao cliente o resumo que a ferramenta devolveu (itens, valores, entrega, pagamento e total) e peça uma confirmação clara. Só chame registrar_pedido depois que o cliente confirmar aquele resumo.',
    '- Só diga que o pedido foi registrado depois que registrar_pedido devolver o número do pedido. Informe o número e o link de acompanhamento.',
    '- Não prometa horários além da previsão que as ferramentas informarem. Não ofereça descontos nem condições que não estejam nas regras da loja.',
    '- Para entrega, colete rua, número, bairro e cidade (complemento e referência se houver). Para pagamento em dinheiro, pergunte se precisa de troco.',
    '- Se o cliente quiser pagar online, envie o link do cardápio digital, onde o PIX online pode estar disponível; pelo WhatsApp o pagamento é na entrega ou na retirada.',
    `- Transfira para uma pessoa da equipe com transferir_para_humano nestas situações: ${settings.handoffTriggers.map((t) => HANDOFF_TRIGGER_LABELS[t].toLowerCase()).join('; ') || 'quando o cliente pedir'}. Ao transferir, avise o cliente de forma simples que alguém da equipe vai continuar.`,
  );
  if (settings.salesRules) lines.push('', `Regras de venda da loja: ${settings.salesRules}`);
  if (settings.restrictions) lines.push('', `Restrições (não faça): ${settings.restrictions}`);
  if (settings.instructions) lines.push('', `Instruções da loja: ${settings.instructions}`);

  lines.push('', '## Loja');
  lines.push(`Nome: ${tenant.tradeName}${tenant.description ? ` — ${tenant.description}` : ''}`);
  if (branch.street) lines.push(`Endereço: ${[branch.street, branch.number, branch.complement, branch.neighborhood, branch.city, branch.state].filter(Boolean).join(', ')}`);
  lines.push(`Link do cardápio digital: ${store.tenant.slug ? `{APP_URL}/${store.tenant.slug}` : ''}`);
  lines.push(
    `Horário: ${
      hours.length
        ? WEEKDAYS.map((d, i) => {
            const h = hours.filter((x) => x.weekday === i);
            return `${d}: ${h.length ? h.map((x) => `${x.opensAt}–${x.closesAt}`).join(', ') : 'fechado'}`;
          }).join('; ')
        : 'não informado'
    }`,
  );
  const modes = (['delivery', 'pickup', 'dine_in'] as FulfillmentType[]).filter((f) =>
    f === 'delivery' ? branch.acceptsDelivery : f === 'pickup' ? branch.acceptsPickup : branch.acceptsDineIn,
  );
  lines.push(`Atendimento: ${modes.map((m) => FULFILLMENT_LABELS[m]).join(', ')}. Preparo médio: ${branch.prepTimeMinutes} min.`);
  if (branch.acceptsDelivery) {
    if (zones.length) {
      lines.push(
        `Bairros atendidos (use o bairro_id em montar_pedido): ${zones
          .map((z) => `${z.name} [bairro_id ${z.id}] taxa ${formatBRL(z.feeCents)}${z.etaMinutes ? `, ~${z.etaMinutes} min de entrega` : ''}${z.minOrderCents ? `, mínimo ${formatBRL(z.minOrderCents)}` : ''}`)
          .join('; ')}. Fora dessa lista a loja não entrega.`,
      );
    } else {
      lines.push(`Entrega: taxa ${formatBRL(branch.deliveryFeeCents)}, ~${branch.deliveryTimeMinutes} min após o preparo${branch.minOrderCents ? `, pedido mínimo ${formatBRL(branch.minOrderCents)}` : ''}.`);
    }
    if (branch.freeDeliveryAboveCents !== null) lines.push(`Entrega grátis acima de ${formatBRL(branch.freeDeliveryAboveCents)} em produtos.`);
  }
  lines.push(`Pagamento (na entrega/retirada): ${branch.paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m as PaymentMethod]).join(', ')}.`);
  if (branch.pixKey && branch.paymentMethods.includes('pix')) lines.push(`Chave PIX da loja: ${branch.pixKey}. A loja confere o recebimento; nunca confirme pagamento por conta própria.`);
  if (branch.cancellationPolicy) lines.push(`Cancelamento: ${branch.cancellationPolicy}`);

  lines.push('', '## Cardápio (ids entre colchetes; confira a disponibilidade com consultar_produto)');
  for (const c of catalog) {
    lines.push(`### ${c.name}`);
    for (const p of c.products) {
      lines.push(`- ${p.name} [produto_id ${p.id}] ${formatBRL(p.priceCents)}${p.description ? ` — ${p.description}` : ''}`);
      for (const g of p.groups) {
        lines.push(
          `  · ${g.name} (${describeGroupRule(g)}): ${g.options.map((o) => `${o.name} [opcao_id ${o.id}]${o.priceCents ? ` +${formatBRL(o.priceCents)}` : ''}${o.maxQuantity > 1 ? ` (até ${o.maxQuantity}x)` : ''}`).join('; ')}`,
        );
      }
    }
  }
  if (settings.recommendedProductIds.length) {
    const names = catalog.flatMap((c) => c.products).filter((p) => settings.recommendedProductIds.includes(p.id)).map((p) => p.name);
    if (names.length) lines.push('', `Produtos para recomendar quando fizer sentido: ${names.join(', ')}.`);
  }
  if (settings.faq.length) {
    lines.push('', '## Perguntas frequentes (respostas da loja)');
    for (const f of settings.faq) lines.push(`P: ${f.question}\nR: ${f.answer}`);
  }
  return lines.join('\n');
}

// ───────────────────────────── Ferramentas ─────────────────────────────

const itemSchema = z.object({
  produto_id: z.string(),
  quantidade: z.number().int().min(1).max(99),
  observacao: z.string().max(280).optional(),
  adicionais: z.array(z.object({ opcao_id: z.string(), quantidade: z.number().int().min(1).max(20) })).default([]),
});

const draftInputSchema = z.object({
  itens: z.array(itemSchema).min(1).max(60),
  tipo_atendimento: z.enum(['delivery', 'pickup', 'dine_in']),
  bairro_id: z.string().optional(),
  endereco: z
    .object({
      rua: z.string().min(2).max(120),
      numero: z.string().min(1).max(20),
      complemento: z.string().max(80).optional(),
      bairro: z.string().min(2).max(80),
      cidade: z.string().min(2).max(80),
      estado: z.string().length(2),
      referencia: z.string().max(120).optional(),
    })
    .optional(),
  forma_pagamento: z.enum(['pix', 'cash', 'credit_card', 'debit_card', 'meal_voucher']),
  troco_para_reais: z.number().min(0).max(100000).optional(),
  mesa: z.string().max(20).optional(),
  observacao: z.string().max(500).optional(),
});

export const AGENT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'consultar_produto',
    description:
      'Consulta um produto do cardápio agora: preço, se está disponível e as opções/adicionais disponíveis. Use antes de oferecer ou incluir um item no pedido.',
    input_schema: {
      type: 'object',
      properties: { produto_id: { type: 'string', description: 'O produto_id que aparece no cardápio.' } },
      required: ['produto_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'montar_pedido',
    description:
      'Valida e calcula um pedido com os preços oficiais, sem registrá-lo. Devolve o resumo com valores e um rascunho_id. Mostre o resumo ao cliente e peça confirmação. Se houver erro (item indisponível, bairro não atendido, loja fechada), explique ao cliente.',
    input_schema: {
      type: 'object',
      properties: {
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              produto_id: { type: 'string' },
              quantidade: { type: 'integer', minimum: 1 },
              observacao: { type: 'string' },
              adicionais: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { opcao_id: { type: 'string' }, quantidade: { type: 'integer', minimum: 1 } },
                  required: ['opcao_id', 'quantidade'],
                  additionalProperties: false,
                },
              },
            },
            required: ['produto_id', 'quantidade'],
            additionalProperties: false,
          },
        },
        tipo_atendimento: { type: 'string', enum: ['delivery', 'pickup', 'dine_in'], description: 'delivery = entrega, pickup = retirada, dine_in = consumo no local' },
        bairro_id: { type: 'string', description: 'Obrigatório na entrega quando a loja tem lista de bairros.' },
        endereco: {
          type: 'object',
          properties: {
            rua: { type: 'string' },
            numero: { type: 'string' },
            complemento: { type: 'string' },
            bairro: { type: 'string' },
            cidade: { type: 'string' },
            estado: { type: 'string', description: 'Sigla com 2 letras, ex.: SP' },
            referencia: { type: 'string' },
          },
          required: ['rua', 'numero', 'bairro', 'cidade', 'estado'],
          additionalProperties: false,
        },
        forma_pagamento: { type: 'string', enum: ['pix', 'cash', 'credit_card', 'debit_card', 'meal_voucher'], description: 'cash = dinheiro, meal_voucher = vale-refeição' },
        troco_para_reais: { type: 'number', description: 'Só para dinheiro: valor da nota para troco.' },
        mesa: { type: 'string' },
        observacao: { type: 'string' },
      },
      required: ['itens', 'tipo_atendimento', 'forma_pagamento'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_pedido',
    description:
      'Registra o pedido do rascunho no sistema da loja. Só use depois que o cliente confirmou o resumo devolvido por montar_pedido. Devolve o número do pedido e o link de acompanhamento.',
    input_schema: {
      type: 'object',
      properties: {
        rascunho_id: { type: 'string' },
        confirmacao_do_cliente: { type: 'string', description: 'A mensagem em que o cliente confirmou o resumo, com as palavras dele.' },
      },
      required: ['rascunho_id', 'confirmacao_do_cliente'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_pedidos',
    description: 'Mostra os pedidos recentes deste cliente e em que etapa cada um está.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'transferir_para_humano',
    description: 'Passa a conversa para uma pessoa da equipe e pausa o atendimento automático.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', enum: [...HANDOFF_TRIGGERS] },
        detalhe: { type: 'string', description: 'Resumo curto do que o cliente precisa, para a equipe.' },
      },
      required: ['motivo', 'detalhe'],
      additionalProperties: false,
    },
  },
];

async function runTool(ctx: AgentContext, name: string, rawInput: unknown, result: AgentResult): Promise<{ output: unknown; isError: boolean }> {
  const { app, tenantId, branchId } = ctx;
  try {
    if (name === 'consultar_produto') {
      const { produto_id } = z.object({ produto_id: z.string() }).parse(rawInput);
      const id = z.uuid().safeParse(produto_id);
      if (!id.success) return { output: { erro: 'produto_id inválido' }, isError: true };
      const map = await loadPricingProducts(app.db, tenantId, [produto_id]);
      const entry = map.get(produto_id);
      if (!entry || !entry.row.isActive) return { output: { erro: 'Produto não encontrado no cardápio.' }, isError: true };
      const p = entry.pricing;
      return {
        output: {
          nome: p.name,
          preco: formatBRL(p.priceCents),
          disponivel: p.isAvailable,
          grupos: p.groups.map((g) => ({
            grupo: g.name,
            regra: describeGroupRule(g),
            opcoes: g.modifiers.map((m) => ({ opcao_id: m.id, nome: m.name, preco_extra: formatBRL(m.priceCents), disponivel: m.isAvailable, maximo: m.maxQuantity })),
          })),
        },
        isError: false,
      };
    }

    if (name === 'montar_pedido') {
      const input = draftInputSchema.parse(rawInput);
      const params: Draft['params'] = {
        fulfillment: input.tipo_atendimento,
        paymentMethod: input.forma_pagamento,
        changeForCents: input.forma_pagamento === 'cash' && input.troco_para_reais ? Math.round(input.troco_para_reais * 100) : null,
        deliveryZoneId: input.tipo_atendimento === 'delivery' ? (input.bairro_id ?? null) : null,
        address:
          input.tipo_atendimento === 'delivery' && input.endereco
            ? {
                zipCode: null,
                street: input.endereco.rua,
                number: input.endereco.numero,
                complement: input.endereco.complemento ?? null,
                neighborhood: input.endereco.bairro,
                city: input.endereco.cidade,
                state: input.endereco.estado.toUpperCase(),
                reference: input.endereco.referencia ?? null,
              }
            : null,
        tableNumber: input.tipo_atendimento === 'dine_in' ? (input.mesa ?? null) : null,
        notes: input.observacao ?? null,
        items: input.itens.map((i) => ({
          productId: i.produto_id,
          quantity: i.quantidade,
          notes: i.observacao ?? null,
          modifiers: i.adicionais.map((a) => ({ modifierId: a.opcao_id, quantity: a.quantidade })),
        })),
      };
      if (params.fulfillment === 'delivery' && !params.address) return { output: { erro: 'Falta o endereço de entrega (rua, número, bairro, cidade e estado).' }, isError: true };
      const allIds = [...params.items.map((i) => i.productId), ...params.items.flatMap((i) => i.modifiers.map((m) => m.modifierId)), ...(params.deliveryZoneId ? [params.deliveryZoneId] : [])];
      if (allIds.some((x) => !z.uuid().safeParse(x).success)) return { output: { erro: 'Algum id informado não existe no cardápio.' }, isError: true };

      const quote = await quoteOrder(app.db, { tenantId, branchId, ...params, enforceStoreRules: true });
      const draft: Draft = { id: randomUUID(), createdAt: Date.now(), params, totalCents: quote.totals.totalCents };
      if (ctx.mode === 'test') testDrafts.set(draft.id, draft);
      else if (ctx.conversationId) {
        await app.db
          .update(conversations)
          .set({ aiDraft: draft as unknown as Record<string, unknown> })
          .where(and(eq(conversations.id, ctx.conversationId), eq(conversations.tenantId, tenantId)));
      }
      const eta = quote.branch.prepTimeMinutes + (params.fulfillment === 'delivery' ? quote.deliveryTimeMinutes : 0);
      return {
        output: {
          rascunho_id: draft.id,
          itens: quote.priced.map((i) => ({
            produto: i.productName,
            quantidade: i.quantity,
            adicionais: i.modifiers.map((m) => (m.quantity > 1 ? `${m.name} x${m.quantity}` : m.name)),
            observacao: i.notes,
            valor: formatBRL(i.totalCents),
          })),
          subtotal: formatBRL(quote.totals.subtotalCents),
          taxa_entrega: params.fulfillment === 'delivery' ? formatBRL(quote.totals.deliveryFeeCents) : null,
          total: formatBRL(quote.totals.totalCents),
          atendimento: FULFILLMENT_LABELS[params.fulfillment],
          bairro: quote.zone?.name ?? params.address?.neighborhood ?? null,
          pagamento: PAYMENT_METHOD_LABELS[params.paymentMethod],
          troco_para: params.changeForCents ? formatBRL(params.changeForCents) : null,
          previsao_minutos: eta,
          proximo_passo: 'Mostre este resumo ao cliente e peça que confirme. Só registre depois da confirmação.',
        },
        isError: false,
      };
    }

    if (name === 'registrar_pedido') {
      const { rascunho_id } = z.object({ rascunho_id: z.string(), confirmacao_do_cliente: z.string() }).parse(rawInput);
      let draft: Draft | undefined;
      if (ctx.mode === 'test') draft = testDrafts.get(rascunho_id);
      else if (ctx.conversationId) {
        const [conv] = await app.db.select({ aiDraft: conversations.aiDraft }).from(conversations).where(and(eq(conversations.id, ctx.conversationId), eq(conversations.tenantId, tenantId)));
        draft = conv?.aiDraft as unknown as Draft | undefined;
      }
      if (!draft || draft.id !== rascunho_id) return { output: { erro: 'Rascunho não encontrado. Monte o pedido de novo com montar_pedido.' }, isError: true };
      if (Date.now() - draft.createdAt > DRAFT_TTL_MS) return { output: { erro: 'O rascunho expirou. Monte o pedido de novo para conferir preços e disponibilidade.' }, isError: true };
      if (ctx.mode === 'test') {
        return { output: { registrado: false, aviso: 'Modo de teste: nenhum pedido foi registrado. Em uma conversa real o pedido entraria agora no painel.' }, isError: false };
      }
      if (!ctx.customer?.phone) return { output: { erro: 'Não foi possível identificar o telefone do cliente.' }, isError: true };
      const { order, created } = await createOrder(
        app.db,
        {
          tenantId,
          branchId,
          // O id do rascunho é a chave de idempotência: repetir a chamada não duplica o pedido.
          idempotencyKey: draft.id,
          channel: 'whatsapp',
          fulfillment: draft.params.fulfillment,
          paymentMethod: draft.params.paymentMethod,
          changeForCents: draft.params.changeForCents,
          notes: draft.params.notes,
          tableNumber: draft.params.tableNumber,
          address: draft.params.address as never,
          deliveryZoneId: draft.params.deliveryZoneId,
          customer: { name: ctx.customer.name, phone: ctx.customer.phone },
          items: draft.params.items,
          actor: { type: 'system', name: `${ctx.settings.assistantName} (IA)` },
          enforceStoreRules: true,
        },
        app.jobs,
      );
      if (order.totalCents !== draft.totalCents) {
        // Preço mudou entre o resumo e o registro: o cliente precisa saber.
        result.order = { number: order.number, token: order.publicToken };
        return {
          output: { registrado: true, numero: order.number, total: formatBRL(order.totalCents), aviso: 'O total mudou desde o resumo. Informe o novo valor ao cliente.', link: `{APP_URL}/{SLUG}/pedido/${order.publicToken}` },
          isError: false,
        };
      }
      if (ctx.conversationId) await app.db.update(conversations).set({ aiDraft: null }).where(eq(conversations.id, ctx.conversationId));
      result.order = { number: order.number, token: order.publicToken };
      return {
        output: {
          registrado: true,
          ja_existia: !created,
          numero: order.number,
          status: ORDER_STATUS_CUSTOMER_LABELS[order.status],
          total: formatBRL(order.totalCents),
          link_acompanhamento: `{APP_URL}/{SLUG}/pedido/${order.publicToken}`,
        },
        isError: false,
      };
    }

    if (name === 'consultar_pedidos') {
      if (!ctx.customer?.id) return { output: { pedidos: [] }, isError: false };
      const rows = await app.db
        .select()
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, ctx.customer.id)))
        .orderBy(desc(orders.createdAt))
        .limit(5);
      return {
        output: {
          pedidos: rows.map((o) => ({
            numero: o.number,
            situacao: ORDER_STATUS_CUSTOMER_LABELS[o.status],
            total: formatBRL(o.totalCents),
            feito_em: o.createdAt.toISOString(),
            previsao: new Date(o.createdAt.getTime() + (o.prepTimeMinutes + o.deliveryTimeMinutes) * 60_000).toISOString(),
          })),
        },
        isError: false,
      };
    }

    if (name === 'transferir_para_humano') {
      const { motivo, detalhe } = z.object({ motivo: z.enum(HANDOFF_TRIGGERS), detalhe: z.string().max(500) }).parse(rawInput);
      result.handoff = `${HANDOFF_TRIGGER_LABELS[motivo]}: ${detalhe}`;
      return { output: { transferido: true, instrucao: 'Avise o cliente que uma pessoa da equipe vai continuar o atendimento.' }, isError: false };
    }

    return { output: { erro: `Ferramenta desconhecida: ${name}` }, isError: true };
  } catch (err) {
    if (err instanceof z.ZodError) return { output: { erro: 'Dados inválidos para a ferramenta.', detalhes: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, isError: true };
    if (err instanceof AppError) return { output: { erro: err.message }, isError: true };
    throw err;
  }
}

// ───────────────────────────── Execução ─────────────────────────────

export async function runAgent(ctx: AgentContext, history: Anthropic.Beta.BetaMessageParam[]): Promise<AgentResult> {
  const provider = ctx.app.ai;
  if (!provider) throw new AppError(503, 'ai_unavailable', 'O assistente de IA não está configurado nesta instalação.');
  const store = await storeContext(ctx.app, ctx.tenantId, ctx.branchId);
  const base = ctx.app.config.APP_URL.replace(/\/$/, '');
  const systemText = buildSystemPrompt(store, ctx.settings).replaceAll('{APP_URL}', base);

  const now = new Date();
  const tz = store.branch.timezone;
  const local = localTime(now, tz);
  const availability = getStoreAvailability({ hours: store.hours, timeZone: tz, isPaused: store.branch.isPaused, pausedUntil: store.branch.pausedUntil });
  const hh = String(Math.floor(local.minutes / 60)).padStart(2, '0');
  const mm = String(local.minutes % 60).padStart(2, '0');
  // Informações que mudam a cada mensagem vão numa mensagem de sistema no fim (não quebram o cache do prompt).
  const volatile = [
    `Agora: ${WEEKDAYS[local.weekday]}, ${hh}:${mm} (${tz}).`,
    `Situação da loja: ${describeAvailability(availability, local.weekday)}.`,
    !availability.isOpen && ctx.settings.awayMessage ? `A loja está fechada para pedidos. Mensagem da loja para esse caso: "${ctx.settings.awayMessage}"` : null,
    ctx.customer ? `Cliente: ${ctx.customer.name}${ctx.customer.phone ? ` (WhatsApp ${ctx.customer.phone})` : ''}.` : null,
    ctx.mode === 'test' ? 'Esta é uma conversa de teste feita pela equipe da loja no painel.' : null,
  ]
    .filter(Boolean)
    .join('\n');

  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: 'system', content: volatile }];
  const result: AgentResult = { text: null, handoff: null, order: null, toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0 } };

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await provider.createMessage({
      system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
      messages,
      tools: AGENT_TOOLS,
    });
    result.usage.input += response.usage.input_tokens;
    result.usage.output += response.usage.output_tokens;
    result.usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;

    if (response.stop_reason === 'refusal') {
      result.handoff = result.handoff ?? 'A assistente virtual não conseguiu responder a esta conversa';
      result.text = 'Vou pedir para alguém da equipe continuar com você por aqui, tudo bem?';
      break;
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');

    // Histórico só cresce (append-only): o conteúdo devolvido volta exatamente como veio.
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'pause_turn') continue;
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      result.text = text || result.text;
      break;
    }

    const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tool of toolUses) {
      const { output, isError } = await runTool(ctx, tool.name, tool.input, result);
      const serialized = JSON.stringify(output).replaceAll('{APP_URL}', base).replaceAll('{SLUG}', store.tenant.slug);
      result.toolCalls.push({ name: tool.name, input: tool.input, output: JSON.parse(serialized), isError });
      toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: serialized, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: toolResults });
    if (text) result.text = text;
  }

  if (!result.text && !result.handoff) {
    result.handoff = 'A assistente virtual não chegou a uma resposta';
    result.text = 'Vou chamar alguém da equipe para te ajudar por aqui.';
  }

  await ctx.app.db.insert(aiUsage).values({
    tenantId: ctx.tenantId,
    conversationId: ctx.conversationId ?? null,
    purpose: ctx.mode === 'test' ? 'test' : 'reply',
    model: provider.model,
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
    cacheReadTokens: result.usage.cacheRead,
  });
  return result;
}
