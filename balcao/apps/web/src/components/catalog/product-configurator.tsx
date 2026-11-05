'use client';

import { useMemo, useState } from 'react';
import { Check, ImageOff } from 'lucide-react';
import { describeGroupRule, formatBRL, priceItem, type ItemSelection, type PricingProduct } from '@balcao/shared';
import { Field, Stepper, Textarea } from '@/components/ui/field';
import { cx } from '@/lib/format';
import type { AdminCatalog, ModifierOption, Product, PublicProduct } from '@/lib/types';

export interface ConfigurableProduct {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  isAvailable: boolean;
  groups: { id: string; name: string; description: string | null; minSelect: number; maxSelect: number; options: ModifierOption[] }[];
}

export function fromPublic(p: PublicProduct): ConfigurableProduct {
  return p;
}

/** Produto do painel no mesmo formato do cardápio público (só grupos ativos com opções). */
export function fromAdmin(p: Product, catalog: AdminCatalog): ConfigurableProduct {
  const groups = p.modifierGroupIds
    .map((id) => catalog.modifierGroups.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => !!g && g.isActive && g.options.length > 0);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    imageUrl: p.imageUrl,
    priceCents: p.priceCents,
    isAvailable: p.isActive && p.isAvailable && !p.isSoldOut,
    groups,
  };
}

export function toPricing(p: ConfigurableProduct): PricingProduct {
  return {
    id: p.id,
    name: p.name,
    priceCents: p.priceCents,
    isAvailable: p.isAvailable,
    groups: p.groups.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      modifiers: g.options.map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents, maxQuantity: o.maxQuantity, isAvailable: o.isAvailable })),
    })),
  };
}

export interface ConfiguratorState {
  quantity: number;
  notes: string;
  selected: Record<string, number>;
}

export function initialState(product: ConfigurableProduct, from?: ItemSelection): ConfiguratorState {
  if (from) {
    return {
      quantity: from.quantity,
      notes: from.notes ?? '',
      selected: Object.fromEntries(from.modifiers.map((m) => [m.modifierId, m.quantity])),
    };
  }
  // Grupo obrigatório de escolha única com uma só opção disponível já vem marcado.
  const selected: Record<string, number> = {};
  for (const g of product.groups) {
    const available = g.options.filter((o) => o.isAvailable);
    if (g.minSelect === 1 && g.maxSelect === 1 && available.length === 1) selected[available[0]!.id] = 1;
  }
  return { quantity: 1, notes: '', selected };
}

export function useConfigurator(product: ConfigurableProduct, from?: ItemSelection) {
  const [state, setState] = useState<ConfiguratorState>(() => initialState(product, from));
  const [showErrors, setShowErrors] = useState(false);

  const selection: ItemSelection = useMemo(
    () => ({
      productId: product.id,
      quantity: state.quantity,
      notes: state.notes.trim() || null,
      modifiers: Object.entries(state.selected)
        .filter(([, q]) => q > 0)
        .map(([modifierId, quantity]) => ({ modifierId, quantity })),
    }),
    [product.id, state],
  );
  const result = useMemo(() => priceItem(toPricing(product), selection), [product, selection]);

  // Prévia do valor mesmo enquanto faltam escolhas obrigatórias.
  const previewCents = useMemo(() => {
    let unit = product.priceCents;
    for (const g of product.groups) for (const o of g.options) unit += (state.selected[o.id] ?? 0) * o.priceCents;
    return unit * state.quantity;
  }, [product, state]);

  return { state, setState, selection, result, previewCents, showErrors, setShowErrors };
}

