'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, MessageCircle } from 'lucide-react';
import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_CUSTOMER_LABELS,
  PAYMENT_METHOD_LABELS,
  formatBRL,
  whatsappLink,
  type OrderStatus,
} from '@balcao/shared';
import { ErrorNotice, Skeleton } from '@/components/ui/misc';
import { ApiError, get } from '@/lib/api';
import { cx, formatAddress, formatTime } from '@/lib/format';
import type { Tracking } from '@/lib/types';

export function OrderTracking(props: { slug: string; token: string }) {
  return (
    <Suspense>
      <Inner {...props} />
    </Suspense>
  );
}

function stepsFor(t: Tracking): { status: OrderStatus; label: string }[] {
  const steps: { status: OrderStatus; label: string }[] = [
    { status: 'new', label: 'Pedido enviado' },
    { status: 'confirmed', label: 'Confirmado pela loja' },
    { status: 'preparing', label: 'Em preparo' },
    { status: 'ready', label: t.fulfillment === 'pickup' ? 'Pronto para retirar' : t.fulfillment === 'dine_in' ? 'Pronto' : 'Pronto, aguardando entregador' },
  ];
  if (t.fulfillment === 'delivery') steps.push({ status: 'out_for_delivery', label: 'Saiu para entrega' });
  steps.push({ status: 'completed', label: t.fulfillment === 'delivery' ? 'Entregue' : 'Concluído' });
  return steps;
}

