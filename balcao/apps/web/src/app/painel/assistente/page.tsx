'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronDown, Plus, RotateCcw, Send, Trash2, Wrench, X } from 'lucide-react';
import {
  AI_TONES,
  AI_TONE_LABELS,
  HANDOFF_TRIGGERS,
  HANDOFF_TRIGGER_LABELS,
  aiSettingsSchema,
  hasAccess,
  type AiSettingsInput,
  type HandoffTrigger,
} from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/field';
import { ErrorNotice, PageHeader, Panel, Skeleton } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { errorMessage, get, post, put } from '@/lib/api';
import { cx } from '@/lib/format';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { keys, useCatalog, type InboxListResponse } from '@/lib/queries';

type AiSettings = Required<Omit<AiSettingsInput, 'personality' | 'greeting' | 'awayMessage' | 'instructions' | 'salesRules' | 'restrictions'>> & {
  personality: string | null;
  greeting: string | null;
  awayMessage: string | null;
  instructions: string | null;
  salesRules: string | null;
  restrictions: string | null;
};
interface AiResponse {
  settings: AiSettings;
  available: boolean;
  model: string | null;
  usage30d?: { replies: number; tests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export default function AssistantPage() {
  const { me } = useAdmin();
  const perms = me.active!.permissions;
  const q = useQuery({ queryKey: keys.ai, queryFn: ({ signal }) => get<AiResponse>('/ai/settings', signal) });
  const inbox = useQuery({ queryKey: keys.inbox('all'), queryFn: ({ signal }) => get<InboxListResponse>('/inbox/conversations?filter=all', signal), enabled: hasAccess(perms, 'inbox', 'view') });

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <ErrorNotice message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;

  const canManage = hasAccess(perms, 'ai_assistant', 'manage');
  const canTest = hasAccess(perms, 'ai_assistant', 'edit');
  const wa = inbox.data?.whatsapp;

  return (
    <div>
      <PageHeader
        title="Assistente de IA"
        description="Atende os clientes no WhatsApp com o cardápio real da loja: consulta produtos e preços no sistema, monta o pedido, confirma o resumo com o cliente e só então registra. Passa para a equipe quando precisa."
      />
      {!q.data.available && (
        <p className="mb-5 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          A IA não está disponível nesta instalação: falta configurar a chave da Anthropic no servidor (ANTHROPIC_API_KEY). Você pode deixar tudo pronto aqui e ativar depois.
        </p>
      )}
      {q.data.available && inbox.data && !wa && (
        <p className="mb-5 rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
          A assistente responde pelo WhatsApp oficial da loja.{' '}
          <Link href="/painel/configuracoes?secao=integracoes" className="font-medium underline">
            Conecte o WhatsApp
          </Link>{' '}
          para ela começar a atender. O teste ao lado já funciona.
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <SettingsForm key={JSON.stringify(q.data.settings)} data={q.data} disabled={!canManage} />
        <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
          {canTest && <TestChat available={q.data.available} name={q.data.settings.assistantName} />}
          {q.data.usage30d && <Usage usage={q.data.usage30d} model={q.data.model} />}
        </div>
      </div>
    </div>
  );
}

function SettingsForm({ data, disabled }: { data: AiResponse; disabled: boolean }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const catalog = useCatalog();
  const [form, setForm] = useState<AiSettings>(data.settings);
  const [keyword, setKeyword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: (body: unknown) => put<AiResponse>('/ai/settings', body),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.ai });
      void qc.invalidateQueries({ queryKey: ['inbox'] });
      toast(r.settings.enabled ? 'Assistente salva e ativa.' : 'Configurações salvas. A assistente está desligada.');
    },
    onError: (e) => {
      setErrors(serverFieldErrors(e));
      toast(errorMessage(e), 'error');
    },
  });

