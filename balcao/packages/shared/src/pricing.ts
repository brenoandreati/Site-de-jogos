/**
 * Cálculo de preços de itens e pedidos.
 *
 * A mesma função roda no navegador (prévia do carrinho) e na API (valor oficial).
 * A API SEMPRE recalcula a partir do catálogo salvo no banco: nenhum preço enviado pelo
 * cliente é aceito.
 */

export const MAX_ITEM_QUANTITY = 99;
export const MAX_ITEMS_PER_ORDER = 60;

export interface PricingModifier {
  id: string;
  name: string;
  priceCents: number;
  maxQuantity: number;
  isAvailable: boolean;
}

export interface PricingGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: PricingModifier[];
}

export interface PricingProduct {
  id: string;
  name: string;
  priceCents: number;
  isAvailable: boolean;
  groups: PricingGroup[];
}

export interface ModifierSelection {
  modifierId: string;
  quantity: number;
}

export interface ItemSelection {
  productId: string;
  quantity: number;
  notes?: string | null;
  modifiers: ModifierSelection[];
}

export interface PricedModifier {
  modifierId: string;
  groupId: string;
  groupName: string;
  name: string;
  priceCents: number;
  quantity: number;
  /** Valor do adicional para UMA unidade do produto (preço × quantidade do adicional). */
  totalCents: number;
}

export interface PricedItem {
  productId: string;
  productName: string;
  basePriceCents: number;
  quantity: number;
  /** Preço de uma unidade já com adicionais. */
  unitPriceCents: number;
  totalCents: number;
  notes: string | null;
  modifiers: PricedModifier[];
}

export type PricingErrorCode =
  | 'product_unavailable'
  | 'invalid_quantity'
  | 'unknown_modifier'
  | 'modifier_unavailable'
  | 'invalid_modifier_quantity'
  | 'group_min_not_met'
  | 'group_max_exceeded';

export interface PricingError {
  code: PricingErrorCode;
  message: string;
  groupId?: string;
  modifierId?: string;
}

export type PriceItemResult = { ok: true; item: PricedItem } | { ok: false; errors: PricingError[] };

export function priceItem(product: PricingProduct, selection: ItemSelection): PriceItemResult {
  const errors: PricingError[] = [];

  if (!product.isAvailable) {
    errors.push({ code: 'product_unavailable', message: `${product.name} não está disponível no momento.` });
  }
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > MAX_ITEM_QUANTITY) {
    errors.push({ code: 'invalid_quantity', message: `Quantidade inválida para ${product.name}.` });
  }

  // Agrupa seleções repetidas do mesmo adicional.
  const requested = new Map<string, number>();
  for (const m of selection.modifiers) {
    requested.set(m.modifierId, (requested.get(m.modifierId) ?? 0) + m.quantity);
  }

  const index = new Map<string, { group: PricingGroup; modifier: PricingModifier }>();
  for (const group of product.groups) {
    for (const modifier of group.modifiers) index.set(modifier.id, { group, modifier });
  }

  const priced: PricedModifier[] = [];
  const perGroup = new Map<string, number>();

  for (const [modifierId, quantity] of requested) {
    const entry = index.get(modifierId);
    if (!entry) {
      errors.push({ code: 'unknown_modifier', message: 'Um dos adicionais escolhidos não pertence a este produto.', modifierId });
      continue;
    }
    const { group, modifier } = entry;
    if (!modifier.isAvailable) {
      errors.push({
        code: 'modifier_unavailable',
        message: `${modifier.name} não está disponível no momento.`,
        modifierId,
        groupId: group.id,
      });
      continue;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > modifier.maxQuantity) {
      errors.push({
        code: 'invalid_modifier_quantity',
        message: `Você pode escolher até ${modifier.maxQuantity}x ${modifier.name}.`,
        modifierId,
        groupId: group.id,
      });
      continue;
    }
    perGroup.set(group.id, (perGroup.get(group.id) ?? 0) + quantity);
    priced.push({
      modifierId,
      groupId: group.id,
      groupName: group.name,
      name: modifier.name,
      priceCents: modifier.priceCents,
      quantity,
      totalCents: modifier.priceCents * quantity,
    });
  }

  for (const group of product.groups) {
    const count = perGroup.get(group.id) ?? 0;
    if (count < group.minSelect) {
      errors.push({
        code: 'group_min_not_met',
        message:
          group.minSelect === 1
            ? `Escolha uma opção em "${group.name}".`
            : `Escolha pelo menos ${group.minSelect} opções em "${group.name}".`,
        groupId: group.id,
      });
    }
    if (count > group.maxSelect) {
      errors.push({
        code: 'group_max_exceeded',
        message: `Escolha no máximo ${group.maxSelect} ${group.maxSelect === 1 ? 'opção' : 'opções'} em "${group.name}".`,
        groupId: group.id,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Ordena adicionais pela ordem dos grupos/opções do produto para exibição estável.
  const order = new Map<string, number>();
  let i = 0;
  for (const group of product.groups) for (const m of group.modifiers) order.set(m.id, i++);
  priced.sort((a, b) => (order.get(a.modifierId) ?? 0) - (order.get(b.modifierId) ?? 0));

  const modifiersCents = priced.reduce((sum, m) => sum + m.totalCents, 0);
  const unitPriceCents = product.priceCents + modifiersCents;
  const notes = selection.notes?.trim() ? selection.notes.trim().slice(0, 280) : null;

  return {
    ok: true,
    item: {
      productId: product.id,
      productName: product.name,
      basePriceCents: product.priceCents,
      quantity: selection.quantity,
      unitPriceCents,
      totalCents: unitPriceCents * selection.quantity,
      notes,
      modifiers: priced,
    },
  };
}

export interface OrderTotalsInput {
  items: Pick<PricedItem, 'totalCents'>[];
  discountCents?: number;
  deliveryFeeCents?: number;
}

export interface OrderTotals {
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
}

export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const subtotalCents = input.items.reduce((sum, i) => sum + i.totalCents, 0);
  const deliveryFeeCents = Math.max(0, Math.round(input.deliveryFeeCents ?? 0));
  // Desconto nunca ultrapassa o subtotal dos produtos (taxa de entrega não é descontada aqui).
  const discountCents = Math.min(Math.max(0, Math.round(input.discountCents ?? 0)), subtotalCents);
  return {
    subtotalCents,
    discountCents,
    deliveryFeeCents,
    totalCents: subtotalCents - discountCents + deliveryFeeCents,
  };
}

/** Texto de regra exibido no cardápio para cada grupo de adicionais. */
export function describeGroupRule(group: Pick<PricingGroup, 'minSelect' | 'maxSelect'>): string {
  const { minSelect, maxSelect } = group;
  if (minSelect === 0) return maxSelect === 1 ? 'Opcional · até 1' : `Opcional · até ${maxSelect}`;
  if (minSelect === maxSelect) return minSelect === 1 ? 'Obrigatório · escolha 1' : `Obrigatório · escolha ${minSelect}`;
  return `Obrigatório · de ${minSelect} a ${maxSelect}`;
}

/** Chave para juntar no carrinho itens idênticos (mesmo produto, mesmos adicionais, mesma observação). */
export function selectionKey(selection: ItemSelection): string {
  const mods = [...selection.modifiers]
    .filter((m) => m.quantity > 0)
    .sort((a, b) => a.modifierId.localeCompare(b.modifierId))
    .map((m) => `${m.modifierId}x${m.quantity}`)
    .join(',');
  return `${selection.productId}|${mods}|${(selection.notes ?? '').trim()}`;
}
