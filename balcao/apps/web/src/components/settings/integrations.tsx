'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, RefreshCw } from 'lucide-react';
import {
  MESSAGE_TEMPLATE_KEYS,
  MESSAGE_TEMPLATE_LABELS,
  TEMPLATE_VARIABLES,
  mercadoPagoConnectSchema,
  mercadoPagoWebhookSecretSchema,
  whatsappConnectSchema,
  whatsappSettingsSchema,
  type MessageTemplateKey,
} from '@balcao/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Switch } from '@/components/ui/field';
import { Badge, ErrorNotice, Panel, Skeleton } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { del, errorMessage, get, post, put } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { keys } from '@/lib/queries';

interface IntegrationBase {
  id: string;
  status: 'connected' | 'error' | 'disconnected';
  lastError: string | null;
  lastCheckedAt: string | null;
  connectedAt: string | null;
}
interface WhatsappIntegration extends IntegrationBase {
  config: {
    phoneNumberId: string;
    wabaId: string;
    displayPhoneNumber: string;
    verifiedName: string;
    qualityRating?: string | null;
    autoNotify: Partial<Record<MessageTemplateKey, boolean>>;
    templates: Partial<Record<MessageTemplateKey, { name: string; language: string; params: string[] }>>;
  };
}
interface MercadoPagoIntegration extends IntegrationBase {
  config: { userId: string; nickname: string | null; liveMode: boolean };
  webhookConfigured: boolean;
}
interface IntegrationsResponse {
  whatsapp: WhatsappIntegration | null;
  mercadopago: MercadoPagoIntegration | null;
  platform: { whatsappAppConfigured: boolean; whatsappWebhookUrl: string; mercadopagoWebhookUrl: string | null; aiAvailable: boolean };
}

export function IntegrationsSection({ canEdit, canManage }: { canEdit: boolean; canManage: boolean }) {
  const q = useQuery({ queryKey: keys.integrations, queryFn: ({ signal }) => get<IntegrationsResponse>('/integrations', signal) });
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <ErrorNotice message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return (
    <div className="space-y-6">
      <WhatsappPanel data={q.data} canEdit={canEdit} canManage={canManage} />
      <MercadoPagoPanel data={q.data} canManage={canManage} />
    </div>
  );
}

function StatusBadge({ status }: { status: IntegrationBase['status'] | null }) {
  if (status === 'connected') return <Badge tone="brand" dot>Conectado</Badge>;
  if (status === 'error') return <Badge tone="danger" dot>Com erro</Badge>;
  return <Badge dot>Não conectado</Badge>;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <div className="mt-1 flex items-stretch gap-2">
        <code className="num min-w-0 flex-1 truncate rounded-md bg-canvas px-3 py-2 text-xs">{value}</code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.integrations });
    void qc.invalidateQueries({ queryKey: ['inbox'] });
    void qc.invalidateQueries({ queryKey: keys.ai });
  };
}

// ───────────────────────────── WhatsApp ─────────────────────────────

