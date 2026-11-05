'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { quickReplySchema } from '@balcao/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { del, errorMessage, get, post, put } from '@/lib/api';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import type { QuickReply } from '@/lib/inbox';

const KEY = ['inbox', 'quick-replies'];

export function QuickRepliesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const list = useQuery({ queryKey: KEY, queryFn: ({ signal }) => get<QuickReply[]>('/inbox/quick-replies', signal) });
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [form, setForm] = useState({ title: '', body: '' });
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: (body: typeof form) => (editing ? put(`/inbox/quick-replies/${editing.id}`, body) : post('/inbox/quick-replies', body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast(editing ? 'Resposta rápida salva.' : 'Resposta rápida criada.');
      setEditing(null);
      setForm({ title: '', body: '' });
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/inbox/quick-replies/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const submit = () => {
    const body = { title: form.title.replace(/^\//, ''), body: form.body };
    const v = validate(quickReplySchema, body);
    setErrors(v.ok ? {} : v.errors);
    if (v.ok) save.mutate(body);
  };

  return (
    <Modal open onClose={onClose} side="right" size="md" title="Respostas rápidas" description="Textos prontos para a equipe. No campo de mensagem, digite / e o atalho. Use {cliente} para o primeiro nome.">
      <form
        className="space-y-3 rounded-lg border border-line p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Atalho" htmlFor="qr-title" error={errors.title}>
          <Input id="qr-title" prefix="/" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={60} placeholder="horario" invalid={!!errors.title} />
        </Field>
        <Field label="Texto" htmlFor="qr-body" error={errors.body}>
          <Textarea id="qr-body" rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} maxLength={2000} placeholder="Oi, {cliente}! Funcionamos de terça a domingo, das 18h às 23h." invalid={!!errors.body} />
        </Field>
        <div className="flex justify-end gap-2">
          {editing && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditing(null);
                setForm({ title: '', body: '' });
                setErrors({});
              }}
            >
              Cancelar edição
            </Button>
          )}
          <Button type="submit" loading={save.isPending}>
            {editing ? 'Salvar' : 'Adicionar'}
          </Button>
        </div>
      </form>

      <div className="mt-5">
        {list.isLoading ? (
          <Skeleton className="h-24" />
        ) : list.data?.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {list.data.map((r) => (
              <li key={r.id} className="flex items-start gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">/{r.title}</p>
                  <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted">{r.body}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Editar /${r.title}`}
                  onClick={() => {
                    setEditing(r);
                    setForm({ title: r.title, body: r.body });
                    setErrors({});
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Excluir /${r.title}`}
                  onClick={async () => {
                    const c = await confirm({ title: `Excluir a resposta /${r.title}?`, confirmLabel: 'Excluir', tone: 'danger' });
                    if (c.confirmed) remove.mutate(r.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-muted">Nenhuma resposta rápida cadastrada.</p>
        )}
      </div>
    </Modal>
  );
}
