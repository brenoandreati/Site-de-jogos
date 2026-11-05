import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  canTransition,
  computeOrderTotals,
  detectDocumentType,
  formatBRL,
  getStoreAvailability,
  hasAccess,
  isValidCNPJ,
  isValidCPF,
  isValidSlug,
  normalizeBrazilianPhone,
  parseBRLToCents,
  priceItem,
  publicCheckoutSchema,
  renderTemplate,
  resolvePermissions,
  selectionKey,
  slugify,
  validateIntervals,
  type PricingProduct,
} from '../index';

const acai: PricingProduct = {
  id: 'p1',
  name: 'Açaí',
  priceCents: 1500,
  isAvailable: true,
  groups: [
    {
      id: 'g-size',
      name: 'Tamanho',
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: 's300', name: '300 ml', priceCents: 0, maxQuantity: 1, isAvailable: true },
        { id: 's500', name: '500 ml', priceCents: 500, maxQuantity: 1, isAvailable: true },
        { id: 's700', name: '700 ml', priceCents: 900, maxQuantity: 1, isAvailable: false },
      ],
    },
    {
      id: 'g-free',
      name: 'Acompanhamentos',
      minSelect: 0,
      maxSelect: 3,
      modifiers: [
        { id: 'granola', name: 'Granola', priceCents: 0, maxQuantity: 1, isAvailable: true },
        { id: 'banana', name: 'Banana', priceCents: 0, maxQuantity: 1, isAvailable: true },
        { id: 'pacoca', name: 'Paçoca', priceCents: 0, maxQuantity: 1, isAvailable: true },
        { id: 'morango', name: 'Morango', priceCents: 0, maxQuantity: 1, isAvailable: true },
      ],
    },
    {
      id: 'g-paid',
      name: 'Adicionais',
      minSelect: 0,
      maxSelect: 5,
      modifiers: [{ id: 'nutella', name: 'Nutella', priceCents: 450, maxQuantity: 2, isAvailable: true }],
    },
  ],
};

describe('money', () => {
  it('formats and parses BRL', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(parseBRLToCents('12,5')).toBe(1250);
    expect(parseBRLToCents('R$ 1.234,56')).toBe(123456);
    expect(parseBRLToCents('10')).toBe(1000);
    expect(parseBRLToCents('10.99')).toBe(1099);
    expect(parseBRLToCents('abc')).toBeNull();
    expect(parseBRLToCents('1,234')).toBeNull();
  });
});

describe('phone', () => {
  it('normalizes Brazilian numbers', () => {
    expect(normalizeBrazilianPhone('(11) 91234-5678')).toBe('5511912345678');
    expect(normalizeBrazilianPhone('+55 21 3456-7890')).toBe('552134567890');
    expect(normalizeBrazilianPhone('011912345678')).toBe('5511912345678');
    expect(normalizeBrazilianPhone('(10) 91234-5678')).toBeNull();
    expect(normalizeBrazilianPhone('(11) 81234-5678')).toBeNull();
    expect(normalizeBrazilianPhone('123')).toBeNull();
  });
});

describe('documents', () => {
  it('validates CPF and CNPJ, including alphanumeric CNPJ', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true);
    expect(isValidCNPJ('11.222.333/0001-82')).toBe(false);
    // Exemplo oficial da Receita Federal para o CNPJ alfanumérico.
    expect(isValidCNPJ('12.ABC.345/01DE-35')).toBe(true);
    expect(detectDocumentType('52998224725')).toBe('cpf');
    expect(detectDocumentType('11222333000181')).toBe('cnpj');
  });
});

describe('order status machine', () => {
  it('only allows dispatch for delivery orders', () => {
    expect(canTransition('ready', 'out_for_delivery', 'delivery')).toBe(true);
    expect(canTransition('ready', 'out_for_delivery', 'pickup')).toBe(false);
    expect(canTransition('ready', 'completed', 'delivery')).toBe(false);
    expect(canTransition('ready', 'completed', 'pickup')).toBe(true);
  });
  it('forbids leaving final states and skipping back', () => {
    expect(allowedTransitions('completed', 'pickup')).toEqual([]);
    expect(allowedTransitions('canceled', 'delivery')).toEqual([]);
    expect(canTransition('preparing', 'new', 'pickup')).toBe(false);
  });
});