function WhatsappPanel({ data, canEdit, canManage }: { data: IntegrationsResponse; canEdit: boolean; canManage: boolean }) {
  const wa = data.whatsapp;
  const refresh = useRefresh();
  const { toast, confirm } = useFeedback();
  const [form, setForm] = useState({ phoneNumberId: '', wabaId: '', accessToken: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [replacing, setReplacing] = useState(false);

  const connect = useMutation({
    mutationFn: (body: typeof form) => post('/integrations/whatsapp', body),
    onSuccess: () => {
      refresh();
      setForm({ phoneNumberId: '', wabaId: '', accessToken: '' });
      setReplacing(false);
      toast('WhatsApp conectado. As mensagens dos clientes passam a chegar no Atendimento.');
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });
  const check = useMutation({
    mutationFn: () => post<WhatsappIntegration>('/integrations/whatsapp/check'),
    onSuccess: (r) => {
      refresh();
      toast(r.status === 'connected' ? 'Conexão com a Meta funcionando.' : `A Meta respondeu com erro: ${r.lastError}`, r.status === 'connected' ? 'success' : 'error');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const disconnect = useMutation({
    mutationFn: () => del('/integrations/whatsapp'),
    onSuccess: () => {
      refresh();
      toast('WhatsApp desconectado.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const submit = () => {
    const v = validate(whatsappConnectSchema, form);
    setErrors(v.ok ? {} : v.errors);
    if (v.ok) connect.mutate(form);
  };

  const showForm = canManage && (!wa || replacing);

  return (
    <Panel
      title="WhatsApp oficial (Cloud API da Meta)"
      description="Conexão pela plataforma oficial da Meta. Nada de QR Code de WhatsApp Web nem automações não autorizadas, que colocam o número em risco de bloqueio."
      actions={<StatusBadge status={wa?.status ?? null} />}
    >
      {!data.platform.whatsappAppConfigured && (
        <p className="mb-4 rounded-md bg-warn-soft px-3 py-2.5 text-[0.8125rem] text-warn">
          O aplicativo da Meta desta plataforma ainda não foi configurado pelo administrador (chave secreta do app e token de verificação do webhook). Até lá não é possível conectar números.
        </p>
      )}

      {wa && (
        <div className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Info label="Número" value={wa.config.displayPhoneNumber} />
            <Info label="Nome verificado" value={wa.config.verifiedName} />
            <Info label="Qualidade do número" value={wa.config.qualityRating ? qualityLabel(wa.config.qualityRating) : 'Sem avaliação'} />
            <Info label="Última verificação" value={wa.lastCheckedAt ? formatDateTime(wa.lastCheckedAt) : '—'} />
          </dl>
          {wa.lastError && <p className="rounded-md bg-danger-soft px-3 py-2 text-[0.8125rem] text-danger">Último erro da Meta: {wa.lastError}</p>}
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" />} loading={check.isPending} onClick={() => check.mutate()}>
                Verificar conexão
              </Button>
            )}
            {canManage && !replacing && (
              <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>
                Trocar número ou token
              </Button>
            )}
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                loading={disconnect.isPending}
                onClick={async () => {
                  const r = await confirm({
                    title: 'Desconectar o WhatsApp?',
                    description: 'As mensagens deixam de chegar no Atendimento, a assistente virtual para de responder e os avisos automáticos de pedido param. O histórico de conversas continua salvo.',
                    confirmLabel: 'Desconectar',
                    tone: 'danger',
                  });
                  if (r.confirmed) disconnect.mutate();
                }}
              >
                Desconectar
              </Button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <form
          noValidate
          className={wa ? 'mt-5 space-y-4 border-t border-line pt-5' : 'space-y-4'}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <ol className="list-decimal space-y-1 pl-5 text-[0.8125rem] text-ink-2">
            <li>No Meta Business, abra WhatsApp › Configuração da API e copie o identificador do número e o da conta do WhatsApp Business.</li>
            <li>Crie um usuário do sistema com as permissões whatsapp_business_messaging e whatsapp_business_management e gere um token permanente.</li>
            <li>Cole tudo abaixo. A plataforma confere os dados na Meta antes de salvar e assina o webhook do número automaticamente.</li>
          </ol>
          {connect.error && !Object.keys(serverFieldErrors(connect.error)).length && <ErrorNotice message={connect.error.message} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Identificador do número (Phone number ID)" htmlFor="wa-phone" error={errors.phoneNumberId}>
              <Input id="wa-phone" inputMode="numeric" className="num" value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value.trim() })} invalid={!!errors.phoneNumberId} />
            </Field>
            <Field label="Conta do WhatsApp Business (WABA ID)" htmlFor="wa-waba" error={errors.wabaId}>
              <Input id="wa-waba" inputMode="numeric" className="num" value={form.wabaId} onChange={(e) => setForm({ ...form, wabaId: e.target.value.trim() })} invalid={!!errors.wabaId} />
            </Field>
          </div>
          <Field label="Token de acesso permanente" htmlFor="wa-token" error={errors.accessToken} hint="Guardado criptografado. Ninguém da equipe consegue ver de novo.">
            <Input id="wa-token" type="password" autoComplete="off" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} invalid={!!errors.accessToken} />
          </Field>
          <div className="flex justify-end gap-2">
            {replacing && (
              <Button type="button" variant="secondary" onClick={() => setReplacing(false)}>
                Cancelar
              </Button>
            )}
            <Button type="submit" loading={connect.isPending} disabled={!data.platform.whatsappAppConfigured}>
              {wa ? 'Salvar nova conexão' : 'Conectar WhatsApp'}
            </Button>
          </div>
        </form>
      )}
      {!wa && !canManage && <p className="text-sm text-muted">Somente quem administra a loja pode conectar o WhatsApp.</p>}

      {wa && <AutoMessages wa={wa} disabled={!canEdit} />}
    </Panel>
  );
}

function qualityLabel(q: string) {
  return { GREEN: 'Alta', YELLOW: 'Média', RED: 'Baixa' }[q.toUpperCase()] ?? q;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

type TemplateDraft = { name: string; language: string; params: string };

function AutoMessages({ wa, disabled }: { wa: WhatsappIntegration; disabled: boolean }) {
  const refresh = useRefresh();
  const { toast } = useFeedback();
  const [auto, setAuto] = useState(wa.config.autoNotify ?? {});
  const [templates, setTemplates] = useState<Partial<Record<MessageTemplateKey, TemplateDraft>>>(() =>
    Object.fromEntries(Object.entries(wa.config.templates ?? {}).map(([k, t]) => [k, { name: t.name, language: t.language, params: t.params.join(', ') }])),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: (body: unknown) => put('/integrations/whatsapp/settings', body),
    onSuccess: () => {
      refresh();
      toast('Mensagens automáticas salvas.');
    },
    onError: (e) => {
      setErrors(serverFieldErrors(e));
      toast(errorMessage(e), 'error');
    },
  });

  const submit = () => {
    const body = {
      autoNotify: auto,
      templates: Object.fromEntries(
        Object.entries(templates)
          .filter(([, t]) => t && t.name.trim())
          .map(([k, t]) => [k, { name: t!.name.trim(), language: t!.language.trim() || 'pt_BR', params: t!.params.split(',').map((p) => p.trim().replace(/[{}]/g, '')).filter(Boolean) }]),
      ),
    };
    const v = validate(whatsappSettingsSchema, body);
    setErrors(v.ok ? {} : v.errors);
    if (v.ok) save.mutate(body);
  };

  return (
    <form
      noValidate
      className="mt-6 border-t border-line pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3 className="text-sm font-semibold">Avisos automáticos de pedido</h3>
      <p className="mt-0.5 text-[0.8125rem] text-muted">
        Quando o pedido muda de etapa, o cliente recebe a mensagem configurada em Mensagens ao cliente. A WhatsApp só permite texto livre até 24 h depois da última mensagem do cliente; fora disso, o aviso só sai se você informar um modelo aprovado na Meta para a etapa. Sem modelo, o aviso fica registrado como não enviado no histórico do pedido.
      </p>
      <fieldset disabled={disabled} className="mt-4 min-w-0 divide-y divide-line rounded-lg border border-line">
        {MESSAGE_TEMPLATE_KEYS.map((k) => {
          const t = templates[k] ?? { name: '', language: 'pt_BR', params: '' };
          const set = (patch: Partial<TemplateDraft>) => setTemplates({ ...templates, [k]: { ...t, ...patch } });
          return (
            <div key={k} className="space-y-3 px-4 py-3">
              <Switch checked={!!auto[k]} onChange={(v) => setAuto({ ...auto, [k]: v })} label={MESSAGE_TEMPLATE_LABELS[k]} />
              {auto[k] && (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)]">
                  <Field label="Modelo aprovado" htmlFor={`tpl-${k}`} optional error={errors[`templates.${k}.name`]}>
                    <Input id={`tpl-${k}`} className="num text-xs" placeholder={`pedido_${k}`} value={t.name} onChange={(e) => set({ name: e.target.value })} invalid={!!errors[`templates.${k}.name`]} />
                  </Field>
                  <Field label="Idioma" htmlFor={`tpl-${k}-lang`} error={errors[`templates.${k}.language`]}>
                    <Input id={`tpl-${k}-lang`} className="num text-xs" value={t.language} onChange={(e) => set({ language: e.target.value })} invalid={!!errors[`templates.${k}.language`]} />
                  </Field>
                  <Field label="Variáveis, na ordem do modelo" htmlFor={`tpl-${k}-params`} optional error={errors[`templates.${k}.params`] ?? errors[`templates.${k}.params.0`]}>
                    <Input id={`tpl-${k}-params`} className="text-xs" placeholder="cliente, pedido, link" value={t.params} onChange={(e) => set({ params: e.target.value })} />
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
      <p className="mt-2 text-xs text-muted">Variáveis disponíveis: {TEMPLATE_VARIABLES.join(', ')}.</p>
      {!disabled && (
        <div className="mt-4 flex justify-end">
          <Button type="submit" loading={save.isPending}>
            Salvar avisos
          </Button>
        </div>
      )}
    </form>
  );
}

// ───────────────────────────── Mercado Pago ─────────────────────────────

function MercadoPagoPanel({ data, canManage }: { data: IntegrationsResponse; canManage: boolean }) {
  const mp = data.mercadopago;
  const refresh = useRefresh();
  const { toast, confirm } = useFeedback();
  const [form, setForm] = useState({ accessToken: '', webhookSecret: '' });
  const [secret, setSecret] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const connect = useMutation({
    mutationFn: (body: unknown) => post('/integrations/mercadopago', body),
    onSuccess: () => {
      refresh();
      setForm({ accessToken: '', webhookSecret: '' });
      toast('Mercado Pago conectado. O PIX online aparece na finalização do cardápio.');
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });
  const saveSecret = useMutation({
    mutationFn: (webhookSecret: string) => put('/integrations/mercadopago/webhook-secret', { webhookSecret }),
    onSuccess: () => {
      refresh();
      setSecret('');
      toast('Assinatura do webhook salva.');
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });
  const disconnect = useMutation({
    mutationFn: () => del('/integrations/mercadopago'),
    onSuccess: () => {
      refresh();
      toast('Mercado Pago desconectado.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Panel
      title="PIX online (Mercado Pago)"
      description="O cliente paga pelo QR Code na hora do pedido. O pedido só vai para a loja quando o Mercado Pago confirma: a plataforma consulta o pagamento direto no provedor e nunca considera comprovante enviado pelo cliente."
      actions={<StatusBadge status={mp?.status ?? null} />}
    >
      {mp ? (
        <div className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <Info label="Conta" value={mp.config.nickname ? `${mp.config.nickname} (${mp.config.userId})` : mp.config.userId} />
            <Info label="Ambiente" value={mp.config.liveMode ? 'Produção' : 'Teste (sandbox)'} />
            <Info label="Conectado em" value={mp.connectedAt ? formatDateTime(mp.connectedAt) : '—'} />
          </dl>
          {!mp.config.liveMode && <p className="rounded-md bg-warn-soft px-3 py-2 text-[0.8125rem] text-warn">Credencial de teste: os PIX gerados não cobram de verdade. Use o access token de produção (APP_USR-) para receber.</p>}
          {data.platform.mercadopagoWebhookUrl && <CopyField label="URL de notificações (cadastre em Suas integrações › Webhooks, evento Pagamentos)" value={data.platform.mercadopagoWebhookUrl} />}
          {mp.webhookConfigured ? (
            <p className="text-[0.8125rem] text-muted">Assinatura do webhook cadastrada: as notificações do Mercado Pago são aceitas e conferidas.</p>
          ) : (
            <p className="rounded-md bg-info-soft px-3 py-2 text-[0.8125rem] text-info">
              Falta a assinatura secreta do webhook. Enquanto isso, a confirmação acontece por consulta ao Mercado Pago quando o cliente está na tela do PIX, e as notificações são recusadas.
            </p>
          )}
          {canManage && (
            <form
              noValidate
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = validate(mercadoPagoWebhookSecretSchema, { webhookSecret: secret });
                setErrors(v.ok ? {} : v.errors);
                if (v.ok) saveSecret.mutate(secret);
              }}
            >
              <Field label={mp.webhookConfigured ? 'Trocar assinatura secreta' : 'Assinatura secreta do webhook'} htmlFor="mp-secret" error={errors.webhookSecret} className="min-w-0 flex-1">
                <Input id="mp-secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} invalid={!!errors.webhookSecret} />
              </Field>
              <Button type="submit" variant="secondary" loading={saveSecret.isPending}>
                Salvar assinatura
              </Button>
            </form>
          )}
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              loading={disconnect.isPending}
              onClick={async () => {
                const r = await confirm({
                  title: 'Desconectar o Mercado Pago?',
                  description: 'O PIX online some do cardápio. Pedidos que ainda esperam pagamento são cancelados quando o PIX vencer. Estornos de pedidos já pagos só podem ser feitos com a conta conectada.',
                  confirmLabel: 'Desconectar',
                  tone: 'danger',
                });
                if (r.confirmed) disconnect.mutate();
              }}
            >
              Desconectar
            </Button>
          )}
        </div>
      ) : canManage ? (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const body = { accessToken: form.accessToken.trim(), webhookSecret: form.webhookSecret.trim() || null };
            const v = validate(mercadoPagoConnectSchema, body);
            setErrors(v.ok ? {} : v.errors);
            if (v.ok) connect.mutate(body);
          }}
        >
          <ol className="list-decimal space-y-1 pl-5 text-[0.8125rem] text-ink-2">
            <li>Em Mercado Pago Developers › Suas integrações, abra a aplicação da loja e copie o access token de produção.</li>
            <li>Conecte aqui. Em seguida a plataforma mostra a URL de notificações para cadastrar no Mercado Pago.</li>
            <li>Cadastre a URL com o evento Pagamentos e cole aqui a assinatura secreta que o Mercado Pago gerar.</li>
          </ol>
          {connect.error && !Object.keys(serverFieldErrors(connect.error)).length && <ErrorNotice message={connect.error.message} />}
          <Field label="Access token" htmlFor="mp-token" error={errors.accessToken} hint="Guardado criptografado. Começa com APP_USR- (produção) ou TEST- (teste).">
            <Input id="mp-token" type="password" autoComplete="off" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} invalid={!!errors.accessToken} />
          </Field>
          <Field label="Assinatura secreta do webhook" htmlFor="mp-secret-new" optional error={errors.webhookSecret} hint="Se ainda não tiver, conecte primeiro e cadastre depois.">
            <Input id="mp-secret-new" type="password" autoComplete="off" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} invalid={!!errors.webhookSecret} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={connect.isPending}>
              Conectar Mercado Pago
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted">Somente quem administra a loja pode conectar o Mercado Pago.</p>
      )}
    </Panel>
  );
}
