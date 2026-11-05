'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { priceItem, selectionKey, type ItemSelection, type PricedItem } from '@balcao/shared';
import { toPricing } from '@/components/catalog/product-configurator';
import type { PublicProduct, PublicStore } from './types';

/**
 * Sacola do cliente, guardada no navegador (por loja). Os preços exibidos são recalculados a
 * partir do cardápio atual a cada carregamento; o valor oficial é sempre o calculado pela API.
 */
export interface StoredLine {
  key: string;
  selection: ItemSelection;
}

export interface CartLineView {
  key: string;
  selection: ItemSelection;
  product: PublicProduct | null;
  priced: PricedItem | null;
  problem: string | null;
}

const storageKey = (slug: string) => `balcao:cart:${slug}`;

function read(slug: string): StoredLine[] {
  try {
    const raw = localStorage.getItem(storageKey(slug));
    const parsed = raw ? (JSON.parse(raw) as StoredLine[]) : [];
    return Array.isArray(parsed) ? parsed.filter((l) => l && l.selection && typeof l.selection.productId === 'string') : [];
  } catch {
    return [];
  }
}

function write(slug: string, lines: StoredLine[]) {
  try {
    localStorage.setItem(storageKey(slug), JSON.stringify(lines));
    window.dispatchEvent(new CustomEvent('balcao:cart', { detail: slug }));
  } catch {
    /* armazenamento indisponível: a sacola vale só nesta página */
  }
}

export function useCart(slug: string, store: PublicStore | null) {
  const [lines, setLines] = useState<StoredLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLines(read(slug));
    setReady(true);
    const sync = (e: Event) => {
      if ((e as CustomEvent).detail === slug) setLines(read(slug));
    };
    const storage = (e: StorageEvent) => {
      if (e.key === storageKey(slug)) setLines(read(slug));
    };
    window.addEventListener('balcao:cart', sync);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('balcao:cart', sync);
      window.removeEventListener('storage', storage);
    };
  }, [slug]);

  const commit = useCallback(
    (next: StoredLine[]) => {
      setLines(next);
      write(slug, next);
    },
    [slug],
  );

  const products = useMemo(() => {
    const map = new Map<string, PublicProduct>();
    for (const c of store?.categories ?? []) for (const p of c.products) map.set(p.id, p);
    return map;
  }, [store]);

  const view: CartLineView[] = useMemo(
    () =>
      lines.map((l) => {
        const product = products.get(l.selection.productId) ?? null;
        if (!product) return { ...l, product: null, priced: null, problem: 'Saiu do cardápio' };
        const r = priceItem(toPricing(product), l.selection);
        return r.ok ? { ...l, product, priced: r.item, problem: null } : { ...l, product, priced: null, problem: r.errors[0]?.message ?? 'Indisponível' };
      }),
    [lines, products],
  );

  const add = useCallback(
    (selection: ItemSelection) => {
      const k = selectionKey({ ...selection, quantity: 0 });
      const existing = lines.find((l) => selectionKey({ ...l.selection, quantity: 0 }) === k);
      if (existing) {
        commit(lines.map((l) => (l.key === existing.key ? { ...l, selection: { ...l.selection, quantity: Math.min(99, l.selection.quantity + selection.quantity) } } : l)));
      } else {
        commit([...lines, { key: `${k}#${Date.now()}`, selection }]);
      }
    },
    [lines, commit],
  );

  const update = useCallback((key: string, selection: ItemSelection) => commit(lines.map((l) => (l.key === key ? { ...l, selection } : l))), [lines, commit]);
  const setQuantity = useCallback(
    (key: string, quantity: number) =>
      commit(quantity <= 0 ? lines.filter((l) => l.key !== key) : lines.map((l) => (l.key === key ? { ...l, selection: { ...l.selection, quantity } } : l))),
    [lines, commit],
  );
  const remove = useCallback((key: string) => commit(lines.filter((l) => l.key !== key)), [lines, commit]);
  const clear = useCallback(() => commit([]), [commit]);
  const removeInvalid = useCallback(() => commit(lines.filter((l) => view.find((v) => v.key === l.key)?.problem === null)), [lines, view, commit]);

  const valid = view.filter((v) => v.priced);
  const subtotalCents = valid.reduce((s, v) => s + v.priced!.totalCents, 0);
  const count = view.reduce((s, v) => s + v.selection.quantity, 0);

  return { ready, lines: view, add, update, setQuantity, remove, clear, removeInvalid, subtotalCents, count, hasProblems: view.some((v) => v.problem) };
}

export function deliveryFeeFor(store: PublicStore['store'], subtotalCents: number) {
  if (store.freeDeliveryAboveCents !== null && subtotalCents >= store.freeDeliveryAboveCents) return 0;
  return store.deliveryFeeCents;
}

/** Dados do cliente lembrados neste aparelho para o próximo pedido. */
export interface RememberedCustomer {
  name: string;
  phone: string;
  address?: { zipCode: string; street: string; number: string; complement: string; neighborhood: string; city: string; state: string; reference: string };
}
const CUSTOMER_KEY = 'balcao:customer';
export function readCustomer(): RememberedCustomer | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_KEY);
    return raw ? (JSON.parse(raw) as RememberedCustomer) : null;
  } catch {
    return null;
  }
}
export function saveCustomer(c: RememberedCustomer) {
  try {
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
export function forgetCustomer() {
  try {
    localStorage.removeItem(CUSTOMER_KEY);
  } catch {
    /* ignore */
  }
}

const LAST_ORDER_KEY = (slug: string) => `balcao:last-order:${slug}`;
export function rememberOrder(slug: string, token: string) {
  try {
    localStorage.setItem(LAST_ORDER_KEY(slug), JSON.stringify({ token, at: Date.now() }));
  } catch {
    /* ignore */
  }
}
export function lastOrder(slug: string): { token: string; at: number } | null {
  try {
    const raw = localStorage.getItem(LAST_ORDER_KEY(slug));
    const v = raw ? (JSON.parse(raw) as { token: string; at: number }) : null;
    // Só mostra o atalho por 6 horas.
    return v && Date.now() - v.at < 6 * 3600_000 ? v : null;
  } catch {
    return null;
  }
}