  const products = (catalog.data?.categories ?? []).flatMap((c) => c.products.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name, category: c.name })));
  const recommended = form.recommendedProductIds;

  const submit = () => {
    const body = {
      ...form,
      personality: form.personality || null,
      greeting: form.greeting || null,
      awayMessage: form.awayMessage || null,
      instructions: form.instructions || null,
      salesRules: form.salesRules || null,
      restrictions: form.restrictions || null,
      faq: form.faq.filter((f) => f.question.trim() || f.answer.trim()),
    };
    const v = validate(aiSettingsSchema, body);
    setErrors(v.ok ? {} : v.errors);
    if (!v.ok) {
      toast('Revise os campos destacados.', 'error');
      return;
    }
    save.mutate(body);
  };

  const addKeyword = () => {
    const k = keyword.trim().toLowerCase();
    if (k.length >= 2 && !form.handoffKeywords.includes(k) && form.handoffKeywords.length < 30) set('handoffKeywords', [...form.handoffKeywords, k]);
    setKeyword('');
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset disabled={disabled} className="min-w-0 space-y-6">
        <Panel>
          <Switch
            checked={form.enabled}
            onChange={(v) => set('enabled', v)}
            disabled={!data.available && !form.enabled}
            label={form.enabled ? 'Assistente ligada' : 'Assistente desligada'}
            description="Ligada, ela responde as conversas novas e as que estão com a IA. Conversas com a equipe não são tocadas."
          />
          {errors.enabled && <p className="mt-2 text-[0.8125rem] text-danger">{errors.enabled}</p>}
        </Panel>

        <Panel title="Identidade" description="Como a atendente se apresenta e conversa.">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" htmlFor="ai-name" error={errors.assistantName}>
                <Input id="ai-name" maxLength={40} value={form.assistantName} onChange={(e) => set('assistantName', e.target.value)} invalid={!!errors.assistantName} />
              </Field>
              <Field label="Tom de voz" htmlFor="ai-tone">
                <Select id="ai-tone" value={form.tone} onChange={(e) => set('tone', e.target.value as AiSettings['tone'])}>
                  {AI_TONES.map((t) => (
                    <option key={t} value={t}>
                      {AI_TONE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Personalidade" htmlFor="ai-personality" optional error={errors.personality}>
              <Textarea id="ai-personality" rows={2} maxLength={400} placeholder="Ex.: animada, usa poucos emojis, chama o cliente pelo nome." value={form.personality ?? ''} onChange={(e) => set('personality', e.target.value)} />
            </Field>
            <Field label="Saudação" htmlFor="ai-greeting" optional>
              <Textarea id="ai-greeting" rows={2} maxLength={400} placeholder="Ex.: Oi! Aqui é a Bia, da Pizzaria Forno a Lenha. Quer ver o cardápio ou já sabe o que vai pedir?" value={form.greeting ?? ''} onChange={(e) => set('greeting', e.target.value)} />
            </Field>
            <Field label="Mensagem com a loja fechada" htmlFor="ai-away" optional hint="A assistente usa quando alguém escreve fora do horário. O horário vem de Configurações.">
              <Textarea id="ai-away" rows={2} maxLength={400} value={form.awayMessage ?? ''} onChange={(e) => set('awayMessage', e.target.value)} />
            </Field>
          </div>
        </Panel>

        <Panel title="Regras do atendimento" description="Instruções da loja. Preços, produtos, estoque e taxas sempre vêm do sistema, nunca destes textos.">
          <div className="space-y-4">
            <Field label="Instruções gerais" htmlFor="ai-instructions" optional error={errors.instructions}>
              <Textarea id="ai-instructions" rows={4} maxLength={3000} placeholder="Ex.: Sempre pergunte se o cliente quer borda recheada. Pedidos acima de 5 pizzas, passe para a equipe." value={form.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} />
            </Field>
            <Field label="Como vender" htmlFor="ai-sales" optional error={errors.salesRules}>
              <Textarea id="ai-sales" rows={3} maxLength={1500} placeholder="Ex.: Ofereça bebida quando o pedido não tiver. Não insista se o cliente recusar." value={form.salesRules ?? ''} onChange={(e) => set('salesRules', e.target.value)} />
            </Field>
            <Field label="O que ela não pode fazer" htmlFor="ai-restrictions" optional error={errors.restrictions}>
              <Textarea id="ai-restrictions" rows={3} maxLength={1500} placeholder="Ex.: Não prometer horário exato de entrega. Não falar de concorrentes." value={form.restrictions ?? ''} onChange={(e) => set('restrictions', e.target.value)} />
            </Field>
            <p className="rounded-md bg-canvas px-3 py-2.5 text-xs text-muted">
              Regras fixas da plataforma, que valem sempre: nunca inventa produto, preço ou desconto; confere disponibilidade no sistema antes de oferecer; mostra o resumo e pede confirmação antes de registrar; só diz que o pedido foi feito depois que o sistema registra; não confirma pagamento por comprovante.
            </p>
          </div>
        </Panel>

        <Panel title="Produtos para recomendar" description={`Até 10. A assistente sugere estes quando fizer sentido (${recommended.length}/10).`}>
          {catalog.isLoading ? (
            <Skeleton className="h-24" />
          ) : products.length === 0 ? (
            <p className="text-sm text-muted">
              Cadastre produtos no{' '}
              <Link href="/painel/cardapio" className="text-brand hover:underline">
                Cardápio
              </Link>{' '}
              para escolher aqui.
            </p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {products.map((p) => {
                const on = recommended.includes(p.id);
                return (
                  <Checkbox
                    key={p.id}
                    checked={on}
                    disabled={!on && recommended.length >= 10}
                    onChange={(v) => set('recommendedProductIds', v ? [...recommended, p.id] : recommended.filter((x) => x !== p.id))}
                    label={
                      <span>
                        {p.name} <span className="text-xs text-muted">· {p.category}</span>
                      </span>
                    }
                  />
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Quando passar para a equipe" description="A conversa vai para a fila do Atendimento e a equipe recebe um aviso.">
          <div className="space-y-2">
            {HANDOFF_TRIGGERS.map((t) => (
              <Checkbox
                key={t}
                checked={form.handoffTriggers.includes(t)}
                onChange={(v) => set('handoffTriggers', v ? [...form.handoffTriggers, t] : form.handoffTriggers.filter((x: HandoffTrigger) => x !== t))}
                label={HANDOFF_TRIGGER_LABELS[t]}
              />
            ))}
          </div>
          <Field label="Palavras que transferem na hora" htmlFor="ai-kw" optional className="mt-5" hint="Se a mensagem do cliente tiver uma delas, vai direto para a equipe, sem passar pela IA. Enter para adicionar.">
            {form.handoffKeywords.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-1.5">
                {form.handoffKeywords.map((k) => (
                  <li key={k} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs">
                    {k}
                    {!disabled && (
                      <button type="button" onClick={() => set('handoffKeywords', form.handoffKeywords.filter((x) => x !== k))} aria-label={`Remover ${k}`} className="text-muted hover:text-ink">
                        <X className="size-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Input
              id="ai-kw"
              maxLength={40}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              onBlur={addKeyword}
            />
          </Field>
        </Panel>

        <Panel
          title="Perguntas frequentes"
          description="Respostas da loja para dúvidas comuns (estacionamento, alergênicos, eventos). A assistente usa estas respostas como estão."
          actions={
            !disabled && (
              <Button type="button" variant="secondary" size="sm" icon={<Plus className="size-4" />} disabled={form.faq.length >= 60} onClick={() => set('faq', [...form.faq, { question: '', answer: '' }])}>
                Adicionar
              </Button>
            )
          }
        >
          {form.faq.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma pergunta cadastrada.</p>
          ) : (
            <ol className="space-y-4">
              {form.faq.map((f, i) => (
                <li key={i} className="grid gap-2 rounded-lg border border-line p-3">
                  <div className="flex items-start gap-2">
                    <Field label="Pergunta" htmlFor={`faq-q-${i}`} className="flex-1" error={errors[`faq.${i}.question`]}>
                      <Input id={`faq-q-${i}`} maxLength={300} value={f.question} onChange={(e) => set('faq', form.faq.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} invalid={!!errors[`faq.${i}.question`]} />
                    </Field>
                    {!disabled && (
                      <Button type="button" variant="ghost" size="icon-sm" className="mt-6" aria-label="Remover pergunta" onClick={() => set('faq', form.faq.filter((_, j) => j !== i))}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                  <Field label="Resposta" htmlFor={`faq-a-${i}`} error={errors[`faq.${i}.answer`]}>
                    <Textarea id={`faq-a-${i}`} rows={2} maxLength={1500} value={f.answer} onChange={(e) => set('faq', form.faq.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} invalid={!!errors[`faq.${i}.answer`]} />
                  </Field>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        {!disabled && (
          <div className="sticky bottom-4 z-10 flex justify-end">
            <Button type="submit" loading={save.isPending} className="shadow-pop">
              Salvar assistente
            </Button>
          </div>
        )}
      </fieldset>
      {disabled && <p className="mt-4 text-sm text-muted">Somente quem administra o assistente pode alterar estas configurações.</p>}
    </form>
  );
}

interface TestTurn {
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: { name: string; input: unknown; output: unknown; isError: boolean }[];
  handoff?: string | null;
}

const TOOL_LABELS: Record<string, string> = {
  consultar_produto: 'Consultou o cardápio',
  montar_pedido: 'Montou o pedido',
  registrar_pedido: 'Tentou registrar o pedido',
  consultar_pedidos: 'Consultou pedidos do cliente',
  transferir_para_humano: 'Transferiu para a equipe',
};

function TestChat({ available, name }: { available: boolean; name: string }) {
  const [turns, setTurns] = useState<TestTurn[]>([]);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const send = useMutation({
    mutationFn: (history: TestTurn[]) =>
      post<{ reply: string | null; handoff: string | null; toolCalls: TestTurn['toolCalls'] }>('/ai/test', { messages: history.map((t) => ({ role: t.role, text: t.text })) }),
    onSuccess: (r) => setTurns((t) => [...t, { role: 'assistant', text: r.reply ?? '(sem resposta)', toolCalls: r.toolCalls, handoff: r.handoff }]),
  });

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [turns, send.isPending]);

  const submit = () => {
    const msg = text.trim();
    if (!msg || send.isPending) return;
    // A conversa precisa alternar cliente/assistente; se a última resposta falhou, substitui a pergunta pendente.
    const base = turns.at(-1)?.role === 'user' ? turns.slice(0, -1) : turns;
    const next = [...base, { role: 'user' as const, text: msg }];
    setTurns(next);
    setText('');
    send.mutate(next);
  };

  return (
    <Panel
      title="Testar conversa"
      description="Usa a IA de verdade, com o cardápio e as configurações salvas. No teste, nenhum pedido é registrado e nada é enviado ao cliente."
      actions={
        turns.length > 0 && (
          <Button variant="ghost" size="icon-sm" aria-label="Recomeçar teste" onClick={() => { setTurns([]); send.reset(); }}>
            <RotateCcw className="size-4" />
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      <div className="h-[420px] space-y-3 overflow-y-auto bg-canvas px-4 py-4">
        {turns.length === 0 && <p className="py-10 text-center text-sm text-muted">{available ? 'Escreva como se fosse um cliente. Ex.: “Quais pizzas vocês têm?”' : 'Disponível quando a chave da Anthropic estiver configurada no servidor.'}</p>}
        {turns.map((t, i) => (
          <div key={i} className={cx('flex flex-col', t.role === 'user' ? 'items-end' : 'items-start')}>
            {t.role === 'assistant' && (
              <p className="mb-0.5 flex items-center gap-1 text-2xs font-semibold text-brand">
                <Bot className="size-3" /> {name}
              </p>
            )}
            <div className={cx('max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm', t.role === 'user' ? 'rounded-br-md bg-ink text-surface' : 'rounded-bl-md border border-line bg-surface')}>{t.text}</div>
            {t.handoff && <p className="mt-1 text-xs text-warn">Passaria para a equipe: {t.handoff}</p>}
            {t.toolCalls && t.toolCalls.length > 0 && <ToolCalls calls={t.toolCalls} />}
          </div>
        ))}
        {send.isPending && <p className="text-xs text-muted">{name} está escrevendo…</p>}
        {send.error && <p className="text-xs text-danger">{errorMessage(send.error)}</p>}
        <div ref={end} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          rows={1}
          value={text}
          maxLength={2000}
          disabled={!available}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          aria-label="Mensagem de teste"
          placeholder="Mensagem do cliente"
          className="min-h-10"
        />
        <Button type="submit" size="icon" aria-label="Enviar" loading={send.isPending} disabled={!available || !text.trim() || turns.length >= 39}>
          <Send className="size-4" />
        </Button>
      </form>
    </Panel>
  );
}

function ToolCalls({ calls }: { calls: NonNullable<TestTurn['toolCalls']> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 max-w-[88%]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-2xs text-muted hover:text-ink" aria-expanded={open}>
        <Wrench className="size-3" /> {calls.map((c) => TOOL_LABELS[c.name] ?? c.name).join(' · ')}
        <ChevronDown className={cx('size-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="mt-1 space-y-1.5">
          {calls.map((c, i) => (
            <li key={i} className={cx('rounded-md border px-2.5 py-2 text-2xs', c.isError ? 'border-danger/30 bg-danger-soft' : 'border-line bg-surface')}>
              <p className="font-semibold">{c.name}</p>
              <pre className="num mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-muted">{JSON.stringify({ entrada: c.input, resultado: c.output }, null, 2)}</pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Usage({ usage, model }: { usage: NonNullable<AiResponse['usage30d']>; model: string | null }) {
  const fmt = new Intl.NumberFormat('pt-BR');
  return (
    <Panel title="Uso nos últimos 30 dias" description={model ? `Modelo: ${model}` : undefined}>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Respostas a clientes</dt>
          <dd className="num mt-0.5 text-lg font-semibold">{fmt.format(usage.replies)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Conversas de teste</dt>
          <dd className="num mt-0.5 text-lg font-semibold">{fmt.format(usage.tests)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Tokens de entrada</dt>
          <dd className="num mt-0.5">{fmt.format(usage.inputTokens)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Tokens de saída</dt>
          <dd className="num mt-0.5">{fmt.format(usage.outputTokens)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted">Lidos do cache</dt>
          <dd className="num mt-0.5">{fmt.format(usage.cacheReadTokens)}</dd>
        </div>
      </dl>
    </Panel>
  );
}
