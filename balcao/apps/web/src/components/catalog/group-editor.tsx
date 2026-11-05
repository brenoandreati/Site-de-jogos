'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { describeGroupRule, modifierGroupSchema } from '@balcao/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyInput, Switch } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { ErrorNotice } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { ApiError, post, put } from '@/lib/api';
import { cx } from '@/lib/format';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { keys } from '@/lib/queries';
import type { ModifierGroup } from '@/lib/types';

interface OptionDraft {
  id?: string;
  key: string;
  name: string;
  priceCents: number | null;
  maxQuantity: number;
  isAvailable: boolean;
}

const PRESETS = [
  { label: 'Escolha única obrigatória', hint: 'Tamanho, sabor, ponto da carne', min: 1, max: 1 },
  { label: 'Opcional, várias', hint: 'Adicionais, acompanhamentos', min: 0, max: 5 },
  { label: 'Obrigatório, várias', hint: 'Ex.: escolha 3 frutas', min: 3, max: 3 },
] as const;

let keySeq = 0;
const newKey = () => `opt-${++keySeq}`;

export function GroupEditor({ group, onClose }: { group: ModifierGroup | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [minSelect, setMin] = useState(group?.minSelect ?? 1);
  const [maxSelect, setMax] = useState(group?.maxSelect ?? 1);
  const [isActive, setActive] = useState(group?.isActive ?? true);
  const [options, setOptions] = useState<OptionDraft[]>(
    group?.options.map((o) => ({ id: o.id, key: o.id, name: o.name, priceCents: o.priceCents, maxQuantity: o.maxQuantity, isAvailable: o.isAvailable })) ?? [
      { key: newKey(), name: '', priceCents: 0, maxQuantity: 1, isAvailable: true },
    ],
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: (body: unknown) => (group ? put<ModifierGroup>(`/catalog/modifier-groups/${group.id}`, body) : post<ModifierGroup>('/catalog/modifier-groups', body)),
    onSuccess: (g) => {
      void qc.invalidateQueries({ queryKey: keys.catalog });
      toast(group ? `Grupo “${g.name}” salvo.` : `Grupo “${g.name}” criado. Agora vincule aos produtos.`);
      onClose();
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });

  const body = () => ({
    name,
    description: description || null,
    minSelect,
    maxSelect,
    isActive,
    options: options
      .filter((o) => o.name.trim() || o.id)
      .map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents ?? 0, maxQuantity: o.maxQuantity, isAvailable: o.isAvailable })),
  });

  const submit = () => {
    const b = body();
    const v = validate(modifierGroupSchema, b);
    setErrors(v.ok ? {} : v.errors);
    if (v.ok) save.mutate(b);
  };

  const update = (key: string, patch: Partial<OptionDraft>) => setOptions((list) => list.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  const move = (i: number, dir: -1 | 1) =>
    setOptions((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  return (
    <Modal
      open
      onClose={onClose}
      side="right"
      size="lg"
      title={group ? 'Editar grupo de adicionais' : 'Novo grupo de adicionais'}
      description={group?.productCount ? `Usado em ${group.productCount} ${group.productCount === 1 ? 'produto' : 'produtos'}. As mudanças valem para todos.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {group ? 'Salvar grupo' : 'Criar grupo'}
          </Button>
        </>
      }
    >
      <div className="space-y-6 pb-2">
        {save.error && !Object.keys(serverFieldErrors(save.error)).length && <ErrorNotice message={(save.error as ApiError).message} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do grupo" htmlFor="g-name" error={errors.name} hint="O cliente vê este título. Ex.: Escolha o tamanho">
            <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} autoFocus={!group} maxLength={60} />
          </Field>
          <Field label="Instrução" htmlFor="g-desc" optional>
            <Input id="g-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={160} placeholder="Ex.: acompanha 2 molhos" />
          </Field>
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Regra de escolha</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {PRESETS.map((p) => {
              const on = minSelect === p.min && maxSelect === p.max;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setMin(p.min);
                    setMax(p.max);
                  }}
                  className={cx('rounded-md border px-3 py-2.5 text-left transition-colors', on ? 'border-brand bg-brand-soft' : 'border-line-strong hover:border-ink/30')}
                >
                  <span className="block text-[0.8125rem] font-medium text-ink">{p.label}</span>
                  <span className="block text-xs text-muted">{p.hint}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 grid max-w-sm grid-cols-2 gap-3">
            <Field label="Mínimo" htmlFor="g-min" error={errors.minSelect} hint="0 = opcional">
              <Input id="g-min" type="number" min={0} max={50} className="num" value={minSelect} onChange={(e) => setMin(Math.max(0, Math.floor(Number(e.target.value) || 0)))} invalid={!!errors.minSelect} />
            </Field>
            <Field label="Máximo" htmlFor="g-max" error={errors.maxSelect}>
              <Input id="g-max" type="number" min={1} max={50} className="num" value={maxSelect} onChange={(e) => setMax(Math.max(1, Math.floor(Number(e.target.value) || 1)))} invalid={!!errors.maxSelect} />
            </Field>
          </div>
          <p className="mt-2 text-[0.8125rem] text-muted">
            O cliente verá: <span className="font-medium text-ink-2">{describeGroupRule({ minSelect, maxSelect })}</span>
          </p>
        </section>

        <section>
          <div className="mb-2 flex items-end justify-between">
            <div>
              <h3 className="text-sm font-semibold">Opções</h3>
              <p className="text-[0.8125rem] text-muted">Preço extra 0,00 para opções sem custo. “Máx.” permite repetir (ex.: 2× bacon).</p>
            </div>
          </div>
          {errors.options && <p className="mb-2 text-[0.8125rem] text-danger">{errors.options}</p>}
          <div className="mb-1.5 hidden grid-cols-[minmax(0,1fr)_120px_64px_auto] gap-2 px-2.5 text-2xs font-medium text-faint sm:grid" aria-hidden="true">
            <span>Opção</span>
            <span>Preço extra</span>
            <span>Máx.</span>
            <span className="w-[136px]">Disponível</span>
          </div>
          <ul className="space-y-2">
            {options.map((o, i) => (
              <li key={o.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-line p-2.5 sm:grid-cols-[minmax(0,1fr)_120px_64px_auto]">
                <Input aria-label="Nome da opção" placeholder="Nome da opção" value={o.name} onChange={(e) => update(o.key, { name: e.target.value })} invalid={!!errors[`options.${i}.name`]} maxLength={60} />
                <div className="sm:order-none">
                  <MoneyInput aria-label="Preço extra" value={o.priceCents} onChange={(v) => update(o.key, { priceCents: v })} />
                </div>
                <Input
                  aria-label="Quantidade máxima por opção"
                  title="Quantas vezes o cliente pode escolher esta opção"
                  type="number"
                  min={1}
                  max={20}
                  className="num"
                  value={o.maxQuantity}
                  onChange={(e) => update(o.key, { maxQuantity: Math.min(20, Math.max(1, Math.floor(Number(e.target.value) || 1))) })}
                />
                <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <Switch checked={o.isAvailable} onChange={(v) => update(o.key, { isAvailable: v })} />
                    <span className="sm:sr-only">Disponível</span>
                  </label>
                  <span className="flex">
                    <button type="button" className="grid size-8 place-items-center rounded text-muted hover:bg-sunken disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir opção">
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button type="button" className="grid size-8 place-items-center rounded text-muted hover:bg-sunken disabled:opacity-30" disabled={i === options.length - 1} onClick={() => move(i, 1)} aria-label="Descer opção">
                      <ArrowDown className="size-3.5" />
                    </button>
                    <button type="button" className="grid size-8 place-items-center rounded text-muted hover:bg-danger-soft hover:text-danger" onClick={() => setOptions((list) => list.filter((x) => x.key !== o.key))} aria-label="Remover opção">
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            icon={<Plus className="size-4" />}
            onClick={() => setOptions((list) => [...list, { key: newKey(), name: '', priceCents: 0, maxQuantity: 1, isAvailable: true }])}
          >
            Adicionar opção
          </Button>
        </section>

        <Switch checked={isActive} onChange={setActive} label="Grupo ativo" description="Desligado, o grupo some de todos os produtos sem perder a configuração." />
      </div>
    </Modal>
  );
}
