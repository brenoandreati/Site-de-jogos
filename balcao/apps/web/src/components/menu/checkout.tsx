'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Banknote, Check, Copy, CreditCard, QrCode, Ticket } from 'lucide-react';
import {
  BRAZIL_STATES,
  FULFILLMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  formatBRL,
  publicCheckoutSchema,
  type FulfillmentType,
  type PaymentMethod,
} from '@balcao/shared';
import { Checkbox, Field, Input, MoneyInput, PhoneInput, Select, Textarea } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/misc';
import { ApiError, get, post } from '@/lib/api';
import { deliveryFeeFor, readCustomer, rememberOrder, saveCustomer, useCart } from '@/lib/cart';
import { cx, formatAddress } from '@/lib/format';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import type { PublicStore } from '@/lib/types';
import { AccentButton } from './accent-button';

const PAYMENT_ICON: Partial<Record<PaymentMethod, typeof Banknote>> = {
  pix: QrCode,
  cash: Banknote,
  credit_card: CreditCard,
  debit_card: CreditCard,
  meal_voucher: Ticket,
};

const emptyAddress = { zipCode: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: 'SP', reference: '' };

export function CheckoutForm({ initial, slug }: { initial: PublicStore; slug: string }) {
  const router = useRouter();
  const query = useQuery({ queryKey: ['public-store', slug], queryFn: ({ signal }) => get<PublicStore>(`/public/stores/${slug}`, signal), initialData: initial, refetchInterval: 60_000 });
  const store = query.data.store;
  const cart = useCart(slug, query.data);

  const fulfillments = (['delivery', 'pickup', 'dine_in'] as FulfillmentType[]).filter((f) =>
    f === 'delivery' ? store.acceptsDelivery : f === 'pickup' ? store.acceptsPickup : store.acceptsDineIn,
  );
  const [fulfillment, setFulfillment] = useState<FulfillmentType>(fulfillments[0] ?? 'pickup');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState(emptyAddress);
  const [tableNumber, setTableNumber] = useState('');
  const [payment, setPayment] = useState<PaymentMethod | ''>('');
  const [needsChange, setNeedsChange] = useState(false);
  const [changeFor, setChangeFor] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [copied, setCopied] = useState(false);
  // Uma chave por tentativa de pedido: reenviar (rede instável, duplo toque) não duplica o pedido.
  const idempotencyKey = useRef<string>('');

  useEffect(() => {
    const saved = readCustomer();
    if (saved) {
      setName(saved.name);
      setPhone(saved.phone);
      if (saved.address) setAddress(saved.address);
    }
    try {
      idempotencyKey.current = sessionStorage.getItem(`balcao:checkout:${slug}`) ?? crypto.randomUUID();
      sessionStorage.setItem(`balcao:checkout:${slug}`, idempotencyKey.current);
    } catch {
      idempotencyKey.current = crypto.randomUUID();
    }
  }, [slug]);

  const fee = fulfillment === 'delivery' ? deliveryFeeFor(store, cart.subtotalCents) : 0;
  const total = cart.subtotalCents + fee;
  const belowMin = fulfillment === 'delivery' && cart.subtotalCents < store.minOrderCents;

  const submit = useMutation({
    mutationFn: (body: unknown) => post<{ token: string; number: number }>(`/public/stores/${slug}/orders`, body),
    onSuccess: (r) => {
      if (remember) saveCustomer({ name, phone, address: fulfillment === 'delivery' ? address : readCustomer()?.address });
      rememberOrder(slug, r.token);
      cart.clear();
      try {
        sessionStorage.removeItem(`balcao:checkout:${slug}`);
      } catch {
        /* ignore */
      }
      router.replace(`/${slug}/pedido/${r.token}?novo=1`);
    },
    onError: (e) => {
      setErrors(serverFieldErrors(e));
      // Erros de regra (loja fechou, item esgotou) pedem uma nova tentativa com nova chave.
      if (e instanceof ApiError && e.status !== 0) {
        idempotencyKey.current = crypto.randomUUID();
        try {
          sessionStorage.setItem(`balcao:checkout:${slug}`, idempotencyKey.current);
        } catch {
          /* ignore */
        }
      }
      void query.refetch();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  if (cart.ready && cart.lines.length === 0 && !submit.isPending && !submit.isSuccess) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="font-semibold">Sua sacola está vazia</p>
        <p className="mt-1 text-sm text-muted">Escolha os produtos no cardápio para fazer o pedido.</p>
        <Link href={`/${slug}`} className="mt-6 inline-flex h-11 items-center rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-[color:var(--accent-ink,#fff)]">
          Ver cardápio
        </Link>
      </div>
    );
  }

  const onSubmit = () => {
    const body = {
      idempotencyKey: idempotencyKey.current,
      customer: { name, phone },
      fulfillment,
      address:
        fulfillment === 'delivery'
          ? { ...address, zipCode: address.zipCode || null, complement: address.complement || null, reference: address.reference || null }
          : null,
      tableNumber: fulfillment === 'dine_in' ? tableNumber || null : null,
      paymentMethod: payment || undefined,
      changeForCents: payment === 'cash' && needsChange ? changeFor : null,
      notes: notes || null,
      marketingOptIn: optIn,
      items: cart.lines.filter((l) => l.priced).map((l) => l.selection),
    };
    const v = validate(publicCheckoutSchema, body);
    const next = v.ok ? {} : { ...v.errors };
    if (payment === 'cash' && needsChange && (changeFor === null || changeFor < total)) next.changeForCents = 'Informe um valor maior que o total';
    setErrors(next);
    if (Object.keys(next).length) {
      document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    submit.mutate(body);
  };

  const e = (k: string) => errors[k];
  const generalError = submit.error && !Object.keys(serverFieldErrors(submit.error)).length ? (submit.error as ApiError).message : submit.error && errors.items ? errors.items : null;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <Link href={`/${slug}`} className="grid size-10 place-items-center rounded-full border border-line bg-surface text-ink-2 hover:bg-sunken" aria-label="Voltar ao cardápio">
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Finalizar pedido</h1>
          <p className="text-[0.8125rem] text-muted">{store.name}</p>
        </div>
      </header>

      {!store.availability.isOpen && (
        <div className="mb-5">
          <ErrorNotice message={`${store.availabilityText}. O pedido só pode ser enviado quando a loja estiver aberta.`} />
        </div>
      )}
      {generalError && (
        <div className="mb-5">
          <ErrorNotice message={generalError} />
        </div>
      )}

      <form
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          onSubmit();
        }}
        className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"
      >
        <div className="space-y-5">
          <Section title="Como você quer receber?">
            <div role="radiogroup" aria-label="Como você quer receber" className="grid gap-2 sm:grid-cols-3">
              {fulfillments.map((f) => (
                <Choice key={f} checked={fulfillment === f} onClick={() => setFulfillment(f)}>
                  <span className="font-medium">{FULFILLMENT_LABELS[f]}</span>
                  <span className="tabular block text-xs text-muted">
                    {f === 'delivery'
                      ? `${store.prepTimeMinutes + store.deliveryTimeMinutes}–${store.prepTimeMinutes + store.deliveryTimeMinutes + 10} min · ${fee || deliveryFeeFor(store, cart.subtotalCents) ? formatBRL(deliveryFeeFor(store, cart.subtotalCents)) : 'grátis'}`
                      : f === 'pickup'
                        ? `${store.prepTimeMinutes} min · sem taxa`
                        : 'Na loja'}
                  </span>
                </Choice>
              ))}
            </div>
            {fulfillment === 'delivery' && (
              <div className="mt-5 grid gap-4 sm:grid-cols-6">
                <Field label="Rua" htmlFor="street" className="sm:col-span-4" error={e('address.street')}>
                  <Input id="street" autoComplete="address-line1" value={address.street} onChange={(ev) => setAddress({ ...address, street: ev.target.value })} invalid={!!e('address.street')} />
                </Field>
                <Field label="Número" htmlFor="number" className="sm:col-span-2" error={e('address.number')}>
                  <Input id="number" inputMode="numeric" value={address.number} onChange={(ev) => setAddress({ ...address, number: ev.target.value })} invalid={!!e('address.number')} />
                </Field>
                <Field label="Complemento" htmlFor="complement" optional className="sm:col-span-3">
                  <Input id="complement" autoComplete="address-line2" placeholder="Apto, bloco, casa" value={address.complement} onChange={(ev) => setAddress({ ...address, complement: ev.target.value })} />
                </Field>
                <Field label="Bairro" htmlFor="neighborhood" className="sm:col-span-3" error={e('address.neighborhood')}>
                  <Input id="neighborhood" value={address.neighborhood} onChange={(ev) => setAddress({ ...address, neighborhood: ev.target.value })} invalid={!!e('address.neighborhood')} />
                </Field>
                <Field label="Cidade" htmlFor="city" className="sm:col-span-3" error={e('address.city')}>
                  <Input id="city" autoComplete="address-level2" value={address.city} onChange={(ev) => setAddress({ ...address, city: ev.target.value })} invalid={!!e('address.city')} />
                </Field>
                <Field label="Estado" htmlFor="state" className="sm:col-span-1">
                  <Select id="state" value={address.state} onChange={(ev) => setAddress({ ...address, state: ev.target.value })}>
                    {BRAZIL_STATES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="CEP" htmlFor="zip" optional className="sm:col-span-2" error={e('address.zipCode')}>
                  <Input id="zip" inputMode="numeric" autoComplete="postal-code" value={address.zipCode} onChange={(ev) => setAddress({ ...address, zipCode: ev.target.value.replace(/\D/g, '').slice(0, 8) })} invalid={!!e('address.zipCode')} />
                </Field>
                <Field label="Ponto de referência" htmlFor="reference" optional className="sm:col-span-6">
                  <Input id="reference" placeholder="Ex.: portão azul, ao lado da padaria" value={address.reference} onChange={(ev) => setAddress({ ...address, reference: ev.target.value })} />
                </Field>
              </div>
            )}
            {fulfillment === 'pickup' && store.address && (
              <p className="mt-4 rounded-md bg-canvas px-3 py-2.5 text-sm text-ink-2">Retire em: {formatAddress(store.address)}</p>
            )}
            {fulfillment === 'dine_in' && (
              <Field label="Número da mesa" htmlFor="table" optional className="mt-4 max-w-40">
                <Input id="table" value={tableNumber} onChange={(ev) => setTableNumber(ev.target.value)} maxLength={20} />
              </Field>
            )}
          </Section>

          <Section title="Seus dados">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" htmlFor="name" error={e('customer.name')}>
                <Input id="name" autoComplete="name" value={name} onChange={(ev) => setName(ev.target.value)} invalid={!!e('customer.name')} />
              </Field>
              <Field label="WhatsApp" htmlFor="phone" error={e('customer.phone')} hint="A loja usa para falar sobre o pedido.">
                <PhoneInput id="phone" value={phone} onChange={setPhone} invalid={!!e('customer.phone')} />
              </Field>
            </div>
          </Section>

          <Section title="Pagamento" description="Na entrega ou na retirada.">
            <div role="radiogroup" aria-label="Forma de pagamento" className="grid gap-2 sm:grid-cols-2">
              {store.paymentMethods.map((m) => {
                const Icon = PAYMENT_ICON[m] ?? CreditCard;
                return (
                  <Choice key={m} checked={payment === m} onClick={() => setPayment(m)} invalid={!!e('paymentMethod')}>
                    <span className="flex items-center gap-2 font-medium">
                      <Icon className="size-4 text-muted" />
                      {PAYMENT_METHOD_LABELS[m]}
                    </span>
                  </Choice>
                );
              })}
            </div>
            {e('paymentMethod') && <p className="mt-2 text-[0.8125rem] text-danger" aria-invalid="true">{e('paymentMethod')}</p>}
            {payment === 'cash' && (
              <div className="mt-4 space-y-3">
                <Checkbox checked={needsChange} onChange={setNeedsChange} label="Preciso de troco" />
                {needsChange && (
                  <Field label="Troco para quanto?" htmlFor="change" error={e('changeForCents')} className="max-w-48">
                    <MoneyInput id="change" value={changeFor} onChange={setChangeFor} allowEmpty invalid={!!e('changeForCents')} />
                  </Field>
                )}
              </div>
            )}
            {payment === 'pix' && store.pix && (
              <div className="mt-4 rounded-md bg-canvas px-4 py-3 text-sm">
                <p className="text-ink-2">Você pode pagar na entrega/retirada ou adiantar pela chave PIX da loja:</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="num break-all rounded bg-surface px-2 py-1 text-xs text-ink">{store.pix.key}</code>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]"
                    onClick={async () => {
                      await navigator.clipboard.writeText(store.pix!.key).catch(() => undefined);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copiada' : 'Copiar chave'}
                  </button>
                </div>
                {store.pix.holderName && <p className="mt-1 text-xs text-muted">Titular: {store.pix.holderName}</p>}
                <p className="mt-2 text-xs text-muted">A loja confere o recebimento no banco antes de considerar o pedido pago.</p>
              </div>
            )}
          </Section>

          <Section title="Observações" optional>
            <Textarea rows={2} maxLength={500} aria-label="Observações do pedido" placeholder="Algo que a loja precisa saber sobre o pedido?" value={notes} onChange={(ev) => setNotes(ev.target.value)} />
          </Section>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-semibold">Resumo</h2>
            <ul className="mt-3 space-y-2.5 text-sm">
              {cart.lines.map((l) => (
                <li key={l.key} className="flex justify-between gap-3">
                  <span className={cx('min-w-0', l.problem && 'text-muted line-through')}>
                    <span className="num mr-1.5 text-xs text-muted">{l.selection.quantity}×</span>
                    {l.priced?.productName ?? l.product?.name}
                    {l.priced && l.priced.modifiers.length > 0 && <span className="block pl-6 text-xs text-muted">{l.priced.modifiers.map((m) => m.name).join(' · ')}</span>}
                    {l.problem && <span className="block pl-6 text-xs text-danger no-underline">{l.problem}</span>}
                  </span>
                  <span className="num shrink-0">{l.priced ? formatBRL(l.priced.totalCents) : '—'}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd className="num">{formatBRL(cart.subtotalCents)}</dd>
              </div>
              {fulfillment === 'delivery' && (
                <div className="flex justify-between">
                  <dt className="text-muted">Entrega</dt>
                  <dd className="num">{fee ? formatBRL(fee) : 'Grátis'}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between pt-1">
                <dt className="font-semibold">Total</dt>
                <dd className="num text-lg font-semibold">{formatBRL(total)}</dd>
              </div>
            </dl>
            {belowMin && <p className="mt-3 text-[0.8125rem] text-warn">O pedido mínimo para entrega é {formatBRL(store.minOrderCents)}.</p>}
            {cart.hasProblems && (
              <p className="mt-3 text-[0.8125rem] text-warn">
                Há itens indisponíveis.{' '}
                <Link href={`/${slug}`} className="font-semibold underline">
                  Revisar sacola
                </Link>
              </p>
            )}
            <div className="mt-4 space-y-3">
              <Checkbox checked={optIn} onChange={setOptIn} label="Quero receber novidades e promoções desta loja pelo WhatsApp" />
              <Checkbox checked={remember} onChange={setRemember} label="Lembrar meus dados neste aparelho" />
            </div>
            <AccentButton type="submit" className="mt-5 w-full justify-between" loading={submit.isPending} disabled={!store.availability.isOpen || belowMin || cart.hasProblems || !cart.ready}>
              <span>Fazer pedido</span>
              <span className="num">{formatBRL(total)}</span>
            </AccentButton>
            <p className="mt-3 text-center text-xs text-muted">
              Ao fazer o pedido você concorda com a{' '}
              <Link href="/privacidade" className="underline">
                política de privacidade
              </Link>
              .
            </p>
          </div>
        </aside>
      </form>
    </div>
  );
}

function Section({ title, description, optional, children }: { title: string; description?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">
        {title}
        {optional && <span className="ml-1.5 text-sm font-normal text-faint">(opcional)</span>}
      </h2>
      {description && <p className="mt-0.5 text-[0.8125rem] text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Choice({ checked, onClick, children, invalid }: { checked: boolean; onClick: () => void; children: React.ReactNode; invalid?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-invalid={invalid || undefined}
      onClick={onClick}
      className={cx(
        'flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors',
        checked ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : invalid ? 'border-danger/40' : 'border-line-strong hover:border-ink/30',
      )}
    >
      <span className="min-w-0">{children}</span>
      <span aria-hidden="true" className={cx('grid size-5 shrink-0 place-items-center rounded-full border', checked ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-line-strong')}>
        {checked && <span className="size-2 rounded-full bg-[var(--accent-ink,#fff)]" />}
      </span>
    </button>
  );
}
