'use client';

import { useMemo, useState } from 'react';
import { Minus, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { formatBRL, priceItem, selectionKey, type ItemSelection, type PricedItem } from '@balcao/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/misc';
import { cx } from '@/lib/format';
import type { AdminCatalog, OrderItem } from '@/lib/types';
import { fromAdmin, ProductConfigurator, ProductThumb, toPricing, useConfigurator, type ConfigurableProduct } from '../catalog/product-configurator';

export interface CartLine {
  key: string;
  product: ConfigurableProduct;
  selection: ItemSelection;
  priced: PricedItem;
}

export function linesFromOrderItems(items: OrderItem[], catalog: AdminCatalog): { lines: CartLine[]; missing: string[] } {
  const lines: CartLine[] = [];
  const missing: string[] = [];
  const all = catalog.categories.flatMap((c) => c.products);
  for (const item of items) {
    const p = item.productId ? all.find((x) => x.id === item.productId) : undefined;
    if (!p) {
      missing.push(item.productName);
      continue;
    }
    const product = fromAdmin(p, catalog);
    const selection: ItemSelection = {
      productId: p.id,
      quantity: item.quantity,
      notes: item.notes,
      modifiers: item.modifiers.filter((m) => m.modifierId).map((m) => ({ modifierId: m.modifierId!, quantity: m.quantity })),
    };
    const r = priceItem(toPricing(product), selection);
    if (r.ok) lines.push({ key: `${selectionKey(selection)}#${lines.length}`, product, selection, priced: r.item });
    else missing.push(`${item.productName} (${r.errors[0]?.message ?? 'indisponível'})`);
  }
  return { lines, missing };
}

/** Montagem de pedido pela equipe: busca de produto, adicionais e quantidades. */
export function CartBuilder({
  catalog,
  lines,
  onChange,
}: {
  catalog: AdminCatalog;
  lines: CartLine[];
  onChange: (lines: CartLine[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [configuring, setConfiguring] = useState<{ product: ConfigurableProduct; editKey?: string; from?: ItemSelection } | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.categories
      .filter((c) => c.isActive)
      .map((c) => ({
        ...c,
        products: c.products.filter((p) => p.isActive && (!q || p.name.toLowerCase().includes(q) || p.sku?.toLowerCase() === q)),
      }))
      .filter((c) => c.products.length > 0);
  }, [catalog, query]);

  const add = (product: ConfigurableProduct, selection: ItemSelection, priced: PricedItem, editKey?: string) => {
    if (editKey) {
      onChange(lines.map((l) => (l.key === editKey ? { ...l, selection, priced } : l)));
      return;
    }
    const key = selectionKey(selection);
    const existing = lines.find((l) => selectionKey({ ...l.selection, quantity: 0 }) === selectionKey({ ...selection, quantity: 0 }));
    if (existing) {
      const merged = { ...existing.selection, quantity: Math.min(99, existing.selection.quantity + selection.quantity) };
      const r = priceItem(toPricing(product), merged);
      if (r.ok) onChange(lines.map((l) => (l.key === existing.key ? { ...l, selection: merged, priced: r.item } : l)));
      return;
    }
    onChange([...lines, { key: `${key}#${Date.now()}`, product, selection, priced }]);
  };

  const quickAdd = (product: ConfigurableProduct) => {
    if (product.groups.length > 0) {
      setConfiguring({ product });
      return;
    }
    const selection: ItemSelection = { productId: product.id, quantity: 1, notes: null, modifiers: [] };
    const r = priceItem(toPricing(product), selection);
    if (r.ok) add(product, selection, r.item);
  };

  const setQty = (line: CartLine, quantity: number) => {
    if (quantity <= 0) return onChange(lines.filter((l) => l.key !== line.key));
    const selection = { ...line.selection, quantity };
    const r = priceItem(toPricing(line.product), selection);
    if (r.ok) onChange(lines.map((l) => (l.key === line.key ? { ...l, selection, priced: r.item } : l)));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="min-w-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar produto ou código" className="pl-9" aria-label="Buscar produto" />
        </div>
        <div className="mt-3 max-h-[420px] overflow-y-auto rounded-lg border border-line">
          {groups.length === 0 ? (
            <EmptyState title={query ? 'Nenhum produto encontrado' : 'Cardápio vazio'} description={query ? 'Tente outro nome.' : 'Cadastre produtos no Cardápio para lançar pedidos.'} />
          ) : (
            groups.map((c) => (
              <div key={c.id}>
                <div className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-3 py-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted backdrop-blur">{c.name}</div>
                <ul className="divide-y divide-line">
                  {c.products.map((p) => {
                    const product = fromAdmin(p, catalog);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={!product.isAvailable}
                          onClick={() => quickAdd(product)}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ProductThumb src={p.imageUrl} className="size-10" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink">{p.name}</span>
                            <span className="block text-xs text-muted">
                              {!product.isAvailable ? (p.isSoldOut ? 'Esgotado' : 'Pausado') : product.groups.length ? 'Com opções' : ' '}
                            </span>
                          </span>
                          <span className="num text-[0.8125rem] text-ink-2">{formatBRL(p.priceCents)}</span>
                          <Plus className="size-4 text-muted" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="min-w-0">
        <p className="mb-2 text-[0.8125rem] font-medium text-ink-2">Itens do pedido</p>
        {lines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">Escolha produtos na lista.</div>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {lines.map((line) => (
              <li key={line.key} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{line.priced.productName}</p>
                  {line.priced.modifiers.length > 0 && (
                    <p className="text-xs text-muted">{line.priced.modifiers.map((m) => (m.quantity > 1 ? `${m.name} ×${m.quantity}` : m.name)).join(' · ')}</p>
                  )}
                  {line.priced.notes && <p className="text-xs italic text-warn">“{line.priced.notes}”</p>}
                  <div className="mt-1.5 flex items-center gap-1">
                    <button type="button" className="grid size-7 place-items-center rounded-md border border-line-strong text-ink-2 hover:bg-sunken" onClick={() => setQty(line, line.selection.quantity - 1)} aria-label="Diminuir quantidade">
                      {line.selection.quantity === 1 ? <Trash2 className="size-3.5" /> : <Minus className="size-3.5" />}
                    </button>
                    <span className="num w-7 text-center text-sm">{line.selection.quantity}</span>
                    <button type="button" className="grid size-7 place-items-center rounded-md border border-line-strong text-ink-2 hover:bg-sunken" onClick={() => setQty(line, line.selection.quantity + 1)} aria-label="Aumentar quantidade">
                      <Plus className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        className="ml-1 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-sunken hover:text-ink"
                        onClick={() => setConfiguring({ product: line.product, editKey: line.key, from: line.selection })}
                      >
                        <Pencil className="size-3" /> Editar
                      </button>
                  </div>
                </div>
                <span className="num text-[0.8125rem] text-ink">{formatBRL(line.priced.totalCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {configuring && (
        <ConfigureModal
          key={configuring.editKey ?? configuring.product.id}
          product={configuring.product}
          from={configuring.from}
          editing={!!configuring.editKey}
          onClose={() => setConfiguring(null)}
          onConfirm={(selection, priced) => {
            add(configuring.product, selection, priced, configuring.editKey);
            setConfiguring(null);
          }}
        />
      )}
    </div>
  );
}

function ConfigureModal({
  product,
  from,
  editing,
  onClose,
  onConfirm,
}: {
  product: ConfigurableProduct;
  from?: ItemSelection;
  editing: boolean;
  onClose: () => void;
  onConfirm: (selection: ItemSelection, priced: PricedItem) => void;
}) {
  const config = useConfigurator(product, from);
  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <QuantityInline value={config.state.quantity} onChange={(q) => config.setState((s) => ({ ...s, quantity: q }))} />
          </div>
          <Button
            onClick={() => {
              if (!config.result.ok) {
                config.setShowErrors(true);
                return;
              }
              onConfirm(config.selection, config.result.item);
            }}
          >
            {editing ? 'Salvar item' : 'Adicionar'} · <span className="num">{formatBRL(config.previewCents)}</span>
          </Button>
        </div>
      }
    >
      <ProductConfigurator product={product} config={config} />
    </Modal>
  );
}

export function QuantityInline({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex items-center rounded-md border border-line-strong" role="group" aria-label="Quantidade">
      <button type="button" className={cx('grid size-9 place-items-center text-ink-2 hover:bg-sunken disabled:opacity-30')} disabled={value <= 1} onClick={() => onChange(value - 1)} aria-label="Diminuir quantidade">
        <Minus className="size-4" />
      </button>
      <span className="num w-8 text-center text-sm">{value}</span>
      <button type="button" className="grid size-9 place-items-center text-ink-2 hover:bg-sunken disabled:opacity-30" disabled={value >= 99} onClick={() => onChange(value + 1)} aria-label="Aumentar quantidade">
        <Plus className="size-4" />
      </button>
    </div>
  );
}