export function ProductConfigurator({
  product,
  config,
  compactHeader,
}: {
  product: ConfigurableProduct;
  config: ReturnType<typeof useConfigurator>;
  compactHeader?: boolean;
}) {
  const { state, setState, result, showErrors } = config;
  const groupErrors = new Map<string, string>();
  if (!result.ok && showErrors) for (const e of result.errors) if (e.groupId && !groupErrors.has(e.groupId)) groupErrors.set(e.groupId, e.message);

  const setQty = (option: ModifierOption, group: ConfigurableProduct['groups'][number], qty: number) => {
    setState((s) => {
      const selected = { ...s.selected };
      const radio = group.maxSelect === 1;
      if (radio && qty > 0) for (const o of group.options) delete selected[o.id];
      if (qty <= 0) delete selected[option.id];
      else selected[option.id] = qty;
      return { ...s, selected };
    });
  };

  return (
    <div>
      {!compactHeader && (
        <div className="mb-5">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt="" className="mb-4 aspect-[16/10] w-full rounded-lg bg-sunken object-cover" />
          ) : null}
          <p className="num text-[0.9375rem] text-ink">{formatBRL(product.priceCents)}</p>
          {product.description && <p className="mt-1.5 text-sm leading-relaxed text-muted">{product.description}</p>}
        </div>
      )}

      <div className="space-y-6">
        {product.groups.map((group) => {
          const count = group.options.reduce((sum, o) => sum + (state.selected[o.id] ?? 0), 0);
          const full = count >= group.maxSelect;
          const radio = group.maxSelect === 1;
          const error = groupErrors.get(group.id);
          return (
            <fieldset key={group.id} className="min-w-0" aria-describedby={error ? `err-${group.id}` : undefined}>
              <legend className="mb-2 flex w-full items-start justify-between gap-3">
                <span>
                  <span className="block text-[0.9375rem] font-semibold text-ink">{group.name}</span>
                  <span className={cx('mt-0.5 block text-xs', error ? 'text-danger' : 'text-muted')} id={error ? `err-${group.id}` : undefined}>
                    {error ?? describeGroupRule(group)}
                    {group.description ? ` · ${group.description}` : ''}
                  </span>
                </span>
                {group.maxSelect > 1 && (
                  <span className="num mt-0.5 shrink-0 text-xs text-muted" aria-label={`${count} de ${group.maxSelect} escolhidos`}>
                    {count}/{group.maxSelect}
                  </span>
                )}
              </legend>
              <ul className={cx('divide-y divide-line overflow-hidden rounded-lg border', error ? 'border-danger/40' : 'border-line')}>
                {group.options.map((option) => {
                  const qty = state.selected[option.id] ?? 0;
                  const disabled = !option.isAvailable || (!radio && qty === 0 && full);
                  const multi = option.maxQuantity > 1 && !radio;
                  return (
                    <li key={option.id}>
                      {multi ? (
                        <div className={cx('flex items-center gap-3 px-3.5 py-3', !option.isAvailable && 'opacity-50')}>
                          <OptionText option={option} />
                          {qty > 0 ? (
                            <Stepper
                              size="sm"
                              label={option.name}
                              value={qty}
                              min={0}
                              max={Math.min(option.maxQuantity, qty + (group.maxSelect - count))}
                              onChange={(v) => setQty(option, group, v)}
                            />
                          ) : (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => setQty(option, group, 1)}
                              className="h-8 rounded-md border border-line-strong px-3 text-[0.8125rem] font-medium text-ink-2 hover:border-ink/30 disabled:opacity-40"
                            >
                              Adicionar
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          role={radio ? 'radio' : 'checkbox'}
                          aria-checked={qty > 0}
                          disabled={disabled}
                          onClick={() => setQty(option, group, qty > 0 && !radio ? 0 : 1)}
                          className={cx(
                            'flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed',
                            qty > 0 ? 'bg-[var(--accent-soft)]' : 'hover:bg-canvas',
                            disabled && 'opacity-50',
                          )}
                        >
                          <OptionText option={option} />
                          <span
                            aria-hidden="true"
                            className={cx(
                              'grid size-5 shrink-0 place-items-center border transition-colors',
                              radio ? 'rounded-full' : 'rounded',
                              qty > 0 ? 'border-[var(--accent)] bg-[var(--accent)] text-[color:var(--accent-ink,#fff)]' : 'border-line-strong bg-surface',
                            )}
                          >
                            {qty > 0 && (radio ? <span className="size-2 rounded-full bg-[var(--accent-ink,#fff)]" /> : <Check className="size-3.5" strokeWidth={3} />)}
                          </span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}

        <Field label="Alguma observação?" htmlFor={`notes-${product.id}`} optional>
          <Textarea
            id={`notes-${product.id}`}
            rows={2}
            maxLength={280}
            placeholder="Ex.: sem cebola, ponto da carne, cortar ao meio"
            value={state.notes}
            onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
          />
        </Field>
      </div>
    </div>
  );
}

function OptionText({ option }: { option: ModifierOption }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-sm text-ink">{option.name}</span>
      {option.description && <span className="block text-xs text-muted">{option.description}</span>}
      {!option.isAvailable ? (
        <span className="block text-xs text-muted">Indisponível</span>
      ) : option.priceCents > 0 ? (
        <span className="num mt-0.5 block text-xs text-ink-2">+ {formatBRL(option.priceCents)}</span>
      ) : null}
    </span>
  );
}

export function ProductThumb({ src, className }: { src: string | null; className?: string }) {
  if (!src) {
    return (
      <span className={cx('grid shrink-0 place-items-center rounded-md bg-sunken text-faint', className)} aria-hidden="true">
        <ImageOff className="size-4" />
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" className={cx('shrink-0 rounded-md bg-sunken object-cover', className)} />;
}
