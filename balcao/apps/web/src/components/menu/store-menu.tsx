'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, Receipt, Search, ShoppingBag, Trash2, X } from 'lucide-react';
import { formatBRL, type ItemSelection } from '@balcao/shared';
import { ProductConfigurator, useConfigurator, type ConfigurableProduct } from '@/components/catalog/product-configurator';
import { Modal } from '@/components/ui/modal';
import { get } from '@/lib/api';
import { deliveryFeeHint, lastOrder, useCart, type CartLineView } from '@/lib/cart';
import { cx } from '@/lib/format';
import type { PublicProduct, PublicStore } from '@/lib/types';
import { StoreHeader } from './store-header';
import { AccentButton } from './accent-button';

export function StoreMenu({ initial, slug }: { initial: PublicStore; slug: string }) {
  // Mantém disponibilidade e status da loja atualizados enquanto o cliente navega.
  const query = useQuery({
    queryKey: ['public-store', slug],
    queryFn: ({ signal }) => get<PublicStore>(`/public/stores/${slug}`, signal),
    initialData: initial,
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
  const data = query.data;
  const cart = useCart(slug, data);
  const [selected, setSelected] = useState<{ product: PublicProduct; editKey?: string; from?: ItemSelection } | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState(data.categories[0]?.id ?? '');
  const [pending, setPending] = useState<{ token: string } | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPending(lastOrder(slug)), [slug]);

  const featured = useMemo(() => data.categories.flatMap((c) => c.products).filter((p) => p.isFeatured && p.isAvailable).slice(0, 8), [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.categories;
    return data.categories
      .map((c) => ({ ...c, products: c.products.filter((p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)) }))
      .filter((c) => c.products.length);
  }, [data, search]);

  // Destaca a categoria visível na barra de navegação.
  useEffect(() => {
    const sections = data.categories.map((c) => document.getElementById(`cat-${c.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveCat(visible.target.id.replace('cat-', ''));
      },
      { rootMargin: '-120px 0px -60% 0px' },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [data.categories, search]);

  useEffect(() => {
    navRef.current?.querySelector(`[data-cat="${activeCat}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [activeCat]);

  const store = data.store;
  const open = store.availability.isOpen;

  return (
    <div className="mx-auto max-w-6xl pb-28 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 lg:px-6 lg:pb-12">
      <div className="min-w-0 bg-surface sm:px-6 sm:pb-6 lg:rounded-b-xl lg:px-0 lg:pb-0 lg:bg-transparent">
        <StoreHeader store={store} />

        {pending && (
          <Link href={`/${slug}/pedido/${pending.token}`} className="mx-4 mt-4 flex items-center gap-3 rounded-lg border border-line bg-[var(--accent-soft)] px-4 py-3 text-sm sm:mx-0">
            <Receipt className="size-4 shrink-0 text-[var(--accent)]" />
            <span className="flex-1">Você tem um pedido recente. Acompanhe o andamento.</span>
            <span className="font-medium text-[var(--accent)]">Ver</span>
          </Link>
        )}

        {!open && (
          <p className="mx-4 mt-4 rounded-lg bg-sunken px-4 py-3 text-sm text-ink-2 sm:mx-0" role="status">
            {store.availabilityText}. Você pode ver o cardápio e montar a sacola, mas só consegue enviar o pedido quando a loja abrir.
          </p>
        )}

        <div className="sticky top-0 z-20 mt-5 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85 lg:bg-canvas/95">
          <div className="flex items-center gap-2 px-4 pt-3 sm:px-0">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar no cardápio"
                aria-label="Buscar no cardápio"
                className="h-10 w-full rounded-full border border-line bg-canvas pl-9 pr-4 text-sm outline-none placeholder:text-faint focus:border-[var(--accent)] focus:bg-surface lg:bg-surface"
              />
            </div>
          </div>
          {!search && (
            <nav ref={navRef} aria-label="Categorias" className="scrollbar-none flex gap-1 overflow-x-auto px-4 py-2.5 sm:px-0">
              {data.categories.map((c) => (
                <a
                  key={c.id}
                  data-cat={c.id}
                  href={`#cat-${c.id}`}
                  onClick={() => setActiveCat(c.id)}
                  className={cx(
                    'shrink-0 rounded-full px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors',
                    activeCat === c.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-sunken',
                  )}
                >
                  {c.name}
                </a>
              ))}
            </nav>
          )}
        </div>

        {featured.length > 0 && !search && (
          <section aria-labelledby="destaques" className="mt-6">
            <h2 id="destaques" className="px-4 text-lg font-semibold tracking-[-0.01em] sm:px-0">
              Destaques
            </h2>
            <ul className="scrollbar-none mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:px-0">
              {featured.map((p) => (
                <li key={p.id} className="w-40 shrink-0 snap-start">
                  <button type="button" onClick={() => setSelected({ product: p })} className="group block w-full text-left">
                    <div className="aspect-square overflow-hidden rounded-lg bg-sunken">
                      {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" /> : <div className="grid size-full place-items-center text-2xl font-semibold text-faint">{p.name.charAt(0)}</div>}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug">{p.name}</p>
                    <p className="num mt-0.5 text-[0.8125rem] text-ink-2">{p.groups.some((g) => g.options.some((o) => o.priceCents > 0)) ? 'a partir de ' : ''}{formatBRL(p.priceCents)}</p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {filtered.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted">{search ? `Nada encontrado para “${search}”.` : 'O cardápio ainda está sendo montado.'}</p>
        ) : (
          filtered.map((c) => (
            <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`h-${c.id}`} className="mt-8 scroll-mt-32">
              <div className="px-4 sm:px-0">
                <h2 id={`h-${c.id}`} className="text-lg font-semibold tracking-[-0.01em]">
                  {c.name}
                </h2>
                {c.description && <p className="mt-0.5 text-sm text-muted">{c.description}</p>}
              </div>
              <ul className="mt-2 divide-y divide-line sm:mt-3 sm:overflow-hidden sm:rounded-lg sm:border sm:border-line lg:bg-surface">
                {c.products.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelected({ product: p })}
                      disabled={!p.isAvailable}
                      className="flex w-full gap-4 px-4 py-4 text-left transition-colors hover:bg-canvas disabled:cursor-not-allowed"
                    >
                      <div className={cx('min-w-0 flex-1', !p.isAvailable && 'opacity-50')}>
                        <p className="font-medium leading-snug">{p.name}</p>
                        {p.description && <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-muted">{p.description}</p>}
                        <p className="num mt-2 text-[0.875rem] text-ink">
                          {!p.isAvailable ? <span className="font-sans text-[0.8125rem] text-muted">Indisponível no momento</span> : formatBRL(p.priceCents)}
                        </p>
                      </div>
                      {p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" className={cx('size-[88px] shrink-0 rounded-lg bg-sunken object-cover', !p.isAvailable && 'grayscale opacity-60')} />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        <footer className="mt-12 px-4 pb-6 text-center text-xs text-faint sm:px-0">
          Pedidos feitos aqui chegam direto no painel da {store.name}.{' '}
          <Link href="/privacidade" className="underline-offset-2 hover:underline">
            Privacidade
          </Link>
        </footer>
      </div>

      {/* Sacola lateral (computador) */}
      <aside className="hidden lg:block">
        <div className="sticky top-6 mt-6 rounded-xl border border-line bg-surface">
          <CartPanel slug={slug} store={store} cart={cart} onEdit={(line) => line.product && setSelected({ product: line.product, editKey: line.key, from: line.selection })} />
        </div>
      </aside>

      {/* Barra da sacola (celular) */}
      {cart.ready && cart.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-3 backdrop-blur lg:hidden">
          <AccentButton onClick={() => setCartOpen(true)} className="w-full justify-between">
            <span className="flex items-center gap-2">
              <span className="num grid size-6 place-items-center rounded-full bg-black/15 text-xs">{cart.count}</span>
              Ver sacola
            </span>
            <span className="num">{formatBRL(cart.subtotalCents)}</span>
          </AccentButton>
        </div>
      )}

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} side="bottom" size="md" hideClose bodyClassName="p-0">
        <CartPanel
          slug={slug}
          store={store}
          cart={cart}
          onClose={() => setCartOpen(false)}
          onEdit={(line) => {
            setCartOpen(false);
            if (line.product) setSelected({ product: line.product, editKey: line.key, from: line.selection });
          }}
        />
      </Modal>

      {selected && (
        <ProductSheet
          key={selected.editKey ?? selected.product.id}
          product={selected.product}
          from={selected.from}
          editing={!!selected.editKey}
          onClose={() => setSelected(null)}
          onConfirm={(selection) => {
            if (selected.editKey) cart.update(selected.editKey, selection);
            else cart.add(selection);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

function ProductSheet({
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
  onConfirm: (s: ItemSelection) => void;
}) {
  const config = useConfigurator(product, from);
  const { state, setState } = config;
  return (
    <Modal
      open
      onClose={onClose}
      side="bottom"
      size="md"
      title={product.name}
      footer={
        <div className="flex w-full items-center gap-3">
          <div className="inline-flex items-center rounded-full border border-line-strong">
            <button type="button" className="grid size-11 place-items-center text-ink-2 disabled:opacity-30" disabled={state.quantity <= 1} onClick={() => setState((s) => ({ ...s, quantity: s.quantity - 1 }))} aria-label="Diminuir quantidade">
              <Minus className="size-4" />
            </button>
            <span className="num w-6 text-center text-sm" aria-live="polite">
              {state.quantity}
            </span>
            <button type="button" className="grid size-11 place-items-center text-ink-2 disabled:opacity-30" disabled={state.quantity >= 99} onClick={() => setState((s) => ({ ...s, quantity: s.quantity + 1 }))} aria-label="Aumentar quantidade">
              <Plus className="size-4" />
            </button>
          </div>
          <AccentButton
            className="flex-1 justify-between"
            onClick={() => {
              if (!config.result.ok) {
                config.setShowErrors(true);
                // Leva o cliente até o primeiro grupo com problema.
                const first = config.result.errors.find((e) => e.groupId);
                if (first) document.getElementById(`err-${first.groupId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                return;
              }
              onConfirm(config.selection);
            }}
          >
            <span>{editing ? 'Salvar' : 'Adicionar'}</span>
            <span className="num">{formatBRL(config.previewCents)}</span>
          </AccentButton>
        </div>
      }
    >
      <ProductConfigurator product={product} config={config} />
    </Modal>
  );
}

function CartPanel({
  slug,
  store,
  cart,
  onClose,
  onEdit,
}: {
  slug: string;
  store: PublicStore['store'];
  cart: ReturnType<typeof useCart>;
  onClose?: () => void;
  onEdit: (line: CartLineView) => void;
}) {
  const belowMin = store.acceptsDelivery && !store.acceptsPickup && !store.acceptsDineIn && cart.subtotalCents < store.minOrderCents;
  return (
    <div className="flex max-h-[inherit] flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShoppingBag className="size-[18px]" /> Sua sacola
        </h2>
        {onClose && (
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken" aria-label="Fechar sacola">
            <X className="size-[18px]" />
          </button>
        )}
      </div>
      {!cart.ready ? null : cart.lines.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">Sua sacola está vazia. Toque em um produto para adicionar.</p>
      ) : (
        <>
          <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto">
            {cart.lines.map((line) => (
              <li key={line.key} className="px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cx('text-sm font-medium', line.problem && 'text-muted line-through')}>{line.priced?.productName ?? line.product?.name ?? 'Produto'}</p>
                    {line.priced && line.priced.modifiers.length > 0 && (
                      <p className="mt-0.5 text-xs text-muted">{line.priced.modifiers.map((m) => (m.quantity > 1 ? `${m.name} ×${m.quantity}` : m.name)).join(' · ')}</p>
                    )}
                    {line.selection.notes && <p className="mt-0.5 text-xs italic text-muted">“{line.selection.notes}”</p>}
                    {line.problem && <p className="mt-0.5 text-xs text-danger">{line.problem}</p>}
                  </div>
                  <span className="num shrink-0 text-sm">{line.priced ? formatBRL(line.priced.totalCents) : '—'}</span>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <button type="button" className="grid size-8 place-items-center rounded-full border border-line-strong text-ink-2" onClick={() => cart.setQuantity(line.key, line.selection.quantity - 1)} aria-label="Diminuir quantidade">
                    {line.selection.quantity === 1 ? <Trash2 className="size-3.5" /> : <Minus className="size-3.5" />}
                  </button>
                  <span className="num w-7 text-center text-sm">{line.selection.quantity}</span>
                  <button type="button" className="grid size-8 place-items-center rounded-full border border-line-strong text-ink-2 disabled:opacity-30" disabled={line.selection.quantity >= 99 || !!line.problem} onClick={() => cart.setQuantity(line.key, line.selection.quantity + 1)} aria-label="Aumentar quantidade">
                    <Plus className="size-3.5" />
                  </button>
                  {line.product && (
                    <button type="button" className="ml-2 text-xs font-medium text-[var(--accent)] hover:underline" onClick={() => onEdit(line)}>
                      Editar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="space-y-1.5 border-t border-line px-5 py-4 text-sm">
            {cart.hasProblems && (
              <p className="mb-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
                Alguns itens mudaram no cardápio.{' '}
                <button type="button" className="font-semibold underline" onClick={cart.removeInvalid}>
                  Remover indisponíveis
                </button>
              </p>
            )}
            <div className="flex justify-between">
              <span className="text-muted">Subtotal</span>
              <span className="num">{formatBRL(cart.subtotalCents)}</span>
            </div>
            {store.acceptsDelivery && (
              <div className="flex justify-between text-muted">
                <span>Entrega (se escolher)</span>
                <span className="num">{deliveryFeeHint(store, cart.subtotalCents)}</span>
              </div>
            )}
            {belowMin && <p className="text-xs text-warn">Pedido mínimo de {formatBRL(store.minOrderCents)}.</p>}
          </div>
          <div className="px-5 pb-5">
            {cart.hasProblems ? (
              <AccentButton disabled className="w-full">
                Revise a sacola
              </AccentButton>
            ) : (
              <Link
                href={`/${slug}/finalizar`}
                className="flex h-12 w-full items-center justify-between rounded-lg bg-[var(--accent)] px-5 text-[0.9375rem] font-semibold text-[color:var(--accent-ink,#fff)] transition-colors hover:bg-[var(--accent-strong)]"
              >
                <span>Continuar</span>
                <span className="num">{formatBRL(cart.subtotalCents)}</span>
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
