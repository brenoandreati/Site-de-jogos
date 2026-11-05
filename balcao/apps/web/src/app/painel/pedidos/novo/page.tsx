'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  BRAZIL_STATES,
  FULFILLMENT_LABELS,
  MANUAL_ORDER_CHANNELS,
  OFFLINE_PAYMENT_METHODS,
  ORDER_CHANNEL_LABELS,
  PAYMENT_METHOD_LABELS,
  computeOrderTotals,
  formatBRL,
  hasAccess,
  normalizeBrazilianPhone,
  type FulfillmentType,
  type OrderChannel,
  type PaymentMethod,
} from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { CartBuilder, type CartLine } from '@/components/orders/cart-builder';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input, MoneyInput, PhoneInput, Segmented, Select, Textarea } from '@/components/ui/field';
import { ErrorNotice, Panel, Skeleton } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { ApiError, get, post } from '@/lib/api';
import { serverFieldErrors, type FieldErrors } from '@/lib/forms';
import { keys, useCatalog, useSettings } from '@/lib/queries';
import type { Address, OrderDetail } from '@/lib/types';

const emptyAddress = { zipCode: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: 'SP', reference: '' };

export default function NewOrderPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const { me, openOrder } = useAdmin();
  const canManage = hasAccess(me.active!.permissions, 'orders', 'manage');
  const catalog = useCatalog();
  const settings = useSettings();
  const idempotencyKey = useRef(crypto.randomUUID());

  const [lines, setLines] = useState<CartLine[]>([]);
  const [channel, setChannel] = useState<OrderChannel>('manual');
  const [fulfillment, setFulfillment] = useState<FulfillmentType>('pickup');
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [address, setAddress] = useState(emptyAddress);
  const [tableNumber, setTableNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [changeFor, setChangeFor] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState<number | null>(0);
  const [discountReason, setDiscountReason] = useState('');
  const [feeOverride, setFeeOverride] = useState<number | null>(null);
  const [zoneId, setZoneId] = useState('');
  const zonesQuery = useQuery({
    queryKey: keys.zones,
    queryFn: ({ signal }) => get<{ id: string; name: string; feeCents: number; isActive: boolean }[]>('/delivery/zones', signal),
  });
  const zones = (zonesQuery.data ?? []).filter((z) => z.isActive);
  const zone = zones.find((z) => z.id === zoneId) ?? null;
  const [errors, setErrors] = useState<FieldErrors>({});
  const [lookupInfo, setLookupInfo] = useState<string | null>(null);

  const defaultFee = settings.data?.orders.deliveryFeeCents ?? 0;
  const subtotal = lines.reduce((s, l) => s + l.priced.totalCents, 0);
  const freeAbove = settings.data?.orders.freeDeliveryAboveCents ?? null;
  const fee =
    fulfillment !== 'delivery' ? 0 : feeOverride !== null ? feeOverride : freeAbove !== null && subtotal >= freeAbove ? 0 : (zone?.feeCents ?? defaultFee);
  const totals = computeOrderTotals({ items: lines.map((l) => l.priced), discountCents: discount ?? 0, deliveryFeeCents: fee });

  const lookup = async () => {
    const phone = normalizeBrazilianPhone(customer.phone);
    if (!phone) return;
    try {
      const r = await get<{ customer: { name: string; addresses: Address[] } | null }>(`/orders/customers/lookup?phone=${phone}`);
      if (r.customer) {
        setCustomer((c) => ({ ...c, name: c.name || r.customer!.name }));
        const last = r.customer.addresses[0];
        if (last && !address.street) {
          setAddress({
            zipCode: last.zipCode ?? '',
            street: last.street,
            number: last.number,
            complement: last.complement ?? '',
            neighborhood: last.neighborhood,
            city: last.city,
            state: last.state,
            reference: last.reference ?? '',
          });
        }
        setLookupInfo(`Cliente encontrado: ${r.customer.name}`);
      } else setLookupInfo('Cliente novo');
    } catch {
      setLookupInfo(null);
    }
  };

  const create = useMutation({
    mutationFn: () =>
      post<OrderDetail>('/orders', {
        idempotencyKey: idempotencyKey.current,
        channel,
        fulfillment,
        customer: { name: customer.name, phone: customer.phone || null },
        address:
          fulfillment === 'delivery'
            ? { ...address, neighborhood: zone?.name ?? address.neighborhood, zipCode: address.zipCode || null, complement: address.complement || null, reference: address.reference || null }
            : null,
        deliveryZoneId: fulfillment === 'delivery' && zone ? zone.id : null,
        tableNumber: fulfillment === 'dine_in' ? tableNumber || null : null,
        paymentMethod,
        changeForCents: paymentMethod === 'cash' ? changeFor : null,
        notes: notes || null,
        discountCents: discount ?? 0,
        discountReason: discountReason || null,
        deliveryFeeCents: fulfillment === 'delivery' && feeOverride !== null ? feeOverride : null,
        items: lines.map((l) => l.selection),
      }),
    onSuccess: (order) => {
      idempotencyKey.current = crypto.randomUUID();
      void qc.invalidateQueries({ queryKey: ['orders'] });
      toast(`Pedido #${order.number} lançado.`);
      router.push('/painel/pedidos');
      openOrder(order.id);
    },
    onError: (e) => {
      setErrors(serverFieldErrors(e));
      toast((e as ApiError).message, 'error');
    },
  });

  if (catalog.isLoading || settings.isLoading) return <Skeleton className="h-96" />;
  if (catalog.error) return <ErrorNotice message={catalog.error.message} onRetry={() => void catalog.refetch()} />;

  const err = (k: string) => errors[k];

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setErrors({});
        create.mutate();
      }}
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <ButtonLink href="/painel/pedidos" variant="ghost" size="icon-sm" aria-label="Voltar para pedidos" icon={<ArrowLeft className="size-4" />} />
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">Lançar pedido</h1>
        <span className="text-sm text-muted">Para pedidos recebidos por telefone, WhatsApp, Instagram ou no balcão. Entra já confirmado.</span>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        <div className="space-y-6">
          <Panel title="Produtos">
            <CartBuilder catalog={catalog.data!} lines={lines} onChange={setLines} />
            {err('items') && <p className="mt-3 whitespace-pre-line text-[0.8125rem] text-danger">{err('items')}</p>}
          </Panel>

          <Panel title="Cliente e entrega">
            <div className="space-y-4">
              <Field label="Recebido por" htmlFor="channel">
                <Segmented
                  aria-label="Canal"
                  value={channel}
                  onChange={setChannel}
                  options={MANUAL_ORDER_CHANNELS.map((c) => ({ value: c, label: c === 'manual' ? 'Balcão/telefone' : ORDER_CHANNEL_LABELS[c] }))}
                  className="flex w-full flex-wrap"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Telefone" htmlFor="phone" optional error={err('customer.phone')} hint={lookupInfo ?? 'Com telefone, o pedido entra no histórico do cliente.'}>
                  <PhoneInput id="phone" value={customer.phone} onChange={(v) => setCustomer({ ...customer, phone: v })} onBlurCapture={lookup} invalid={!!err('customer.phone')} />
                </Field>
                <Field label="Nome do cliente" htmlFor="cname" error={err('customer.name')}>
                  <Input id="cname" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} invalid={!!err('customer.name')} />
                </Field>
              </div>
              <Field label="Atendimento" htmlFor="fulfillment">
                <Segmented
                  aria-label="Tipo de atendimento"
                  value={fulfillment}
                  onChange={setFulfillment}
                  options={(['pickup', 'delivery', 'dine_in'] as const).map((f) => ({ value: f, label: FULFILLMENT_LABELS[f] }))}
                />
              </Field>
              {fulfillment === 'delivery' && (
                <div className="grid gap-4 sm:grid-cols-6">
                  <Field label="Rua" htmlFor="street" className="sm:col-span-4" error={err('address.street')}>
                    <Input id="street" value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })} invalid={!!err('address.street')} />
                  </Field>
                  <Field label="Número" htmlFor="number" className="sm:col-span-2" error={err('address.number')}>
                    <Input id="number" value={address.number} onChange={(e) => setAddress({ ...address, number: e.target.value })} invalid={!!err('address.number')} />
                  </Field>
                  <Field label="Complemento" htmlFor="complement" optional className="sm:col-span-3">
                    <Input id="complement" value={address.complement} onChange={(e) => setAddress({ ...address, complement: e.target.value })} />
                  </Field>
                  <Field label="Bairro" htmlFor={zones.length ? 'zone' : 'neighborhood'} className="sm:col-span-3" error={err('address.neighborhood') ?? err('deliveryZoneId')}>
                    {zones.length > 0 && (
                      <Select
                        id="zone"
                        value={zoneId}
                        onChange={(e) => {
                          const z = zones.find((x) => x.id === e.target.value);
                          setZoneId(e.target.value);
                          if (z) setAddress({ ...address, neighborhood: z.name });
                        }}
                      >
                        <option value="">Outro bairro (taxa padrão)</option>
                        {zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name} · {z.feeCents ? formatBRL(z.feeCents) : 'grátis'}
                          </option>
                        ))}
                      </Select>
                    )}
                    {!zone && (
                      <Input
                        id="neighborhood"
                        className={zones.length ? 'mt-2' : undefined}
                        aria-label={zones.length ? 'Nome do bairro' : undefined}
                        placeholder={zones.length ? 'Nome do bairro' : undefined}
                        value={address.neighborhood}
                        onChange={(e) => setAddress({ ...address, neighborhood: e.target.value })}
                        invalid={!!err('address.neighborhood')}
                      />
                    )}
                  </Field>
                  <Field label="Cidade" htmlFor="city" className="sm:col-span-4" error={err('address.city')}>
                    <Input id="city" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} invalid={!!err('address.city')} />
                  </Field>
                  <Field label="UF" htmlFor="state" className="sm:col-span-2">
                    <Select id="state" value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })}>
                      {BRAZIL_STATES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Referência" htmlFor="reference" optional className="sm:col-span-6">
                    <Input id="reference" value={address.reference} onChange={(e) => setAddress({ ...address, reference: e.target.value })} />
                  </Field>
                </div>
              )}
              {fulfillment === 'dine_in' && (
                <Field label="Mesa" htmlFor="table" optional>
                  <Input id="table" value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} className="max-w-32" />
                </Field>
              )}
              <Field label="Observações do pedido" htmlFor="notes" optional>
                <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
              </Field>
            </div>
          </Panel>
        </div>

        <div className="xl:sticky xl:top-24 xl:self-start">
          <Panel title="Resumo e pagamento">
            <div className="space-y-4">
              <Field label="Forma de pagamento" htmlFor="payment">
                <Select id="payment" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                  {OFFLINE_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              {paymentMethod === 'cash' && (
                <Field label="Troco para" htmlFor="change" optional error={err('changeForCents')}>
                  <MoneyInput id="change" value={changeFor} onChange={setChangeFor} allowEmpty invalid={!!err('changeForCents')} />
                </Field>
              )}
              {canManage && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Desconto" htmlFor="discount" error={err('discountCents')}>
                    <MoneyInput id="discount" value={discount} onChange={setDiscount} invalid={!!err('discountCents')} />
                  </Field>
                  {fulfillment === 'delivery' && (
                    <Field label="Taxa de entrega" htmlFor="fee" hint={feeOverride === null ? 'Padrão da loja' : undefined}>
                      <MoneyInput id="fee" value={feeOverride ?? fee} onChange={setFeeOverride} />
                    </Field>
                  )}
                  {(discount ?? 0) > 0 && (
                    <Field label="Motivo do desconto" htmlFor="discount-reason" className="col-span-2" error={err('discountReason')}>
                      <Input id="discount-reason" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} invalid={!!err('discountReason')} />
                    </Field>
                  )}
                </div>
              )}

              <dl className="space-y-1.5 border-t border-line pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Produtos</dt>
                  <dd className="num">{formatBRL(totals.subtotalCents)}</dd>
                </div>
                {totals.discountCents > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted">Desconto</dt>
                    <dd className="num">− {formatBRL(totals.discountCents)}</dd>
                  </div>
                )}
                {fulfillment === 'delivery' && (
                  <div className="flex justify-between">
                    <dt className="text-muted">Entrega</dt>
                    <dd className="num">{totals.deliveryFeeCents ? formatBRL(totals.deliveryFeeCents) : 'Grátis'}</dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between pt-1">
                  <dt className="font-semibold">Total</dt>
                  <dd className="num text-lg font-semibold">{formatBRL(totals.totalCents)}</dd>
                </div>
              </dl>
              {create.error && !Object.keys(serverFieldErrors(create.error)).length && <ErrorNotice message={create.error.message} />}
              <Button type="submit" size="lg" className="w-full" disabled={lines.length === 0} loading={create.isPending}>
                Lançar pedido
              </Button>
              <p className="text-center text-xs text-muted">Os valores são conferidos pelo servidor com os preços do cardápio.</p>
            </div>
          </Panel>
        </div>
      </div>
    </form>
  );
}