const ORDER: OrderStatus[] = ['new', 'awaiting_confirmation', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed'];

function Inner({ slug, token }: { slug: string; token: string }) {
  const isNew = useSearchParams().has('novo');
  const [copied, setCopied] = useState(false);
  const q = useQuery({
    queryKey: ['tracking', token],
    queryFn: ({ signal }) => get<Tracking>(`/public/orders/${encodeURIComponent(token)}`, signal),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'completed' || s === 'canceled' ? false : 15_000;
    },
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 3,
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-10">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorNotice message={q.error instanceof ApiError && q.error.status === 404 ? 'Pedido não encontrado. Confira o link.' : (q.error?.message ?? 'Erro ao carregar o pedido.')} onRetry={() => void q.refetch()} />
        <Link href={`/${slug}`} className="mt-6 inline-block text-sm font-medium text-[var(--accent)] hover:underline">
          Voltar ao cardápio
        </Link>
      </div>
    );
  }

  const t = q.data;
  const canceled = t.status === 'canceled';
  const steps = stepsFor(t);
  const reachedAt = (s: OrderStatus) => t.timeline.find((e) => e.status === s)?.at ?? null;
  const currentIdx = ORDER.indexOf(t.status === 'awaiting_confirmation' ? 'new' : t.status);
  const eta = new Date(new Date(t.createdAt).getTime() + (t.prepTimeMinutes + t.deliveryTimeMinutes) * 60_000);
  const waText = `Olá! Sobre o meu pedido #${t.number} (${t.customerName}).`;

  return (
    <div className="mx-auto max-w-md px-4 pb-16 pt-6">
      {isNew && !canceled && (
        <p className="mb-4 rounded-lg bg-[var(--accent-soft)] px-4 py-3 text-sm text-ink" role="status">
          Pedido enviado para a loja. Esta página atualiza sozinha a cada etapa.
        </p>
      )}

      {/* A comanda */}
      <article className="ticket-edge rounded-b-xl bg-surface px-6 pb-6 pt-8 shadow-soft" aria-labelledby="ticket-number">
        <div className="flex items-center gap-2.5">
          {t.store.logoUrl ? (
            <img src={t.store.logoUrl} alt="" className="size-8 rounded-md object-cover" />
          ) : (
            <span className="grid size-8 place-items-center rounded-md bg-[var(--accent)] text-sm font-semibold text-[color:var(--accent-ink,#fff)]">{t.store.name.charAt(0)}</span>
          )}
          <span className="text-sm font-medium text-ink-2">{t.store.name}</span>
        </div>

        <p className="mt-6 text-xs uppercase tracking-[0.08em] text-muted">Pedido</p>
        <p id="ticket-number" className="num text-[3.5rem] leading-none font-semibold tracking-[-0.05em]">
          #{t.number}
        </p>
        <h1 className={cx('mt-4 text-xl font-semibold leading-snug tracking-[-0.01em]', canceled && 'text-danger')}>{ORDER_STATUS_CUSTOMER_LABELS[t.status]}</h1>
        {canceled ? (
          t.cancelReason && <p className="mt-1 text-sm text-muted">Motivo: {t.cancelReason}</p>
        ) : t.status !== 'completed' ? (
          <p className="mt-1 text-sm text-muted">
            {FULFILLMENT_LABELS[t.fulfillment]} · previsão por volta das <span className="num text-ink">{formatTime(eta)}</span>
          </p>
        ) : null}

        {!canceled && (
          <ol className="mt-6 space-y-0">
            {steps.map((step, i) => {
              const idx = ORDER.indexOf(step.status);
              const done = idx <= currentIdx;
              const current = idx === currentIdx;
              const at = reachedAt(step.status);
              return (
                <li key={step.status} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < steps.length - 1 && <span className={cx('absolute left-[9px] top-5 h-[calc(100%-12px)] w-px', idx < currentIdx ? 'bg-[var(--accent)]' : 'bg-line')} aria-hidden="true" />}
                  <span
                    className={cx(
                      'relative z-10 mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full border-2',
                      done ? 'border-[var(--accent)] bg-[var(--accent)] text-[color:var(--accent-ink,#fff)]' : 'border-line-strong bg-surface',
                    )}
                  >
                    {done && !current && <Check className="size-3" strokeWidth={3} />}
                    {current && <span className="size-1.5 rounded-full bg-[var(--accent-ink,#fff)]" />}
                  </span>
                  <div className="flex flex-1 items-baseline justify-between gap-3">
                    <span className={cx('text-sm', current ? 'font-semibold text-ink' : done ? 'text-ink-2' : 'text-faint')}>{step.label}</span>
                    {at && done && <span className="num text-xs text-muted">{formatTime(at)}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {t.store.whatsapp && (
          <a
            href={whatsappLink(t.store.whatsapp, waText)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 flex h-11 items-center justify-center gap-2 rounded-lg border border-line-strong text-sm font-medium text-ink hover:bg-canvas"
          >
            <MessageCircle className="size-4" /> Falar com a loja
          </a>
        )}
      </article>

      <section className="mt-4 rounded-xl bg-surface p-6 shadow-soft" aria-labelledby="resumo">
        <h2 id="resumo" className="font-semibold">
          Resumo
        </h2>
        <ul className="mt-3 space-y-2.5 text-sm">
          {t.items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="num mr-1.5 text-xs text-muted">{i.quantity}×</span>
                {i.productName}
                {i.modifiers.length > 0 && <span className="block pl-6 text-xs text-muted">{i.modifiers.map((m) => (m.quantity > 1 ? `${m.name} ×${m.quantity}` : m.name)).join(' · ')}</span>}
                {i.notes && <span className="block pl-6 text-xs italic text-muted">“{i.notes}”</span>}
              </span>
              <span className="num shrink-0">{formatBRL(i.totalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1.5 border-t border-dashed border-line-strong pt-4 text-sm">
          <Row label="Subtotal" value={formatBRL(t.subtotalCents)} />
          {t.discountCents > 0 && <Row label="Desconto" value={`− ${formatBRL(t.discountCents)}`} />}
          {t.fulfillment === 'delivery' && <Row label="Entrega" value={t.deliveryFeeCents ? formatBRL(t.deliveryFeeCents) : 'Grátis'} />}
          <div className="flex items-baseline justify-between pt-1">
            <dt className="font-semibold">Total</dt>
            <dd className="num text-base font-semibold">{formatBRL(t.totalCents)}</dd>
          </div>
        </dl>
        <div className="mt-4 space-y-1 border-t border-line pt-4 text-sm">
          <p>
            <span className="text-muted">Pagamento:</span> {PAYMENT_METHOD_LABELS[t.paymentMethod]}
            {t.paymentStatus === 'paid' && <span className="ml-1 text-[var(--accent)]">· recebido</span>}
          </p>
          {t.paymentMethod === 'cash' && t.changeForCents !== null && (
            <p className="text-muted">
              Troco para <span className="num text-ink">{formatBRL(t.changeForCents)}</span>
            </p>
          )}
          {t.address && (
            <p>
              <span className="text-muted">Entrega em:</span> {formatAddress(t.address)}
            </p>
          )}
          {t.tableNumber && (
            <p>
              <span className="text-muted">Mesa:</span> {t.tableNumber}
            </p>
          )}
        </div>
        {t.store.pix && t.paymentStatus !== 'paid' && !canceled && (
          <div className="mt-4 rounded-md bg-canvas px-4 py-3 text-sm">
            <p className="text-ink-2">Chave PIX da loja</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="num break-all rounded bg-surface px-2 py-1 text-xs">{t.store.pix.key}</code>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]"
                onClick={async () => {
                  await navigator.clipboard.writeText(t.store.pix!.key).catch(() => undefined);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copiada' : 'Copiar'}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted">O pagamento é confirmado pela loja depois de conferir no banco.</p>
          </div>
        )}
      </section>

      <p className="mt-6 text-center">
        <Link href={`/${slug}`} className="text-sm font-medium text-[var(--accent)] hover:underline">
          Voltar ao cardápio
        </Link>
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
