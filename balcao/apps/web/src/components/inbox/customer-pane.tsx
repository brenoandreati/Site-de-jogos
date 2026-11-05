'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, X } from 'lucide-react';
import { ORDER_STATUS_LABELS, customerProfileSchema, formatBRL, formatPhone, hasAccess } from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { put } from '@/lib/api';
import { formatAddress, formatShortDate } from '@/lib/format';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import type { ConversationDetail } from '@/lib/inbox';
import { STATUS_TONE } from '@/lib/orders-ui';

type Customer = NonNullable<ConversationDetail['customer']>;

export function CustomerPane({ customer, conversationId }: { customer: ConversationDetail['customer']; conversationId: string }) {
  if (!customer) {
    return <p className="p-5 text-sm text-muted">Este contato ainda não tem ficha de cliente. Ela é criada com a primeira mensagem ou o primeiro pedido.</p>;
  }
  return <CustomerForm key={customer.id} customer={customer} conversationId={conversationId} />;
}

function CustomerForm({ customer, conversationId }: { customer: Customer; conversationId: string }) {
  const qc = useQueryClient();
  const { me, openOrder } = useAdmin();
  const { toast } = useFeedback();
  const canEdit = hasAccess(me.active!.permissions, 'inbox', 'edit');
  const [form, setForm] = useState({ name: customer.name, notes: customer.notes ?? '', tags: customer.tags });
  const [tag, setTag] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const dirty = form.name !== customer.name || form.notes !== (customer.notes ?? '') || form.tags.join('|') !== customer.tags.join('|');

  const save = useMutation({
    mutationFn: (body: unknown) => put(`/inbox/customers/${customer.id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      toast('Ficha do cliente salva.');
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });

  const addTag = () => {
    const t = tag.trim().toLowerCase().slice(0, 30);
    if (t && !form.tags.includes(t) && form.tags.length < 15) setForm({ ...form, tags: [...form.tags, t] });
    setTag('');
  };

  const submit = () => {
    const body = { name: form.name, notes: form.notes || null, tags: form.tags };
    const v = validate(customerProfileSchema, body);
    setErrors(v.ok ? {} : v.errors);
    if (v.ok) save.mutate(body);
  };

  return (
    <div className="space-y-5 p-5" data-conversation={conversationId}>
      <div>
        <p className="font-semibold">{customer.name}</p>
        <p className="num text-sm text-muted">{formatPhone(customer.phone)}</p>
        <p className="mt-1 text-xs text-muted">
          Cliente desde {formatShortDate(customer.createdAt)} · {customer.marketingOptIn ? 'aceita receber promoções' : 'não aceitou receber promoções'}
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Pedidos" value={String(customer.ordersCount)} />
        <Stat label="Total gasto" value={formatBRL(customer.totalSpentCents)} />
        <Stat label="Ticket médio" value={formatBRL(customer.averageTicketCents)} />
      </dl>

      {customer.address && (
        <p className="flex gap-2 rounded-md bg-canvas px-3 py-2 text-sm text-ink-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
          <span>{formatAddress(customer.address)}</span>
        </p>
      )}

      <section>
        <h3 className="mb-2 text-2xs font-semibold uppercase tracking-[0.08em] text-faint">Últimos pedidos</h3>
        {customer.recentOrders.length === 0 ? (
          <p className="text-sm text-muted">Nenhum pedido ainda.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {customer.recentOrders.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => openOrder(o.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-canvas">
                  <span className="num font-medium">#{o.number}</span>
                  <span className="flex-1 text-xs text-muted">{formatShortDate(o.createdAt)}</span>
                  <Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                  <span className="num w-20 text-right">{formatBRL(o.totalCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        className="space-y-4 border-t border-line pt-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Nome" htmlFor="cp-name" error={errors.name}>
          <Input id="cp-name" value={form.name} disabled={!canEdit} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errors.name} />
        </Field>
        <Field label="Etiquetas" htmlFor="cp-tag" optional hint="Enter para adicionar. Ex.: vip, sem cebola, empresa.">
          {form.tags.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {form.tags.map((t) => (
                <li key={t} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs">
                  {t}
                  {canEdit && (
                    <button type="button" onClick={() => setForm({ ...form, tags: form.tags.filter((x) => x !== t) })} aria-label={`Remover etiqueta ${t}`} className="text-muted hover:text-ink">
                      <X className="size-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <Input
              id="cp-tag"
              value={tag}
              maxLength={30}
              onChange={(e) => setTag(e.target.value.replace(',', ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
            />
          )}
        </Field>
        <Field label="Observações" htmlFor="cp-notes" optional hint="A equipe vê nos próximos atendimentos e pedidos.">
          <Textarea id="cp-notes" rows={3} maxLength={1000} disabled={!canEdit} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        {canEdit && (
          <Button type="submit" variant="secondary" className="w-full" loading={save.isPending} disabled={!dirty}>
            Salvar ficha
          </Button>
        )}
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line px-2 py-2">
      <dt className="text-2xs text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[0.8125rem] text-ink">{value}</dd>
    </div>
  );
}