describe('pricing', () => {
  it('prices an item with modifiers', () => {
    const result = priceItem(acai, {
      productId: 'p1',
      quantity: 2,
      notes: '  sem açúcar ',
      modifiers: [
        { modifierId: 's500', quantity: 1 },
        { modifierId: 'granola', quantity: 1 },
        { modifierId: 'nutella', quantity: 2 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1500 + 500 + 0 + 2×450 = 2900 por unidade
    expect(result.item.unitPriceCents).toBe(2900);
    expect(result.item.totalCents).toBe(5800);
    expect(result.item.notes).toBe('sem açúcar');
    expect(result.item.modifiers.map((m) => m.modifierId)).toEqual(['s500', 'granola', 'nutella']);
  });

  it('rejects missing required group, exceeded max and unavailable options', () => {
    const missing = priceItem(acai, { productId: 'p1', quantity: 1, modifiers: [] });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]!.code).toBe('group_min_not_met');

    const tooMany = priceItem(acai, {
      productId: 'p1',
      quantity: 1,
      modifiers: [
        { modifierId: 's300', quantity: 1 },
        { modifierId: 'granola', quantity: 1 },
        { modifierId: 'banana', quantity: 1 },
        { modifierId: 'pacoca', quantity: 1 },
        { modifierId: 'morango', quantity: 1 },
      ],
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.errors.some((e) => e.code === 'group_max_exceeded')).toBe(true);

    const unavailable = priceItem(acai, { productId: 'p1', quantity: 1, modifiers: [{ modifierId: 's700', quantity: 1 }] });
    expect(unavailable.ok).toBe(false);

    const foreign = priceItem(acai, {
      productId: 'p1',
      quantity: 1,
      modifiers: [
        { modifierId: 's300', quantity: 1 },
        { modifierId: 'from-another-product', quantity: 1 },
      ],
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0]!.code).toBe('unknown_modifier');

    const tooMuchNutella = priceItem(acai, {
      productId: 'p1',
      quantity: 1,
      modifiers: [
        { modifierId: 's300', quantity: 1 },
        { modifierId: 'nutella', quantity: 3 },
      ],
    });
    expect(tooMuchNutella.ok).toBe(false);
  });

  it('merges duplicated modifier entries before validating', () => {
    const r = priceItem(acai, {
      productId: 'p1',
      quantity: 1,
      modifiers: [
        { modifierId: 's300', quantity: 1 },
        { modifierId: 'nutella', quantity: 1 },
        { modifierId: 'nutella', quantity: 1 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item.unitPriceCents).toBe(1500 + 900);
  });

  it('computes totals and caps discount at subtotal', () => {
    expect(computeOrderTotals({ items: [{ totalCents: 3000 }, { totalCents: 1000 }], discountCents: 500, deliveryFeeCents: 700 })).toEqual({
      subtotalCents: 4000,
      discountCents: 500,
      deliveryFeeCents: 700,
      totalCents: 4200,
    });
    expect(computeOrderTotals({ items: [{ totalCents: 1000 }], discountCents: 5000 }).totalCents).toBe(0);
  });

  it('builds stable cart keys', () => {
    const a = selectionKey({ productId: 'p', quantity: 1, modifiers: [{ modifierId: 'b', quantity: 1 }, { modifierId: 'a', quantity: 2 }] });
    const b = selectionKey({ productId: 'p', quantity: 3, modifiers: [{ modifierId: 'a', quantity: 2 }, { modifierId: 'b', quantity: 1 }] });
    expect(a).toBe(b);
  });
});

describe('permissions', () => {
  it('applies role defaults and owner overrides', () => {
    const attendant = resolvePermissions('attendant');
    expect(hasAccess(attendant, 'orders', 'edit')).toBe(true);
    expect(hasAccess(attendant, 'orders', 'manage')).toBe(false);
    expect(hasAccess(attendant, 'settings', 'view')).toBe(false);
    const custom = resolvePermissions('attendant', { orders: 'manage', catalog: 'none' });
    expect(hasAccess(custom, 'orders', 'manage')).toBe(true);
    expect(hasAccess(custom, 'catalog', 'view')).toBe(false);
    const owner = resolvePermissions('owner', { orders: 'none' });
    expect(hasAccess(owner, 'orders', 'manage')).toBe(true);
  });
});

describe('opening hours', () => {
  const hours = [
    { weekday: 5, opensAt: '18:00', closesAt: '02:00' }, // sexta, atravessa meia-noite
    { weekday: 1, opensAt: '11:00', closesAt: '14:00' },
  ];
  const tz = 'America/Sao_Paulo';
  it('handles overnight intervals', () => {
    // Sábado 01:30 em São Paulo (UTC-3) = sábado 04:30 UTC
    expect(getStoreAvailability({ hours, timeZone: tz }, new Date('2026-11-07T04:30:00Z')).isOpen).toBe(true);
    // Sábado 02:30 local
    const closed = getStoreAvailability({ hours, timeZone: tz }, new Date('2026-11-07T05:30:00Z'));
    expect(closed.isOpen).toBe(false);
    expect(closed.nextOpening).toEqual({ weekday: 1, opensAt: '11:00' });
  });
  it('respects manual pause', () => {
    const open = new Date('2026-11-09T15:00:00Z'); // segunda 12:00 local
    expect(getStoreAvailability({ hours, timeZone: tz }, open).isOpen).toBe(true);
    expect(getStoreAvailability({ hours, timeZone: tz, isPaused: true }, open).reason).toBe('paused');
    expect(
      getStoreAvailability({ hours, timeZone: tz, isPaused: true, pausedUntil: new Date('2026-11-09T14:00:00Z') }, open).isOpen,
    ).toBe(true);
  });
  it('detects overlaps', () => {
    expect(validateIntervals([{ weekday: 1, opensAt: '10:00', closesAt: '15:00' }, { weekday: 1, opensAt: '14:00', closesAt: '18:00' }])).toMatch(/sobrepostos/);
    expect(validateIntervals(hours)).toBeNull();
  });
});

describe('slugs', () => {
  it('slugifies store names', () => {
    expect(slugify('Açaí do Zé & Cia')).toBe('acai-do-ze-e-cia');
    expect(isValidSlug('painel')).toBe(false);
    expect(isValidSlug('acai-do-ze')).toBe(true);
    expect(isValidSlug('a')).toBe(false);
  });
});

describe('checkout schema', () => {
  const base = {
    idempotencyKey: '7f9c2b7e-4a8e-4f53-9d1c-2d7b6b9b8a11',
    customer: { name: 'Ana', phone: '(11) 91234-5678' },
    paymentMethod: 'pix',
    items: [{ productId: '7f9c2b7e-4a8e-4f53-9d1c-2d7b6b9b8a12', quantity: 1, modifiers: [] }],
  };
  it('requires address for delivery and normalizes phone', () => {
    const r = publicCheckoutSchema.safeParse({ ...base, fulfillment: 'delivery' });
    expect(r.success).toBe(false);
    const ok = publicCheckoutSchema.safeParse({ ...base, fulfillment: 'pickup' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.customer.phone).toBe('5511912345678');
  });
  it('accepts online at schema level (API checks the provider), rejects change for non-cash', () => {
    expect(publicCheckoutSchema.safeParse({ ...base, fulfillment: 'pickup', paymentMethod: 'online' }).success).toBe(true);
    expect(publicCheckoutSchema.safeParse({ ...base, fulfillment: 'pickup', changeForCents: 5000 }).success).toBe(false);
  });
});

describe('whatsapp ids', () => {
  it('adds the ninth digit to Brazilian mobile wa_ids', async () => {
    const { normalizeWhatsAppId } = await import('../phone');
    expect(normalizeWhatsAppId('551187654321')).toBe('5511987654321');
    expect(normalizeWhatsAppId('5511987654321')).toBe('5511987654321');
    expect(normalizeWhatsAppId('551132654321')).toBe('551132654321');
  });
});

describe('payment pending orders', () => {
  it('only the provider moves an awaiting-payment order forward', async () => {
    const { nextStatus, canTransition } = await import('../orders');
    expect(nextStatus('awaiting_confirmation', 'pickup')).toBeNull();
    expect(canTransition('awaiting_confirmation', 'new', 'pickup')).toBe(true);
  });
});

describe('templates', () => {
  it('renders variables', () => {
    expect(
      renderTemplate('Oi {cliente}, pedido #{pedido} {desconhecida}', {
        cliente: 'Ana',
        pedido: 12,
        loja: 'X',
        total: 'R$ 1,00',
        link: '',
        previsao: '',
      }),
    ).toBe('Oi Ana, pedido #12 {desconhecida}');
  });
});
