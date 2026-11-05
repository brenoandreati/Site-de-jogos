'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Trash2 } from 'lucide-react';
import {
  BRAZIL_STATES,
  BRAZIL_TIMEZONES,
  BUSINESS_CATEGORIES,
  BUSINESS_CATEGORY_LABELS,
  DEFAULT_MESSAGE_TEMPLATES,
  MESSAGE_TEMPLATE_KEYS,
  MESSAGE_TEMPLATE_LABELS,
  OFFLINE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  WEEKDAYS,
  branchSettingsSchema,
  companySettingsSchema,
  formatDocument,
  formatPhone,
  hasAccess,
  openingHoursSchema,
  orderSettingsSchema,
  type MessageTemplateKey,
  type OpeningInterval,
  type PaymentMethod,
} from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, MoneyInput, PhoneInput, Select, Switch, Textarea } from '@/components/ui/field';
import { ImageUpload } from '@/components/ui/image-upload';
import { ErrorNotice, PageHeader, Panel, Skeleton } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { ApiError, put } from '@/lib/api';
import { cx } from '@/lib/format';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { keys, useSettings } from '@/lib/queries';
import type { Settings } from '@/lib/types';

const SECTIONS = [
  { key: 'store', label: 'Loja' },
  { key: 'branch', label: 'Endereço e contato' },
  { key: 'hours', label: 'Horário' },
  { key: 'orders', label: 'Pedidos, entrega e pagamento' },
  { key: 'messages', label: 'Mensagens ao cliente' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

export default function SettingsPage() {
  const settings = useSettings();
  const { me } = useAdmin();
  const perms = me.active!.permissions;
  const [section, setSection] = useState<SectionKey>('store');

  if (settings.isLoading) return <Skeleton className="h-96" />;
  if (settings.error || !settings.data) return <ErrorNotice message={settings.error?.message ?? 'Erro'} onRetry={() => void settings.refetch()} />;
  if (!hasAccess(perms, 'settings', 'view')) return <ErrorNotice message="Você não tem acesso às configurações." />;

  const canEdit = hasAccess(perms, 'settings', 'edit');
  const canManage = hasAccess(perms, 'settings', 'manage');

  return (
    <div>
      <PageHeader title="Configurações" description="Dados da loja e regras que valem para o cardápio e os pedidos." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Seções das configurações" className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:mx-0 lg:flex-col lg:overflow-visible">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSection(s.key)}
              aria-current={section === s.key ? 'page' : undefined}
              className={cx(
                'shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                section === s.key ? 'bg-surface text-ink shadow-soft ring-1 ring-line' : 'text-muted hover:text-ink',
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 max-w-3xl">
          {section === 'store' && <StoreSection data={settings.data} disabled={!canManage} />}
          {section === 'branch' && <BranchSection data={settings.data} disabled={!canEdit} />}
          {section === 'hours' && <HoursSection data={settings.data} disabled={!canEdit} />}
          {section === 'orders' && <OrdersSection data={settings.data} disabled={!canEdit} />}
          {section === 'messages' && <MessagesSection data={settings.data} disabled={!canEdit} />}
        </div>
      </div>
    </div>
  );
}

function useSave(path: string, success: string) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  return useMutation({
    mutationFn: (body: unknown) => put<Settings>(`/settings/${path}`, body),
    onSuccess: (data) => {
      qc.setQueryData(keys.settings, data);
      toast(success);
    },
    onError: (e) => toast((e as ApiError).message, 'error'),
  });
}

function SaveBar({ loading, disabled, children = 'Salvar alterações' }: { loading: boolean; disabled?: boolean; children?: ReactNode }) {
  return (
    <div className="flex justify-end border-t border-line pt-4">
      <Button type="submit" loading={loading} disabled={disabled}>
        {children}
      </Button>
    </div>
  );
}

function StoreSection({ data, disabled }: { data: Settings; disabled: boolean }) {
  const c = data.company;
  const [form, setForm] = useState({
    tradeName: c.tradeName,
    legalName: c.legalName ?? '',
    document: c.document ? formatDocument(c.document) : '',
    email: c.email ?? '',
    phone: c.phone ? formatPhone(c.phone) : '',
    whatsapp: c.whatsapp ? formatPhone(c.whatsapp) : '',
    instagram: c.instagram ?? '',
    description: c.description ?? '',
    businessCategories: c.businessCategories,
    logoUrl: c.logoUrl,
    coverUrl: c.coverUrl,
    brandColor: c.brandColor ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useSave('company', 'Dados da loja salvos.');
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const body = { ...form, legalName: form.legalName || null, document: form.document || null, email: form.email || null, phone: form.phone || null, instagram: form.instagram || null, description: form.description || null, brandColor: form.brandColor || null };
        const v = validate(companySettingsSchema, body);
        setErrors(v.ok ? {} : v.errors);
        if (v.ok) save.mutate(body, { onError: (err) => setErrors(serverFieldErrors(err)) });
      }}
    >
      <fieldset disabled={disabled} className="min-w-0 space-y-6">
        {disabled && <p className="rounded-md bg-sunken px-3 py-2 text-[0.8125rem] text-muted">Somente quem administra as configurações pode alterar os dados da empresa.</p>}
        <Panel title="Identidade no cardápio" description="Como a loja aparece para o cliente.">
          <div className="space-y-5">
            <div className="flex flex-col gap-5 sm:flex-row">
              <div>
                <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Logo</p>
                <ImageUpload value={form.logoUrl} onChange={(v) => set('logoUrl', v)} label="Enviar logo" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Capa</p>
                <ImageUpload value={form.coverUrl} onChange={(v) => set('coverUrl', v)} aspect="wide" label="Enviar imagem de capa" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome da loja" htmlFor="s-trade" error={errors.tradeName}>
                <Input id="s-trade" value={form.tradeName} onChange={(e) => set('tradeName', e.target.value)} invalid={!!errors.tradeName} />
              </Field>
              <Field label="Cor do cardápio" htmlFor="s-color" optional error={errors.brandColor} hint="Botões e destaques do cardápio digital.">
                <div className="flex gap-2">
                  <input
                    type="color"
                    aria-label="Escolher cor"
                    value={form.brandColor || '#1f6b4f'}
                    onChange={(e) => set('brandColor', e.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-md border border-line-strong bg-surface p-1"
                  />
                  <Input id="s-color" value={form.brandColor} onChange={(e) => set('brandColor', e.target.value)} placeholder="#1f6b4f" className="num" invalid={!!errors.brandColor} />
                </div>
              </Field>
            </div>
            <Field label="Apresentação" htmlFor="s-desc" optional hint="Uma frase curta. Ex.: Açaí cremoso batido na hora desde 2015.">
              <Textarea id="s-desc" rows={2} maxLength={300} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <div>
              <p className="mb-2 text-[0.8125rem] font-medium text-ink-2">Tipo de negócio</p>
              <div className="flex flex-wrap gap-1.5">
                {BUSINESS_CATEGORIES.map((cat) => {
                  const on = form.businessCategories.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set('businessCategories', on ? form.businessCategories.filter((x) => x !== cat) : [...form.businessCategories, cat].slice(0, 5))}
                      className={cx('rounded-full border px-3 py-1 text-[0.8125rem] transition-colors', on ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong text-ink-2 hover:border-ink/30')}
                    >
                      {BUSINESS_CATEGORY_LABELS[cat]}
                    </button>
                  );
                })}
              </div>
              {errors.businessCategories && <p className="mt-1.5 text-[0.8125rem] text-danger">{errors.businessCategories}</p>}
            </div>
          </div>
        </Panel>

        <Panel title="Dados da empresa">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Razão social" htmlFor="s-legal" optional>
              <Input id="s-legal" value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />
            </Field>
            <Field label="CNPJ ou CPF" htmlFor="s-doc" optional error={errors.document}>
              <Input id="s-doc" value={form.document} onChange={(e) => set('document', e.target.value.toUpperCase())} onBlur={() => form.document && set('document', formatDocument(form.document))} invalid={!!errors.document} className="num text-[0.875rem]" />
            </Field>
            <Field label="WhatsApp" htmlFor="s-wa" error={errors.whatsapp}>
              <PhoneInput id="s-wa" value={form.whatsapp} onChange={(v) => set('whatsapp', v)} invalid={!!errors.whatsapp} />
            </Field>
            <Field label="Telefone fixo" htmlFor="s-phone" optional error={errors.phone}>
              <PhoneInput id="s-phone" value={form.phone} onChange={(v) => set('phone', v)} invalid={!!errors.phone} />
            </Field>
            <Field label="E-mail" htmlFor="s-email" optional error={errors.email}>
              <Input id="s-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} />
            </Field>
            <Field label="Instagram" htmlFor="s-ig" optional error={errors.instagram}>
              <Input id="s-ig" prefix="@" value={form.instagram} onChange={(e) => set('instagram', e.target.value.replace(/^@/, ''))} invalid={!!errors.instagram} />
            </Field>
          </div>
        </Panel>
        {!disabled && <SaveBar loading={save.isPending} />}
      </fieldset>
    </form>
  );
}

function BranchSection({ data, disabled }: { data: Settings; disabled: boolean }) {
  const b = data.branch;
  const [form, setForm] = useState({
    name: b.name,
    phone: b.phone ? formatPhone(b.phone) : '',
    whatsapp: b.whatsapp ? formatPhone(b.whatsapp) : '',
    timezone: b.timezone,
    address: {
      zipCode: b.address?.zipCode ?? '',
      street: b.address?.street ?? '',
      number: b.address?.number ?? '',
      complement: b.address?.complement ?? '',
      neighborhood: b.address?.neighborhood ?? '',
      city: b.address?.city ?? '',
      state: b.address?.state ?? 'SP',
      reference: b.address?.reference ?? '',
    },
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useSave('branch', 'Endereço e contato salvos.');
  const a = form.address;
  const setA = (k: keyof typeof a, v: string) => setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const hasAddress = !!(a.street || a.number || a.neighborhood || a.city);
        const body = {
          name: form.name,
          phone: form.phone || null,
          whatsapp: form.whatsapp || null,
          timezone: form.timezone,
          address: hasAddress ? { ...a, zipCode: a.zipCode || null, complement: a.complement || null, reference: a.reference || null } : null,
        };
        const v = validate(branchSettingsSchema, body);
        setErrors(v.ok ? {} : v.errors);
        if (v.ok) save.mutate(body);
      }}
    >
      <fieldset disabled={disabled} className="min-w-0 space-y-6">
        <Panel title="Unidade" description="Aparece no cardápio e nas comandas.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome da unidade" htmlFor="b-name" error={errors.name}>
              <Input id="b-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errors.name} />
            </Field>
            <Field label="Fuso horário" htmlFor="b-tz">
              <Select id="b-tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                {BRAZIL_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace('America/', '').replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="WhatsApp da unidade" htmlFor="b-wa" optional hint="Se vazio, usa o da loja." error={errors.whatsapp}>
              <PhoneInput id="b-wa" value={form.whatsapp} onChange={(v) => setForm({ ...form, whatsapp: v })} invalid={!!errors.whatsapp} />
            </Field>
            <Field label="Telefone" htmlFor="b-phone" optional error={errors.phone}>
              <PhoneInput id="b-phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} invalid={!!errors.phone} />
            </Field>
          </div>
        </Panel>
        <Panel title="Endereço" description="Para retirada no local e para o cliente saber onde fica.">
          <div className="grid gap-4 sm:grid-cols-6">
            <Field label="CEP" htmlFor="b-zip" optional className="sm:col-span-2" error={errors['address.zipCode']}>
              <Input id="b-zip" inputMode="numeric" value={a.zipCode} onChange={(e) => setA('zipCode', e.target.value.replace(/\D/g, '').slice(0, 8))} className="num text-[0.875rem]" invalid={!!errors['address.zipCode']} />
            </Field>
            <Field label="Rua" htmlFor="b-street" className="sm:col-span-4" error={errors['address.street']}>
              <Input id="b-street" value={a.street} onChange={(e) => setA('street', e.target.value)} invalid={!!errors['address.street']} />
            </Field>
            <Field label="Número" htmlFor="b-number" className="sm:col-span-2" error={errors['address.number']}>
              <Input id="b-number" value={a.number} onChange={(e) => setA('number', e.target.value)} invalid={!!errors['address.number']} />
            </Field>
            <Field label="Complemento" htmlFor="b-comp" optional className="sm:col-span-4">
              <Input id="b-comp" value={a.complement} onChange={(e) => setA('complement', e.target.value)} />
            </Field>
            <Field label="Bairro" htmlFor="b-nb" className="sm:col-span-3" error={errors['address.neighborhood']}>
              <Input id="b-nb" value={a.neighborhood} onChange={(e) => setA('neighborhood', e.target.value)} invalid={!!errors['address.neighborhood']} />
            </Field>
            <Field label="Cidade" htmlFor="b-city" className="sm:col-span-2" error={errors['address.city']}>
              <Input id="b-city" value={a.city} onChange={(e) => setA('city', e.target.value)} invalid={!!errors['address.city']} />
            </Field>
            <Field label="UF" htmlFor="b-state" className="sm:col-span-1">
              <Select id="b-state" value={a.state} onChange={(e) => setA('state', e.target.value)}>
                {BRAZIL_STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Ponto de referência" htmlFor="b-ref" optional className="sm:col-span-6">
              <Input id="b-ref" value={a.reference} onChange={(e) => setA('reference', e.target.value)} />
            </Field>
          </div>
        </Panel>
        {!disabled && <SaveBar loading={save.isPending} />}
      </fieldset>
    </form>
  );
}

function HoursSection({ data, disabled }: { data: Settings; disabled: boolean }) {
  const [hours, setHours] = useState<OpeningInterval[]>(data.hours);
  const [error, setError] = useState<string>();
  const save = useSave('hours', 'Horário de funcionamento salvo.');
  useEffect(() => setHours(data.hours), [data.hours]);

  const byDay = (d: number) => hours.filter((h) => h.weekday === d);
  const setDay = (d: number, intervals: Omit<OpeningInterval, 'weekday'>[]) =>
    setHours((list) => [...list.filter((h) => h.weekday !== d), ...intervals.map((i) => ({ ...i, weekday: d }))].sort((x, y) => x.weekday - y.weekday || x.opensAt.localeCompare(y.opensAt)));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const v = validate(openingHoursSchema, { intervals: hours });
        setError(v.ok ? undefined : Object.values(v.errors)[0]);
        if (v.ok) save.mutate({ intervals: hours });
      }}
    >
      <fieldset disabled={disabled} className="min-w-0 space-y-6">
        <Panel
          title="Horário de funcionamento"
          description={`Fora destes horários o cardápio continua visível, mas não aceita pedidos. Fuso: ${data.branch.timezone.replace('America/', '').replace('_', ' ')}. Para fechar além da meia-noite, use por exemplo 18:00 às 02:00.`}
        >
          {data.hours.length === 0 && (
            <p className="mb-4 rounded-md bg-warn-soft px-3 py-2 text-[0.8125rem] text-warn">Sem horário cadastrado, a loja aparece como fechada e não recebe pedidos pelo cardápio.</p>
          )}
          <ul className="divide-y divide-line">
            {WEEKDAYS.map((day, d) => {
              const intervals = byDay(d);
              const open = intervals.length > 0;
              return (
                <li key={day} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start">
                  <div className="flex w-44 items-center gap-3 pt-2">
                    <Switch checked={open} onChange={(v) => setDay(d, v ? [{ opensAt: '18:00', closesAt: '23:00' }] : [])} label={undefined} />
                    <span className={cx('text-sm font-medium', !open && 'text-muted')}>{day}</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    {!open ? (
                      <p className="pt-2 text-sm text-muted">Fechado</p>
                    ) : (
                      intervals.map((iv, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input type="time" aria-label={`${day}: abre às`} className="tabular w-[6.75rem] px-2 text-[0.875rem] sm:w-32 sm:px-3" value={iv.opensAt} onChange={(e) => setDay(d, intervals.map((x, j) => (j === i ? { ...x, opensAt: e.target.value } : x)))} />
                          <span className="text-sm text-muted">às</span>
                          <Input type="time" aria-label={`${day}: fecha às`} className="tabular w-[6.75rem] px-2 text-[0.875rem] sm:w-32 sm:px-3" value={iv.closesAt} onChange={(e) => setDay(d, intervals.map((x, j) => (j === i ? { ...x, closesAt: e.target.value } : x)))} />
                          <button type="button" className="grid size-8 place-items-center rounded text-muted hover:bg-sunken hover:text-danger" aria-label="Remover intervalo" onClick={() => setDay(d, intervals.filter((_, j) => j !== i))}>
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  {open && (
                    <div className="flex gap-1 sm:pt-1">
                      {intervals.length < 4 && (
                        <Button variant="ghost" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setDay(d, [...intervals, { opensAt: '11:00', closesAt: '14:00' }])}>
                          Intervalo
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Copy className="size-3.5" />}
                        title="Copiar este horário para todos os dias"
                        onClick={() => setHours(WEEKDAYS.flatMap((_, wd) => intervals.map((x) => ({ ...x, weekday: wd }))))}
                      >
                        Todos os dias
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {error && <p className="mt-3 text-[0.8125rem] text-danger">{error}</p>}
        </Panel>
        {!disabled && <SaveBar loading={save.isPending}>Salvar horário</SaveBar>}
      </fieldset>
    </form>
  );
}

function OrdersSection({ data, disabled }: { data: Settings; disabled: boolean }) {
  const [form, setForm] = useState({ ...data.orders, pixKey: data.orders.pixKey ?? '', pixHolderName: data.orders.pixHolderName ?? '', cancellationPolicy: data.orders.cancellationPolicy ?? '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useSave('orders', 'Regras de pedido salvas.');
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const togglePayment = (m: PaymentMethod, on: boolean) => set('paymentMethods', on ? [...form.paymentMethods, m] : form.paymentMethods.filter((x) => x !== m));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const body = { ...form, pixKey: form.pixKey || null, pixHolderName: form.pixHolderName || null, cancellationPolicy: form.cancellationPolicy || null };
        const v = validate(orderSettingsSchema, body);
        setErrors(v.ok ? {} : v.errors);
        if (v.ok) save.mutate(body);
      }}
    >
      <fieldset disabled={disabled} className="min-w-0 space-y-6">
        <Panel title="Como o cliente recebe">
          <div className="space-y-4">
            <Switch checked={form.acceptsDelivery} onChange={(v) => set('acceptsDelivery', v)} label="Entrega" description="O cliente informa o endereço no pedido." />
            <Switch checked={form.acceptsPickup} onChange={(v) => set('acceptsPickup', v)} label="Retirada na loja" />
            <Switch checked={form.acceptsDineIn} onChange={(v) => set('acceptsDineIn', v)} label="Consumo no local" description="O cliente pode informar a mesa." />
            {errors.acceptsDelivery && <p className="text-[0.8125rem] text-danger">{errors.acceptsDelivery}</p>}
          </div>
        </Panel>

        <Panel title="Confirmação e tempos">
          <div className="space-y-5">
            <Switch
              checked={form.autoConfirm}
              onChange={(v) => set('autoConfirm', v)}
              label="Confirmar pedidos automaticamente"
              description="Desligado, cada pedido do cardápio espera alguém da equipe confirmar."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tempo médio de preparo (min)" htmlFor="o-prep" error={errors.prepTimeMinutes}>
                <Input id="o-prep" type="number" min={1} max={240} className="num" value={form.prepTimeMinutes} onChange={(e) => set('prepTimeMinutes', Math.max(0, Math.floor(Number(e.target.value) || 0)))} invalid={!!errors.prepTimeMinutes} />
              </Field>
              <Field label="Tempo médio de entrega (min)" htmlFor="o-del" error={errors.deliveryTimeMinutes} hint="Somado ao preparo nos pedidos de entrega.">
                <Input id="o-del" type="number" min={0} max={240} className="num" value={form.deliveryTimeMinutes} onChange={(e) => set('deliveryTimeMinutes', Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
              </Field>
            </div>
          </div>
        </Panel>

        {form.acceptsDelivery && (
          <Panel title="Entrega" description="Taxa única para todos os bairros. Taxas por bairro e por distância chegam no módulo de Entregas.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Taxa de entrega" htmlFor="o-fee" error={errors.deliveryFeeCents}>
                <MoneyInput id="o-fee" value={form.deliveryFeeCents} onChange={(v) => set('deliveryFeeCents', v ?? 0)} />
              </Field>
              <Field label="Pedido mínimo" htmlFor="o-min" hint="R$ 0,00 = sem mínimo">
                <MoneyInput id="o-min" value={form.minOrderCents} onChange={(v) => set('minOrderCents', v ?? 0)} />
              </Field>
              <Field label="Entrega grátis acima de" htmlFor="o-free" optional>
                <MoneyInput id="o-free" value={form.freeDeliveryAboveCents} onChange={(v) => set('freeDeliveryAboveCents', v)} allowEmpty />
              </Field>
            </div>
          </Panel>
        )}

        <Panel title="Formas de pagamento" description="Pagas na entrega ou na retirada. Pagamento online pelo cardápio depende da integração com um provedor (próxima fase).">
          <div className="grid gap-3 sm:grid-cols-2">
            {OFFLINE_PAYMENT_METHODS.map((m) => (
              <Checkbox key={m} checked={form.paymentMethods.includes(m)} onChange={(v) => togglePayment(m, v)} label={PAYMENT_METHOD_LABELS[m]} />
            ))}
          </div>
          {errors.paymentMethods && <p className="mt-2 text-[0.8125rem] text-danger">{errors.paymentMethods}</p>}
          {form.paymentMethods.includes('pix') && (
            <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
              <Field label="Tipo de chave" htmlFor="o-pixtype">
                <Select id="o-pixtype" value={form.pixKeyType ?? ''} onChange={(e) => set('pixKeyType', e.target.value || null)}>
                  <option value="">Escolha</option>
                  <option value="cnpj">CNPJ</option>
                  <option value="cpf">CPF</option>
                  <option value="email">E-mail</option>
                  <option value="phone">Telefone</option>
                  <option value="random">Aleatória</option>
                </Select>
              </Field>
              <Field label="Chave PIX" htmlFor="o-pix" className="sm:col-span-2" error={errors.pixKey} hint="Mostrada ao cliente. Confira o recebimento no seu banco antes de marcar o pedido como pago.">
                <Input id="o-pix" value={form.pixKey} onChange={(e) => set('pixKey', e.target.value)} invalid={!!errors.pixKey} />
              </Field>
              <Field label="Nome do titular" htmlFor="o-pixname" optional className="sm:col-span-3">
                <Input id="o-pixname" value={form.pixHolderName} onChange={(e) => set('pixHolderName', e.target.value)} />
              </Field>
            </div>
          )}
        </Panel>

        <Panel title="Política de cancelamento" description="Aparece no fim do cardápio.">
          <Textarea rows={3} maxLength={400} aria-label="Política de cancelamento" value={form.cancellationPolicy} onChange={(e) => set('cancellationPolicy', e.target.value)} placeholder="Ex.: pedidos podem ser cancelados sem custo até a confirmação da loja." />
        </Panel>
        {!disabled && <SaveBar loading={save.isPending} />}
      </fieldset>
    </form>
  );
}

function MessagesSection({ data, disabled }: { data: Settings; disabled: boolean }) {
  const [templates, setTemplates] = useState<Record<MessageTemplateKey, string>>(data.messages);
  const save = useSave('messages', 'Mensagens salvas.');
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ templates });
      }}
    >
      <fieldset disabled={disabled} className="min-w-0 space-y-6">
        <Panel
          title="Mensagens de atualização do pedido"
          description="Usadas no botão “Avisar no WhatsApp” do pedido: o WhatsApp abre com o texto pronto e você só confirma o envio. Variáveis: {cliente} {pedido} {loja} {total} {link} {previsao}."
        >
          <div className="space-y-4">
            {MESSAGE_TEMPLATE_KEYS.map((k) => (
              <div key={k}>
                <Field label={MESSAGE_TEMPLATE_LABELS[k]} htmlFor={`m-${k}`}>
                  <Textarea id={`m-${k}`} rows={2} maxLength={500} value={templates[k]} onChange={(e) => setTemplates({ ...templates, [k]: e.target.value })} />
                </Field>
                {templates[k] !== DEFAULT_MESSAGE_TEMPLATES[k] && (
                  <button type="button" className="mt-1.5 text-xs font-medium text-brand hover:underline" onClick={() => setTemplates({ ...templates, [k]: DEFAULT_MESSAGE_TEMPLATES[k] })}>
                    Restaurar texto padrão
                  </button>
                )}
              </div>
            ))}
          </div>
        </Panel>
        {!disabled && <SaveBar loading={save.isPending}>Salvar mensagens</SaveBar>}
      </fieldset>
    </form>
  );
}
