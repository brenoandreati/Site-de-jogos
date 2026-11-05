'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MapPin, MessageCircle, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import {
  COURIER_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  courierSchema,
  deliveryZoneSchema,
  formatBRL,
  formatPhone,
  hasAccess,
  whatsappLink,
  type CourierStatus,
  type DeliveryStatus,
  type OrderStatus,
  type PaymentMethod,
} from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyInput, PhoneInput, Segmented, Select, Switch } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Badge, EmptyState, ErrorNotice, PageHeader, Skeleton } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { del, errorMessage, get, patch, post, put } from '@/lib/api';
import { cx, elapsed, formatAddress, formatTime } from '@/lib/format';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { keys } from '@/lib/queries';
import type { Address, TeamMember } from '@/lib/types';

interface DeliveryRow {
  orderId: string;
  number: number;
  orderStatus: OrderStatus;
  status: DeliveryStatus;
  customerName: string;
  customerPhone: string | null;
  address: Address | null;
  zoneName: string | null;
  totalCents: number;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  changeForCents: number | null;
  notes: string | null;
  courierId: string | null;
  courierName: string | null;
  problemReason: string | null;
  createdAt: string;
  readyAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
}
interface Courier {
  id: string;
  name: string;
  phone: string;
  status: CourierStatus;
  isActive: boolean;
  userId: string | null;
}
interface Zone {
  id: string;
  name: string;
  feeCents: number;
  minOrderCents: number | null;
  etaMinutes: number | null;
  isActive: boolean;
}

export default function DeliveryPage() {
  const { me } = useAdmin();
  const perms = me.active!.permissions;
  const isCourier = me.active!.role === 'courier';
  const canManage = hasAccess(perms, 'delivery', 'manage');
  const [tab, setTab] = useState<'board' | 'couriers' | 'zones'>('board');

  return (
    <div>
      <PageHeader
        title={isCourier ? 'Minhas entregas' : 'Entregas'}
        actions={
          canManage && !isCourier ? (
            <Segmented
              aria-label="Seção"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'board', label: 'Painel' },
                { value: 'couriers', label: 'Entregadores' },
                { value: 'zones', label: 'Bairros e taxas' },
              ]}
            />
          ) : undefined
        }
      />
      {tab === 'board' && <Board isCourier={isCourier} />}
      {tab === 'couriers' && <Couriers />}
      {tab === 'zones' && <Zones />}
    </div>
  );
}

function useBoardData() {
  const { realtime } = useAdmin();
  return useQuery({
    queryKey: keys.delivery,
    queryFn: ({ signal }) => get<{ deliveries: DeliveryRow[]; couriers: Courier[]; courierProfile: { id: string; name: string } | null }>('/delivery/board', signal),
    refetchInterval: realtime === 'online' ? false : 20_000,
  });
}

