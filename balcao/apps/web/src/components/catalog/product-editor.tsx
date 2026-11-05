'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { describeGroupRule, productSchema } from '@balcao/shared';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, MoneyInput, Select, Switch, Textarea } from '@/components/ui/field';
import { ImageUpload } from '@/components/ui/image-upload';
import { Modal } from '@/components/ui/modal';
import { ErrorNotice } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { ApiError, post, put } from '@/lib/api';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { keys } from '@/lib/queries';
import type { AdminCatalog, Product } from '@/lib/types';

export function ProductEditor({
  catalog,
  product,
  defaultCategoryId,
  onClose,
}: {
  catalog: AdminCatalog;
  product: Product | null;
  defaultCategoryId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({
    categoryId: product?.categoryId ?? defaultCategoryId ?? catalog.categories[0]?.id ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    imageUrl: product?.imageUrl ?? null,
    priceCents: product?.priceCents ?? (null as number | null),
    sku: product?.sku ?? '',
    prepTimeMinutes: product?.prepTimeMinutes ?? (null as number | null),
    isFeatured: product?.isFeatured ?? false,
    isActive: product?.isActive ?? true,
    isAvailable: product?.isAvailable ?? true,
    trackStock: product?.trackStock ?? false,
    stockQuantity: product?.stockQuantity ?? (null as number | null),
    modifierGroupIds: product?.modifierGroupIds ?? [],
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: (body: unknown) => (product ? put<Product>(`/catalog/products/${product.id}`, body) : post<Product>('/catalog/products', body)),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: keys.catalog });
      toast(product ? `“${p.name}” salvo.` : `“${p.name}” adicionado ao cardápio.`);
      onClose();
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });

  const submit = () => {
    const body = {
      ...form,
      description: form.description || null,
      sku: form.sku || null,
      priceCents: form.priceCents ?? undefined,
    };
    const v = validate(productSchema, body);
    setErrors(v.ok ? {} : v.errors);
    if (v.ok) save.mutate(body);
  };

  const groups = catalog.modifierGroups;
  const selected = form.modifierGroupIds;
  const move = (id: string, dir: -1 | 1) => {
    const i = selected.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set('modifierGroupIds', next);
  };

  return (
    <Modal
      open
      onClose={onClose}
      side="right"
      size="lg"
      title={product ? 'Editar produto' : 'Novo produto'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {product ? 'Salvar produto' : 'Adicionar produto'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="space-y-6 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {save.error && !Object.keys(serverFieldErrors(save.error)).length && <ErrorNotice message={(save.error as ApiError).message} />}
        <div className="flex flex-col gap-5 sm:flex-row">
          <ImageUpload value={form.imageUrl} onChange={(url) => set('imageUrl', url)} label="Foto do produto" />
          <div className="min-w-0 flex-1 space-y-4">
            <Field label="Nome" htmlFor="p-name" error={errors.name}>
              <Input id="p-name" value={form.name} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} autoFocus={!product} maxLength={80} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Preço" htmlFor="p-price" error={errors.priceCents} hint="Preço base, sem adicionais">
                <MoneyInput id="p-price" value={form.priceCents} onChange={(v) => set('priceCents', v)} allowEmpty invalid={!!errors.priceCents} />
              </Field>
              <Field label="Categoria" htmlFor="p-category" error={errors.categoryId}>
                <Select id="p-category" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)} invalid={!!errors.categoryId}>
                  {catalog.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </div>

        <Field label="Descrição" htmlFor="p-desc" optional error={errors.description} hint="Ingredientes, tamanho, para quantas pessoas.">
          <Textarea id="p-desc" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={600} />
        </Field>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Adicionais e opções</h3>
            <p className="text-[0.8125rem] text-muted">Escolha os grupos que aparecem neste produto, na ordem em que o cliente vê.</p>
          </div>
          {groups.length === 0 ? (
            <p className="rounded-md bg-canvas px-3 py-3 text-[0.8125rem] text-muted">Nenhum grupo criado ainda. Crie em Cardápio › Adicionais.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {[...selected.map((id) => groups.find((g) => g.id === id)!).filter(Boolean), ...groups.filter((g) => !selected.includes(g.id))].map((g) => {
                const on = selected.includes(g.id);
                const idx = selected.indexOf(g.id);
                return (
                  <li key={g.id} className="flex items-center gap-3 px-3 py-2.5">
                    <Checkbox
                      className="flex-1"
                      checked={on}
                      onChange={(v) => set('modifierGroupIds', v ? [...selected, g.id] : selected.filter((x) => x !== g.id))}
                      label={
                        <>
                          {g.name}
                          {!g.isActive && <span className="ml-2 text-xs text-muted">(inativo)</span>}
                        </>
                      }
                      description={`${describeGroupRule(g)} · ${g.options.length} ${g.options.length === 1 ? 'opção' : 'opções'}`}
                    />
                    {on && (
                      <span className="flex gap-0.5">
                        <button type="button" className="grid size-7 place-items-center rounded text-muted hover:bg-sunken disabled:opacity-30" disabled={idx === 0} onClick={() => move(g.id, -1)} aria-label={`Subir ${g.name}`}>
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button type="button" className="grid size-7 place-items-center rounded text-muted hover:bg-sunken disabled:opacity-30" disabled={idx === selected.length - 1} onClick={() => move(g.id, 1)} aria-label={`Descer ${g.name}`}>
                          <ArrowDown className="size-3.5" />
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {errors.modifierGroupIds && <p className="text-[0.8125rem] text-danger">{errors.modifierGroupIds}</p>}
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Disponibilidade</h3>
          <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} label="Mostrar no cardápio" description="Desligado, o produto fica guardado e some para os clientes." />
          <Switch checked={form.isAvailable} onChange={(v) => set('isAvailable', v)} label="Disponível para pedido" description="Desligue quando acabar temporariamente. Ele aparece como indisponível." />
          <Switch checked={form.isFeatured} onChange={(v) => set('isFeatured', v)} label="Destaque" description="Aparece no topo do cardápio." />
          <Switch checked={form.trackStock} onChange={(v) => set('trackStock', v)} label="Controlar quantidade" description="Cada pedido desconta do estoque; ao zerar, o produto fica esgotado. Cancelamentos devolvem." />
          {form.trackStock && (
            <Field label="Quantidade em estoque" htmlFor="p-stock" error={errors.stockQuantity} className="max-w-48">
              <Input
                id="p-stock"
                type="number"
                inputMode="numeric"
                min={0}
                className="num"
                value={form.stockQuantity ?? ''}
                onChange={(e) => set('stockQuantity', e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))))}
                invalid={!!errors.stockQuantity}
              />
            </Field>
          )}
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Código interno (SKU)" htmlFor="p-sku" optional error={errors.sku}>
            <Input id="p-sku" value={form.sku} onChange={(e) => set('sku', e.target.value)} maxLength={40} invalid={!!errors.sku} />
          </Field>
          <Field label="Tempo de preparo (min)" htmlFor="p-prep" optional hint="Usado pela cozinha.">
            <Input
              id="p-prep"
              type="number"
              inputMode="numeric"
              min={0}
              max={240}
              className="num"
              value={form.prepTimeMinutes ?? ''}
              onChange={(e) => set('prepTimeMinutes', e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))))}
            />
          </Field>
        </section>
      </form>
    </Modal>
  );
}
