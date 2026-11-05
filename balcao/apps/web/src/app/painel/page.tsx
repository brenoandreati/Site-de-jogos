'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Check, Copy, ExternalLink, Minus } from 'lucide-react';
import {
  FULFILLMENT_LABELS,
  ORDER_CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  formatBRL,
  hasAccess,
} from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { ChartLegend, RankedBars, TimeChart, type TimePoint } from '@/components/dashboard/charts';
import { Button, ButtonLink } from '@/components/ui/button';
import { Input, Segmented } from '@/components/ui/field';
import { ErrorNotice, Panel, Skeleton } from '@/components/ui/misc';
import { get } from '@/lib/api';
import { cx, formatDateTime, pct, timeAgo } from '@/lib/format';
import { keys, useCatalog, useSettings } from '@/lib/queries';
import type { Dashboard } from '@/lib/types';

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

function todayIn(tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function shift(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function rangeFor(preset: Preset, tz: string, custom: { from: string; to: string }) {
  const today = todayIn(tz);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: shift(today, -1), to: shift(today, -1) };
    case '7d':
      return { from: shift(today, -6), to: today };
    case '30d':
      return { from: shift(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'custom':
      return custom.from && custom.to && custom.from <= custom.to ? custom : { from: today, to: today };
  }
}

const PREVIOUS_LABEL: Record<Preset, string> = {
  today: 'ontem',
  yesterday: 'anteontem',
  '7d': '7 dias anteriores',
  '30d': '30 dias anteriores',
  month: 'mesmo período antes',
  custom: 'período anterior',
};

const compactBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const { me } = useAdmin();
  const router = useRouter();
  const perms = me.active!.permissions;
  const allowed = hasAccess(perms, 'dashboard', 'view');

  useEffect(() => {
    if (!allowed && hasAccess(perms, 'orders', 'view')) router.replace('/painel/pedidos');
  }, [allowed, perms, router]);

  if (!allowed) {
    return hasAccess(perms, 'orders', 'view') ? null : (
      <ErrorNotice message="Seu acesso não inclui a visão geral. Use o menu para abrir os módulos liberados para você." />
    );
  }
  return <DashboardView />;
}

function DashboardView() {
  const { me, openOrder } = useAdmin();
  const params = useSearchParams();
  const settings = useSettings();
  const tz = settings.data?.branch.timezone ?? 'America/Sao_Paulo';
  const [preset, setPreset] = useState<Preset>('today');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [metric, setMetric] = useState<'revenue' | 'orders' | 'ticket'>('revenue');
  const [topBy, setTopBy] = useState<'quantity' | 'revenue'>('quantity');
  const range = rangeFor(preset, tz, custom);
  const qs = `from=${range.from}&to=${range.to}`;

  const dash = useQuery({
    queryKey: keys.dashboard(qs),
    queryFn: ({ signal }) => get<Dashboard>(`/dashboard?${qs}`, signal),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
    enabled: !!settings.data,
  });

  const d = dash.data;
  const points: TimePoint[] = useMemo(() => {
    if (!d) return [];
    return d.series.map((s) => {
      const daily = d.period.granularity === 'day';
      const label = daily ? `${s.bucket.slice(8, 10)}/${s.bucket.slice(5, 7)}` : s.bucket;
      const fullLabel = daily ? `${label} · ${WEEKDAY.format(new Date(`${s.bucket}T12:00:00Z`))}` : `${s.bucket.replace('h', ':00')} às ${s.bucket.replace('h', ':59')}`;
      const value = metric === 'revenue' ? s.revenueCents : metric === 'orders' ? s.orders : s.averageTicketCents;
      return { label, fullLabel, value, previous: metric === 'revenue' ? s.previousRevenueCents : undefined };
    });
  }, [d, metric]);

  return (
    <div className={cx('space-y-6 transition-opacity', dash.isFetching && dash.data && 'opacity-70')}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.015em]">Olá, {me.user.name.split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-muted">{settings.data ? settings.data.availability.isOpen ? 'A loja está aberta e recebendo pedidos.' : 'A loja está fechada para pedidos no cardápio agora.' : ' '}</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <div className="scrollbar-none -mx-4 max-w-[100vw] overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Segmented
            size="sm"
            aria-label="Período"
            value={preset}
            onChange={setPreset}
            options={[
              { value: 'today', label: 'Hoje' },
              { value: 'yesterday', label: 'Ontem' },
              { value: '7d', label: '7 dias' },
              { value: '30d', label: '30 dias' },
              { value: 'month', label: 'Este mês' },
              { value: 'custom', label: 'Personalizado' },
            ]}
          />
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <Input type="date" aria-label="Data inicial" className="num h-8 w-[150px] text-xs" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              <span className="text-xs text-muted">a</span>
              <Input type="date" aria-label="Data final" className="num h-8 w-[150px] text-xs" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </div>
          )}
        </div>
      </div>

      <Onboarding force={params.has('primeiros-passos') || params.has('bem-vindo')} />

      {dash.error && <ErrorNotice message={dash.error.message} onRetry={() => void dash.refetch()} />}
      {!d ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40 lg:col-span-1" />
          <Skeleton className="h-40 lg:col-span-2" />
          <Skeleton className="h-72 lg:col-span-3" />
        </div>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]" aria-label="Indicadores do período">
            <div className="rounded-lg border border-line bg-surface p-5">
              <p className="text-[0.8125rem] text-muted">Faturamento</p>
              <p className="mt-2 text-[3rem] font-semibold leading-none tracking-[-0.035em]">{formatBRL(d.current.revenueCents)}</p>
              <Delta current={d.current.revenueCents} previous={d.previous.revenueCents} label={PREVIOUS_LABEL[preset]} />
              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[0.8125rem]">
                <div>
                  <dt className="text-muted">Hoje</dt>
                  <dd className="num mt-0.5 text-ink">{formatBRL(d.revenueTodayCents)}</dd>
                </div>
                <div>
                  <dt className="text-muted">No mês</dt>
                  <dd className="num mt-0.5 text-ink">{formatBRL(d.revenueMonthCents)}</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs leading-relaxed text-faint">Valor bruto dos pedidos aceitos (confirmados em diante). Não é lucro: custos e taxas entram no módulo Financeiro.</p>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
              <Tile label="Pedidos aceitos" value={String(d.current.accepted)} sub={`${d.current.orders} recebidos`} current={d.current.accepted} previous={d.previous.accepted} />
              <Tile label="Ticket médio" value={formatBRL(d.current.averageTicketCents)} current={d.current.averageTicketCents} previous={d.previous.averageTicketCents} />
              <Tile label="Concluídos" value={String(d.current.completed)} current={d.current.completed} previous={d.previous.completed} />
              <Tile label="Clientes novos" value={String(d.current.newCustomers)} current={d.current.newCustomers} previous={d.previous.newCustomers} />
              <Tile label="Clientes que voltaram" value={String(d.current.returningCustomers)} current={d.current.returningCustomers} previous={d.previous.returningCustomers} />
              <Tile label="Cancelados" value={String(d.current.canceled)} current={d.current.canceled} previous={d.previous.canceled} upIsBad />
            </div>
          </section>

          <LiveStrip live={d.live} />

          <Panel
            title={metric === 'revenue' ? 'Faturamento' : metric === 'orders' ? 'Pedidos recebidos' : 'Ticket médio'}
            description={d.period.granularity === 'hour' ? 'Por hora do dia' : 'Por dia'}
            actions={
              <Segmented
                size="sm"
                aria-label="Métrica do gráfico"
                value={metric}
                onChange={setMetric}
                options={[
                  { value: 'revenue', label: 'Faturamento' },
                  { value: 'orders', label: 'Pedidos' },
                  { value: 'ticket', label: 'Ticket médio' },
                ]}
              />
            }
          >
            {metric === 'revenue' && (
              <div className="mb-3">
                <ChartLegend items={[{ label: 'Período escolhido', tone: 'chart' }, { label: `Comparação: ${PREVIOUS_LABEL[preset]}`, tone: 'muted' }]} />
              </div>
            )}
            <TimeChart
              points={points}
              kind={metric === 'orders' ? 'column' : 'line'}
              format={(v) => (metric === 'orders' ? `${v} ${v === 1 ? 'pedido' : 'pedidos'}` : formatBRL(v))}
              formatAxis={(v) => (metric === 'orders' ? String(Math.round(v)) : compactBRL.format(v / 100))}
              seriesLabel={metric === 'revenue' ? 'faturamento' : metric === 'orders' ? 'pedidos' : 'ticket médio'}
              previousLabel={metric === 'revenue' ? PREVIOUS_LABEL[preset] : undefined}
            />
            <SeriesTable points={points} metric={metric} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Produtos mais vendidos"
              actions={
                <Segmented
                  size="sm"
                  aria-label="Ordenar produtos"
                  value={topBy}
                  onChange={setTopBy}
                  options={[
                    { value: 'quantity', label: 'Quantidade' },
                    { value: 'revenue', label: 'Faturamento' },
                  ]}
                />
              }
            >
              <RankedBars
                rows={(topBy === 'quantity' ? d.topProducts : d.topByRevenue).map((p) => ({ label: p.name, value: topBy === 'quantity' ? p.quantity : p.revenue, hint: String(p.quantity) }))}
                format={(v) => (topBy === 'quantity' ? `${v} un.` : formatBRL(v))}
                secondary={(r) => {
                  const p = (topBy === 'quantity' ? d.topProducts : d.topByRevenue).find((x) => x.name === r.label);
                  return p ? (topBy === 'quantity' ? formatBRL(p.revenue) : `${p.quantity} un.`) : undefined;
                }}
              />
            </Panel>
            <Panel title="Vendas por categoria" description="Valor dos produtos, sem taxa de entrega">
              <RankedBars rows={d.byCategory.map((c) => ({ label: c.name, value: c.revenue }))} format={formatBRL} />
            </Panel>
            <Panel title="Formas de pagamento">
              <RankedBars
                rows={d.byPayment.map((p) => ({ label: PAYMENT_METHOD_LABELS[p.key], value: p.revenue, hint: String(p.orders) }))}
                format={formatBRL}
                secondary={(r) => `${r.hint} ped.`}
              />
            </Panel>
            <Panel title="Canais e atendimento">
              <div className="space-y-6">
                <RankedBars rows={d.byChannel.map((p) => ({ label: ORDER_CHANNEL_LABELS[p.key], value: p.revenue, hint: String(p.orders) }))} format={formatBRL} secondary={(r) => `${r.hint} ped.`} />
                {d.byFulfillment.length > 0 && (
                  <div className="border-t border-line pt-5">
                    <RankedBars rows={d.byFulfillment.map((p) => ({ label: FULFILLMENT_LABELS[p.key], value: p.revenue, hint: String(p.orders) }))} format={formatBRL} secondary={(r) => `${r.hint} ped.`} />
                  </div>
                )}
              </div>
            </Panel>
          </div>

          <Panel title="Atividade recente" bodyClassName="p-0">
            {d.activity.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">As movimentações da loja aparecem aqui.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.activity.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                    <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', a.kind === 'order' ? (a.toStatus === 'canceled' ? 'bg-danger' : a.type === 'created' ? 'bg-brand' : 'bg-line-strong') : 'bg-info')} aria-hidden="true" />
                    <div className="min-w-0 flex-1 text-sm">
                      {a.kind === 'order' ? (
                        <button type="button" className="text-left hover:underline" onClick={() => openOrder(a.orderId)}>
                          <span className="num font-medium">#{a.orderNumber}</span>{' '}
                          {a.type === 'created' || a.type === 'duplicated_from'
                            ? `novo pedido de ${a.customerName} · ${formatBRL(a.totalCents)}`
                            : a.type === 'status_changed'
                              ? `${ORDER_STATUS_LABELS[a.toStatus!].toLowerCase()}${a.toStatus === 'canceled' && a.data.reason ? ` — ${String(a.data.reason)}` : ''}`
                              : a.type === 'discount_applied'
                                ? `desconto de ${formatBRL(Number(a.data.discountCents))}`
                                : 'itens alterados'}
                        </button>
                      ) : (
                        <span>{a.summary ?? a.action}</span>
                      )}
                      <p className="text-xs text-muted">
                        <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                          {timeAgo(a.createdAt)}
                        </time>
                        {a.actorName && a.kind === 'change' && ` · ${a.actorName}`}
                        {a.kind === 'order' && a.actorName && a.actorType === 'user' && ` · ${a.actorName}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function Delta({ current, previous, label, upIsBad }: { current: number; previous: number; label: string; upIsBad?: boolean }) {
  const p = pct(current, previous);
  if (p === null) return <p className="mt-2 text-xs text-muted">Sem base de comparação ({label})</p>;
  const flat = Math.abs(p) < 0.5;
  const good = flat ? null : (p > 0) !== !!upIsBad;
  const Icon = flat ? Minus : p > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cx('mt-2 flex items-center gap-1 text-xs', good === null ? 'text-muted' : good ? 'text-brand' : 'text-danger')}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="tabular font-medium">
        {flat ? 'estável' : `${p > 0 ? '+' : '−'}${Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
      </span>
      <span className="text-muted">vs. {label}</span>
    </p>
  );
}

function Tile({ label, value, sub, current, previous, upIsBad }: { label: string; value: string; sub?: string; current: number; previous: number; upIsBad?: boolean }) {
  const p = pct(current, previous);
  const flat = p === null || Math.abs(p) < 0.5;
  const good = flat ? null : (p! > 0) !== !!upIsBad;
  return (
    <div className="bg-surface p-4">
      <p className="text-[0.8125rem] text-muted">{label}</p>
      <p className="mt-1.5 text-[1.5rem] font-semibold leading-tight tracking-[-0.02em]">{value}</p>
      <p className="mt-1 flex items-center gap-1.5 text-xs">
        {p !== null && !flat && (
          <span className={cx('tabular font-medium', good ? 'text-brand' : 'text-danger')}>
            {p > 0 ? '↑' : '↓'} {Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
          </span>
        )}
        {sub && <span className="text-muted">{sub}</span>}
      </p>
    </div>
  );
}

function LiveStrip({ live }: { live: Dashboard['live'] }) {
  const items = [
    { label: 'Aguardando confirmação', value: (live.new ?? 0) + (live.awaiting_confirmation ?? 0), attention: true },
    { label: 'Em produção', value: (live.confirmed ?? 0) + (live.preparing ?? 0) },
    { label: 'Prontos', value: live.ready ?? 0 },
    { label: 'Em entrega', value: live.out_for_delivery ?? 0 },
  ];
  return (
    <section aria-label="Pedidos agora" className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line bg-surface px-5 py-3.5">
      <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-faint">Agora</span>
      {items.map((i) => (
        <Link key={i.label} href="/painel/pedidos" className="group flex items-baseline gap-2 text-sm">
          <span className={cx('num text-lg font-semibold', i.attention && i.value > 0 ? 'text-brand' : 'text-ink')}>{i.value}</span>
          <span className="text-muted group-hover:text-ink">{i.label}</span>
        </Link>
      ))}
      <Link href="/painel/pedidos" className="ml-auto text-[0.8125rem] font-medium text-brand hover:underline">
        Abrir pedidos
      </Link>
    </section>
  );
}

function SeriesTable({ points, metric }: { points: TimePoint[]; metric: 'revenue' | 'orders' | 'ticket' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button type="button" className="text-xs font-medium text-muted hover:text-ink" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Ocultar tabela' : 'Ver em tabela'}
      </button>
      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-line">
          <table className="w-full text-[0.8125rem]">
            <thead className="sticky top-0 bg-canvas text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Período</th>
                <th className="px-3 py-2 text-right font-medium">{metric === 'orders' ? 'Pedidos' : metric === 'ticket' ? 'Ticket médio' : 'Faturamento'}</th>
                {metric === 'revenue' && <th className="px-3 py-2 text-right font-medium">Comparação</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {points.map((p) => (
                <tr key={p.fullLabel}>
                  <td className="px-3 py-1.5 text-ink-2">{p.fullLabel}</td>
                  <td className="num px-3 py-1.5 text-right">{metric === 'orders' ? p.value : formatBRL(p.value)}</td>
                  {metric === 'revenue' && <td className="num px-3 py-1.5 text-right text-muted">{formatBRL(p.previous ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Primeiros passos: o que falta para a loja receber o primeiro pedido. Some quando tudo está feito. */
function Onboarding({ force }: { force: boolean }) {
  const { me } = useAdmin();
  const settings = useSettings();
  const catalog = useCatalog(hasAccess(me.active!.permissions, 'catalog', 'view'));
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (!settings.data || !catalog.data || dismissed) return null;
  const s = settings.data;
  const productCount = catalog.data.categories.reduce((n, c) => n + c.products.filter((p) => p.isActive).length, 0);
  const steps = [
    { done: !!s.company.logoUrl, label: 'Coloque o logo e a cor da loja', href: '/painel/configuracoes' },
    { done: s.hours.length > 0, label: 'Defina o horário de funcionamento', href: '/painel/configuracoes' },
    { done: productCount > 0, label: 'Cadastre os produtos do cardápio', href: '/painel/cardapio' },
    { done: !!s.branch.address, label: 'Informe o endereço da loja', href: '/painel/configuracoes' },
  ];
  const remaining = steps.filter((x) => !x.done).length;
  if (remaining === 0 && !force) return null;
  const url = typeof window !== 'undefined' ? `${window.location.origin}/${me.active!.tenant.slug}` : `/${me.active!.tenant.slug}`;

  return (
    <section aria-labelledby="onboarding-title" className="rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="onboarding-title" className="font-semibold">
            {remaining === 0 ? 'Tudo pronto para receber pedidos' : 'Primeiros passos'}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {remaining === 0 ? 'Divulgue o link do cardápio no WhatsApp e no Instagram.' : `Faltam ${remaining} ${remaining === 1 ? 'passo' : 'passos'} para a loja ficar pronta.`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          Ocultar
        </Button>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.label}>
            <Link href={step.href} className={cx('flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors', step.done ? 'border-line text-muted' : 'border-line-strong text-ink hover:border-ink/30')}>
              <span className={cx('grid size-5 shrink-0 place-items-center rounded-full border', step.done ? 'border-brand bg-brand text-white' : 'border-line-strong')}>
                {step.done && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className={cx(step.done && 'line-through decoration-line-strong')}>{step.label}</span>
            </Link>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <span className="text-[0.8125rem] text-muted">Link do cardápio:</span>
        <code className="num rounded bg-canvas px-2 py-1 text-xs text-ink">{url}</code>
        <Button
          variant="ghost"
          size="sm"
          icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          onClick={async () => {
            await navigator.clipboard.writeText(url).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
        <ButtonLink href={`/${me.active!.tenant.slug}`} external variant="ghost" size="sm" icon={<ExternalLink className="size-3.5" />}>
          Abrir
        </ButtonLink>
      </div>
    </section>
  );
}