function Board({ isCourier }: { isCourier: boolean }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const { openOrder } = useAdmin();
  const board = useBoardData();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['delivery'] });
  const act = useMutation({
    mutationFn: ({ path, body }: { orderId: string; path: string; body?: unknown }) => post(path, body),
    onSuccess: refresh,
    onError: (e) => {
      toast(errorMessage(e), 'error');
      refresh();
    },
  });
  const setOwnStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CourierStatus }) => patch(`/delivery/couriers/${id}/status`, { status }),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const busy = (orderId: string) => act.isPending && act.variables?.orderId === orderId;

  if (board.isLoading) return <Skeleton className="h-72" />;
  if (board.error) return <ErrorNotice message={board.error.message} onRetry={() => void board.refetch()} />;
  const data = board.data!;
  if (isCourier && !data.courierProfile) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <EmptyState icon={<UserRound className="size-5" />} title="Seu usuário ainda não está ligado a um cadastro de entregador" description="Peça para a loja vincular seu acesso em Entregas › Entregadores." />
      </div>
    );
  }

  const active = data.deliveries.filter((d) => !['delivered', 'canceled'].includes(d.status));
  const finished = data.deliveries.filter((d) => ['delivered', 'canceled'].includes(d.status));
  const groups: { key: string; title: string; rows: DeliveryRow[] }[] = [
    { key: 'problem', title: 'Com problema', rows: active.filter((d) => d.status === 'problem') },
    { key: 'awaiting', title: 'Aguardando entregador', rows: active.filter((d) => d.status === 'awaiting_courier') },
    { key: 'assigned', title: 'Com entregador', rows: active.filter((d) => d.status === 'assigned') },
    { key: 'route', title: 'Em rota', rows: active.filter((d) => d.status === 'out_for_delivery') },
  ].filter((g) => g.rows.length > 0 || g.key !== 'problem');

  const reportProblem = async (d: DeliveryRow) => {
    const r = await confirm({
      title: `Problema na entrega #${d.number}`,
      confirmLabel: 'Registrar problema',
      tone: 'danger',
      reason: { label: 'O que aconteceu?', required: true, suggestions: ['Cliente não atende', 'Endereço não encontrado', 'Pagamento recusado na entrega', 'Acidente ou pneu furado'] },
    });
    if (r.confirmed) act.mutate({ orderId: d.orderId, path: `/delivery/orders/${d.orderId}/problem`, body: { reason: r.reason } });
  };

  const own = isCourier ? data.couriers.find((c) => c.id === data.courierProfile?.id) : undefined;

  return (
    <div className="space-y-8">
      {own && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
          <p className="flex-1 text-sm">
            <span className="font-medium">{own.name}</span>, sua situação para a loja:
          </p>
          <Segmented
            size="sm"
            aria-label="Sua situação"
            value={own.status}
            onChange={(status) => setOwnStatus.mutate({ id: own.id, status })}
            options={(['available', 'busy', 'offline'] as CourierStatus[]).map((s) => ({ value: s, label: COURIER_STATUS_LABELS[s] }))}
          />
        </div>
      )}
      {!isCourier && (
        <div className="flex flex-wrap gap-2">
          {data.couriers.filter((c) => c.isActive).map((c) => (
            <Badge key={c.id} tone={c.status === 'available' ? 'brand' : c.status === 'busy' ? 'info' : 'neutral'} dot>
              {c.name} · {COURIER_STATUS_LABELS[c.status].toLowerCase()}
            </Badge>
          ))}
          {data.couriers.length === 0 && <p className="text-sm text-muted">Cadastre os entregadores na aba Entregadores para atribuir as entregas.</p>}
        </div>
      )}
      {active.length === 0 && (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface">
          <EmptyState title="Nenhuma entrega em andamento" description={isCourier ? 'Quando a loja atribuir uma entrega a você, ela aparece aqui.' : 'Pedidos de entrega confirmados aparecem aqui.'} />
        </div>
      )}
      {groups.map((g) =>
        g.rows.length === 0 ? null : (
          <section key={g.key} aria-labelledby={`g-${g.key}`}>
            <h2 id={`g-${g.key}`} className="mb-3 flex items-center gap-2 text-[0.8125rem] font-semibold text-ink-2">
              {g.key === 'problem' && <AlertTriangle className="size-4 text-danger" />}
              {g.title} <span className="num rounded-full bg-sunken px-2 py-0.5 text-[0.6875rem] text-muted">{g.rows.length}</span>
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.rows.map((d) => (
                <article key={d.orderId} className={cx('flex flex-col rounded-lg border bg-surface p-4', d.status === 'problem' ? 'border-danger/40' : 'border-line')}>
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => !isCourier && openOrder(d.orderId)} className="text-left">
                      <span className="num text-xl font-semibold tracking-[-0.04em]">#{d.number}</span>
                      <span className="ml-2 text-sm font-medium">{d.customerName}</span>
                    </button>
                    <Badge tone={d.status === 'problem' ? 'danger' : d.status === 'out_for_delivery' ? 'info' : 'neutral'}>{DELIVERY_STATUS_LABELS[d.status]}</Badge>
                  </div>
                  {d.address && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(d.address))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex gap-1.5 text-sm text-ink-2 hover:text-ink"
                    >
                      <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
                      <span>
                        {formatAddress(d.address)}
                        {d.address.reference && <span className="block text-xs text-muted">Ref.: {d.address.reference}</span>}
                      </span>
                    </a>
                  )}
                  <p className="mt-2 text-sm">
                    <span className="num font-medium">{formatBRL(d.totalCents)}</span> · {PAYMENT_METHOD_LABELS[d.paymentMethod]}
                    {d.paymentStatus === 'paid' ? <span className="text-brand"> · pago</span> : <span className="text-warn"> · cobrar na entrega</span>}
                    {d.paymentMethod === 'cash' && d.changeForCents !== null && <span className="block text-xs text-muted">Levar troco de {formatBRL(d.changeForCents - d.totalCents)} (nota de {formatBRL(d.changeForCents)})</span>}
                  </p>
                  {d.notes && <p className="mt-2 rounded bg-warn-soft px-2 py-1 text-xs text-warn">Obs.: {d.notes}</p>}
                  {d.problemReason && <p className="mt-2 rounded bg-danger-soft px-2 py-1 text-xs text-danger">Problema: {d.problemReason}</p>}
                  <p className="mt-2 text-xs text-muted">
                    {d.dispatchedAt ? `Saiu às ${formatTime(d.dispatchedAt)} · ${elapsed(d.dispatchedAt, now)} em rota` : d.orderStatus === 'ready' ? 'Pronto, aguardando saída' : 'Em preparo na cozinha'}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    {!isCourier && d.status !== 'out_for_delivery' && (
                      <Select
                        aria-label={`Entregador do pedido ${d.number}`}
                        className="h-9 w-auto flex-1 text-sm"
                        value={d.courierId ?? ''}
                        onChange={(e) => act.mutate({ orderId: d.orderId, path: `/delivery/orders/${d.orderId}/assign`, body: { courierId: e.target.value || null } })}
                      >
                        <option value="">Sem entregador</option>
                        {data.couriers.filter((c) => c.isActive).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    )}
                    {d.status === 'out_for_delivery' || (d.status === 'problem' && d.dispatchedAt) ? (
                      <Button size="sm" loading={busy(d.orderId)} onClick={() => act.mutate({ orderId: d.orderId, path: `/delivery/orders/${d.orderId}/delivered` })}>
                        Entregue
                      </Button>
                    ) : (
                      <Button size="sm" loading={busy(d.orderId)} disabled={!d.courierId || d.orderStatus !== 'ready'} title={d.orderStatus !== 'ready' ? 'Aguardando a cozinha' : undefined} onClick={() => act.mutate({ orderId: d.orderId, path: `/delivery/orders/${d.orderId}/dispatch` })}>
                        Saiu para entrega
                      </Button>
                    )}
                    {d.status === 'problem' ? (
                      <Button size="sm" variant="secondary" onClick={() => act.mutate({ orderId: d.orderId, path: `/delivery/orders/${d.orderId}/resolve` })}>
                        Resolvido
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => void reportProblem(d)}>
                        Problema
                      </Button>
                    )}
                    {d.customerPhone && (
                      <a href={whatsappLink(d.customerPhone)} target="_blank" rel="noopener noreferrer" className="ml-auto grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink" aria-label={`Conversar com ${d.customerName}`}>
                        <MessageCircle className="size-4" />
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ),
      )}

      {finished.length > 0 && (
        <section>
          <h2 className="mb-3 text-[0.8125rem] font-semibold text-ink-2">Finalizadas nas últimas 12 horas</h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
            {finished.map((d) => (
              <li key={d.orderId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="num font-medium">#{d.number}</span>
                <span className="flex-1">{d.customerName}</span>
                <span className="text-muted">{d.courierName ?? '—'}</span>
                <span className="text-xs text-muted">{d.deliveredAt ? `entregue às ${formatTime(d.deliveredAt)}` : DELIVERY_STATUS_LABELS[d.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Couriers() {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const board = useBoardData();
  const team = useQuery({ queryKey: keys.team, queryFn: ({ signal }) => get<{ members: TeamMember[] }>('/team', signal) });
  const [editing, setEditing] = useState<Courier | 'new' | null>(null);
  const [history, setHistory] = useState<Courier | null>(null);
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CourierStatus }) => patch(`/delivery/couriers/${id}/status`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['delivery'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (board.isLoading) return <Skeleton className="h-60" />;
  const couriers = board.data?.couriers ?? [];
  const courierMembers = (team.data?.members ?? []).filter((m) => m.role === 'courier' && m.status === 'active');

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
          Novo entregador
        </Button>
      </div>
      {couriers.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<UserRound className="size-5" />} title="Nenhum entregador cadastrado" description="Cadastre quem faz as entregas. Se a pessoa tiver acesso ao painel com a função Entregador, vincule o acesso para ela ver as próprias entregas no celular." />
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {couriers.map((c) => (
            <li key={c.id} className={cx('flex flex-wrap items-center gap-3 px-4 py-3', !c.isActive && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.name} {!c.isActive && <span className="text-xs font-normal text-muted">(inativo)</span>}
                </p>
                <p className="text-xs text-muted">
                  {formatPhone(c.phone)}
                  {c.userId && ' · acesso ao painel vinculado'}
                </p>
              </div>
              <Segmented
                size="sm"
                aria-label={`Situação de ${c.name}`}
                value={c.status}
                onChange={(status) => setStatus.mutate({ id: c.id, status })}
                options={(['available', 'busy', 'offline'] as CourierStatus[]).map((s) => ({ value: s, label: COURIER_STATUS_LABELS[s], disabled: !c.isActive }))}
              />
              <Button variant="ghost" size="sm" onClick={() => setHistory(c)}>
                Histórico
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Editar ${c.name}`} onClick={() => setEditing(c)}>
                <Pencil className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && <CourierModal courier={editing === 'new' ? null : editing} members={courierMembers} onClose={() => setEditing(null)} />}
      {history && <CourierHistory courier={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function CourierModal({ courier, members, onClose }: { courier: Courier | null; members: TeamMember[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({ name: courier?.name ?? '', phone: courier ? formatPhone(courier.phone) : '', isActive: courier?.isActive ?? true, userId: courier?.userId ?? '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: (body: unknown) => (courier ? put(`/delivery/couriers/${courier.id}`, body) : post('/delivery/couriers', body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['delivery'] });
      toast(courier ? 'Entregador salvo.' : 'Entregador cadastrado.');
      onClose();
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });
  const submit = () => {
    const body = { ...form, userId: form.userId || null };
    const v = validate(courierSchema, body);
    setErrors(v.ok ? {} : v.errors);
    if (v.ok) save.mutate(body);
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={courier ? 'Editar entregador' : 'Novo entregador'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4 pt-1">
        {save.error && !Object.keys(serverFieldErrors(save.error)).length && <ErrorNotice message={save.error.message} />}
        <Field label="Nome" htmlFor="c-name" error={errors.name}>
          <Input id="c-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errors.name} />
        </Field>
        <Field label="Telefone" htmlFor="c-phone" error={errors.phone}>
          <PhoneInput id="c-phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} invalid={!!errors.phone} />
        </Field>
        <Field label="Acesso ao painel" htmlFor="c-user" optional hint={members.length ? 'Pessoas da equipe com a função Entregador.' : 'Convide a pessoa em Funcionários com a função Entregador para vincular.'}>
          <Select id="c-user" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
            <option value="">Sem acesso</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} ({m.email})
              </option>
            ))}
          </Select>
        </Field>
        <Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Ativo" />
      </div>
    </Modal>
  );
}

function CourierHistory({ courier, onClose }: { courier: Courier; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['delivery', 'history', courier.id],
    queryFn: ({ signal }) => get<{ deliveries: { number: number; customerName: string; zoneName: string | null; status: DeliveryStatus; dispatchedAt: string; deliveredAt: string | null; totalCents: number }[] }>(`/delivery/couriers/${courier.id}/history`, signal),
  });
  return (
    <Modal open onClose={onClose} side="right" size="md" title={`Entregas de ${courier.name}`} description="As 50 mais recentes.">
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.data?.deliveries.length ? (
        <ul className="divide-y divide-line text-sm">
          {q.data.deliveries.map((d) => (
            <li key={`${d.number}-${d.dispatchedAt}`} className="flex items-center gap-3 py-2.5">
              <span className="num font-medium">#{d.number}</span>
              <span className="min-w-0 flex-1 truncate">
                {d.customerName}
                {d.zoneName && <span className="text-muted"> · {d.zoneName}</span>}
              </span>
              <span className="text-xs text-muted">{d.deliveredAt ? formatTime(d.deliveredAt) : DELIVERY_STATUS_LABELS[d.status]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-muted">Nenhuma entrega registrada ainda.</p>
      )}
    </Modal>
  );
}

function Zones() {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const zones = useQuery({ queryKey: keys.zones, queryFn: ({ signal }) => get<Zone[]>('/delivery/zones', signal) });
  const [editing, setEditing] = useState<Zone | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => del(`/delivery/zones/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.zones });
      toast('Bairro removido.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (zones.isLoading) return <Skeleton className="h-60" />;
  const list = zones.data ?? [];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          Com bairros cadastrados, o cliente escolhe o bairro na finalização e paga a taxa dele. Pedidos para bairros fora da lista não são aceitos. Sem nenhum bairro, vale a taxa única de Configurações.
        </p>
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
          Novo bairro
        </Button>
      </div>
      {list.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<MapPin className="size-5" />} title="Nenhum bairro cadastrado" description="A loja usa a taxa de entrega única definida em Configurações › Pedidos, entrega e pagamento." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">Bairro</th>
                <th className="px-4 py-2.5 text-right font-medium">Taxa</th>
                <th className="px-4 py-2.5 text-right font-medium">Pedido mínimo</th>
                <th className="px-4 py-2.5 text-right font-medium">Tempo de entrega</th>
                <th className="w-24 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((z) => (
                <tr key={z.id} className={cx(!z.isActive && 'text-muted')}>
                  <td className="px-4 py-2.5">
                    {z.name} {!z.isActive && <Badge className="ml-2">Pausado</Badge>}
                  </td>
                  <td className="num px-4 py-2.5 text-right">{z.feeCents ? formatBRL(z.feeCents) : 'Grátis'}</td>
                  <td className="num px-4 py-2.5 text-right">{z.minOrderCents ? formatBRL(z.minOrderCents) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular">{z.etaMinutes ? `${z.etaMinutes} min` : 'padrão'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" size="icon-sm" aria-label={`Editar ${z.name}`} onClick={() => setEditing(z)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remover ${z.name}`}
                      onClick={async () => {
                        const r = await confirm({ title: `Remover o bairro ${z.name}?`, description: 'Pedidos já feitos não mudam. Novos pedidos para esse bairro deixam de ser aceitos.', confirmLabel: 'Remover', tone: 'danger' });
                        if (r.confirmed) remove.mutate(z.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ZoneModal zone={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ZoneModal({ zone, onClose }: { zone: Zone | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({ name: zone?.name ?? '', feeCents: zone?.feeCents ?? (null as number | null), minOrderCents: zone?.minOrderCents ?? (null as number | null), etaMinutes: zone?.etaMinutes ?? (null as number | null), isActive: zone?.isActive ?? true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: (body: unknown) => (zone ? put(`/delivery/zones/${zone.id}`, body) : post('/delivery/zones', body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.zones });
      toast(zone ? 'Bairro salvo.' : 'Bairro cadastrado.');
      onClose();
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });
  const submit = () => {
    const body = { ...form, feeCents: form.feeCents ?? undefined };
    const v = validate(deliveryZoneSchema, body);
    setErrors(v.ok ? {} : v.errors);
    if (v.ok) save.mutate(body);
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={zone ? 'Editar bairro' : 'Novo bairro'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4 pt-1">
        <Field label="Bairro ou região" htmlFor="z-name" error={errors.name}>
          <Input id="z-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errors.name} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Taxa de entrega" htmlFor="z-fee" error={errors.feeCents}>
            <MoneyInput id="z-fee" value={form.feeCents} onChange={(v) => setForm({ ...form, feeCents: v })} allowEmpty invalid={!!errors.feeCents} />
          </Field>
          <Field label="Pedido mínimo" htmlFor="z-min" optional>
            <MoneyInput id="z-min" value={form.minOrderCents} onChange={(v) => setForm({ ...form, minOrderCents: v })} allowEmpty />
          </Field>
        </div>
        <Field label="Tempo de entrega (min)" htmlFor="z-eta" optional hint="Somado ao tempo de preparo. Vazio usa o tempo padrão da loja.">
          <Input id="z-eta" type="number" min={0} max={240} className="num" value={form.etaMinutes ?? ''} onChange={(e) => setForm({ ...form, etaMinutes: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))) })} />
        </Field>
        <Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Atendendo este bairro" />
      </div>
    </Modal>
  );
}
