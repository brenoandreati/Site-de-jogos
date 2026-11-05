'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, ExternalLink, FolderPlus, Layers, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { categorySchema, describeGroupRule, formatBRL, hasAccess } from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { GroupEditor } from '@/components/catalog/group-editor';
import { ProductEditor } from '@/components/catalog/product-editor';
import { ProductThumb } from '@/components/catalog/product-configurator';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input, Segmented, Switch, Textarea } from '@/components/ui/field';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { Modal } from '@/components/ui/modal';
import { Badge, EmptyState, ErrorNotice, PageHeader, Skeleton } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { del, errorMessage, patch, post, put } from '@/lib/api';
import { cx } from '@/lib/format';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { keys, useCatalog } from '@/lib/queries';
import type { AdminCatalog, Category, ModifierGroup, Product } from '@/lib/types';

export default function CatalogPage() {
  const { me } = useAdmin();
  const perms = me.active!.permissions;
  const canEdit = hasAccess(perms, 'catalog', 'edit');
  const canManage = hasAccess(perms, 'catalog', 'manage');
  const catalog = useCatalog();
  const [tab, setTab] = useState<'products' | 'groups'>('products');
  const [editingProduct, setEditingProduct] = useState<{ product: Product | null; categoryId?: string } | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | 'new' | null>(null);
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | 'new' | null>(null);

  return (
    <div>
      <PageHeader
        title="Cardápio"
        description="O que você cadastra aqui aparece no cardápio digital na hora."
        actions={
          <>
            <ButtonLink href={`/${me.active!.tenant.slug}`} external variant="ghost" icon={<ExternalLink className="size-4" />}>
              Ver como cliente
            </ButtonLink>
            {canEdit && tab === 'products' && (
              <>
                <Button variant="secondary" icon={<FolderPlus className="size-4" />} onClick={() => setEditingCategory('new')}>
                  Nova categoria
                </Button>
                <Button icon={<Plus className="size-4" />} disabled={!catalog.data?.categories.length} onClick={() => setEditingProduct({ product: null })}>
                  Novo produto
                </Button>
              </>
            )}
            {canEdit && tab === 'groups' && (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditingGroup('new')}>
                Novo grupo
              </Button>
            )}
          </>
        }
      />

      <Segmented
        className="mb-5"
        aria-label="Seção do cardápio"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'products', label: `Produtos${catalog.data ? ` (${catalog.data.categories.reduce((s, c) => s + c.products.length, 0)})` : ''}` },
          { value: 'groups', label: `Adicionais${catalog.data ? ` (${catalog.data.modifierGroups.length})` : ''}` },
        ]}
      />

      {catalog.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : catalog.error ? (
        <ErrorNotice message={catalog.error.message} onRetry={() => void catalog.refetch()} />
      ) : tab === 'products' ? (
        <ProductsView
          catalog={catalog.data!}
          canEdit={canEdit}
          canManage={canManage}
          onEditProduct={(product, categoryId) => setEditingProduct({ product, categoryId })}
          onEditCategory={setEditingCategory}
        />
      ) : (
        <GroupsView catalog={catalog.data!} canEdit={canEdit} canManage={canManage} onEdit={setEditingGroup} />
      )}

      {editingProduct && catalog.data && (
        <ProductEditor catalog={catalog.data} product={editingProduct.product} defaultCategoryId={editingProduct.categoryId} onClose={() => setEditingProduct(null)} />
      )}
      {editingCategory && <CategoryModal category={editingCategory === 'new' ? null : editingCategory} onClose={() => setEditingCategory(null)} />}
      {editingGroup && <GroupEditor group={editingGroup === 'new' ? null : editingGroup} onClose={() => setEditingGroup(null)} />}
    </div>
  );
}

function ProductsView({
  catalog,
  canEdit,
  canManage,
  onEditProduct,
  onEditCategory,
}: {
  catalog: AdminCatalog;
  canEdit: boolean;
  canManage: boolean;
  onEditProduct: (p: Product | null, categoryId?: string) => void;
  onEditCategory: (c: Category | 'new') => void;
}) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.catalog });
  const onError = (e: unknown) => toast(errorMessage(e), 'error');

  const availability = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) => patch<Product>(`/catalog/products/${id}/availability`, { isAvailable }),
    onMutate: ({ id, isAvailable }) => {
      qc.setQueryData<AdminCatalog>(keys.catalog, (old) =>
        old ? { ...old, categories: old.categories.map((c) => ({ ...c, products: c.products.map((p) => (p.id === id ? { ...p, isAvailable } : p)) })) } : old,
      );
    },
    onSuccess: (p) => toast(p.isAvailable ? `“${p.name}” disponível.` : `“${p.name}” pausado no cardápio.`),
    onError: (e) => {
      onError(e);
      refresh();
    },
  });
  const reorderCategories = useMutation({ mutationFn: (ids: string[]) => post('/catalog/categories/reorder', { ids }), onSuccess: refresh, onError });
  const reorderProducts = useMutation({ mutationFn: (ids: string[]) => post('/catalog/products/reorder', { ids }), onSuccess: refresh, onError });
  const duplicate = useMutation({
    mutationFn: (id: string) => post<Product>(`/catalog/products/${id}/duplicate`),
    onSuccess: (p) => {
      refresh();
      toast(`Cópia criada como inativa: “${p.name}”.`);
    },
    onError,
  });
  const removeProduct = useMutation({
    mutationFn: (id: string) => del(`/catalog/products/${id}`),
    onSuccess: () => {
      refresh();
      toast('Produto excluído.');
    },
    onError,
  });
  const removeCategory = useMutation({
    mutationFn: (id: string) => del(`/catalog/categories/${id}`),
    onSuccess: () => {
      refresh();
      toast('Categoria excluída.');
    },
    onError,
  });

  const swap = <T,>(list: T[], i: number, j: number) => {
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  };

  if (catalog.categories.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <EmptyState
          icon={<Layers className="size-5" />}
          title="Comece pelas categorias"
          description="Organize o cardápio como o cliente procura: Açaí, Lanches, Bebidas, Sobremesas…"
          action={canEdit && <Button icon={<FolderPlus className="size-4" />} onClick={() => onEditCategory('new')}>Criar a primeira categoria</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {catalog.categories.map((category, ci) => (
        <section key={category.id} aria-labelledby={`cat-${category.id}`} className="overflow-hidden rounded-lg border border-line bg-surface">
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 id={`cat-${category.id}`} className="flex items-center gap-2 font-semibold">
                {category.name}
                {!category.isActive && <Badge>Oculta</Badge>}
              </h2>
              {category.description && <p className="truncate text-[0.8125rem] text-muted">{category.description}</p>}
            </div>
            <span className="text-xs text-muted tabular">{category.products.length} {category.products.length === 1 ? 'produto' : 'produtos'}</span>
            {canEdit && (
              <>
                <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => onEditProduct(null, category.id)} className="hidden sm:inline-flex">
                  Produto
                </Button>
                <Menu
                  label={`Ações da categoria ${category.name}`}
                  trigger={({ toggle, open }) => (
                    <Button variant="ghost" size="icon-sm" onClick={toggle} aria-expanded={open} aria-label={`Ações da categoria ${category.name}`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem icon={<Pencil />} onClick={() => { close(); onEditCategory(category); }}>Editar categoria</MenuItem>
                      <MenuItem icon={<Plus />} onClick={() => { close(); onEditProduct(null, category.id); }}>Adicionar produto</MenuItem>
                      <MenuItem icon={<ArrowUp />} disabled={ci === 0} onClick={() => { close(); reorderCategories.mutate(swap(catalog.categories.map((c) => c.id), ci, ci - 1)); }}>Mover para cima</MenuItem>
                      <MenuItem icon={<ArrowDown />} disabled={ci === catalog.categories.length - 1} onClick={() => { close(); reorderCategories.mutate(swap(catalog.categories.map((c) => c.id), ci, ci + 1)); }}>Mover para baixo</MenuItem>
                      {canManage && (
                        <>
                          <MenuSeparator />
                          <MenuItem
                            icon={<Trash2 />}
                            tone="danger"
                            onClick={async () => {
                              close();
                              const r = await confirm({ title: `Excluir a categoria “${category.name}”?`, description: 'Só é possível excluir categorias sem produtos.', confirmLabel: 'Excluir categoria', tone: 'danger' });
                              if (r.confirmed) removeCategory.mutate(category.id);
                            }}
                          >
                            Excluir categoria
                          </MenuItem>
                        </>
                      )}
                    </>
                  )}
                </Menu>
              </>
            )}
          </header>
          {category.products.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              Nenhum produto nesta categoria.{' '}
              {canEdit && (
                <button type="button" className="font-medium text-brand hover:underline" onClick={() => onEditProduct(null, category.id)}>
                  Adicionar produto
                </button>
              )}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {category.products.map((p, pi) => {
                const groups = p.modifierGroupIds.map((id) => catalog.modifierGroups.find((g) => g.id === id)?.name).filter(Boolean);
                return (
                  <li key={p.id} className={cx('flex items-center gap-3 px-4 py-3', !p.isActive && 'bg-canvas/60')}>
                    <ProductThumb src={p.imageUrl} className="size-12" />
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => canEdit && onEditProduct(p)} disabled={!canEdit}>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={cx('font-medium', !p.isActive && 'text-muted')}>{p.name}</span>
                        {p.isFeatured && <Star className="size-3.5 fill-warn text-warn" aria-label="Destaque" />}
                        {!p.isActive && <Badge>Oculto</Badge>}
                        {p.isSoldOut && <Badge tone="danger">Esgotado</Badge>}
                        {p.trackStock && !p.isSoldOut && <Badge tone="outline"><span className="num">{p.stockQuantity}</span>&nbsp;em estoque</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{groups.length ? groups.join(' · ') : p.description ?? 'Sem adicionais'}</span>
                    </button>
                    <span className="num hidden w-24 text-right text-sm sm:block">{formatBRL(p.priceCents)}</span>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <span className="hidden text-xs text-muted md:inline">{p.isAvailable ? 'Disponível' : 'Pausado'}</span>
                        <Switch checked={p.isAvailable} onChange={(v) => availability.mutate({ id: p.id, isAvailable: v })} />
                        <Menu
                          label={`Ações de ${p.name}`}
                          trigger={({ toggle, open }) => (
                            <Button variant="ghost" size="icon-sm" onClick={toggle} aria-expanded={open} aria-label={`Ações de ${p.name}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          )}
                        >
                          {(close) => (
                            <>
                              <MenuItem icon={<Pencil />} onClick={() => { close(); onEditProduct(p); }}>Editar</MenuItem>
                              <MenuItem icon={<Copy />} onClick={() => { close(); duplicate.mutate(p.id); }}>Duplicar</MenuItem>
                              <MenuItem icon={<ArrowUp />} disabled={pi === 0} onClick={() => { close(); reorderProducts.mutate(swap(category.products.map((x) => x.id), pi, pi - 1)); }}>Mover para cima</MenuItem>
                              <MenuItem icon={<ArrowDown />} disabled={pi === category.products.length - 1} onClick={() => { close(); reorderProducts.mutate(swap(category.products.map((x) => x.id), pi, pi + 1)); }}>Mover para baixo</MenuItem>
                              {canManage && (
                                <>
                                  <MenuSeparator />
                                  <MenuItem
                                    icon={<Trash2 />}
                                    tone="danger"
                                    onClick={async () => {
                                      close();
                                      const r = await confirm({ title: `Excluir “${p.name}”?`, description: 'Ele sai do cardápio. Pedidos antigos continuam mostrando o produto normalmente.', confirmLabel: 'Excluir produto', tone: 'danger' });
                                      if (r.confirmed) removeProduct.mutate(p.id);
                                    }}
                                  >
                                    Excluir
                                  </MenuItem>
                                </>
                              )}
                            </>
                          )}
                        </Menu>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function GroupsView({ catalog, canEdit, canManage, onEdit }: { catalog: AdminCatalog; canEdit: boolean; canManage: boolean; onEdit: (g: ModifierGroup) => void }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const remove = useMutation({
    mutationFn: (id: string) => del(`/catalog/modifier-groups/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.catalog });
      toast('Grupo excluído.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (catalog.modifierGroups.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <EmptyState
          icon={<Layers className="size-5" />}
          title="Nenhum grupo de adicionais"
          description="Grupos são as escolhas do produto: tamanho, sabores, acompanhamentos, adicionais pagos. Um mesmo grupo pode ser usado em vários produtos."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {catalog.modifierGroups.map((g) => (
        <article key={g.id} className="flex flex-col rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 font-semibold">
                {g.name}
                {!g.isActive && <Badge>Inativo</Badge>}
              </h3>
              <p className="text-xs text-muted">
                {describeGroupRule(g)} · em {g.productCount} {g.productCount === 1 ? 'produto' : 'produtos'}
              </p>
            </div>
            {canEdit && (
              <Menu
                label={`Ações do grupo ${g.name}`}
                trigger={({ toggle, open }) => (
                  <Button variant="ghost" size="icon-sm" onClick={toggle} aria-expanded={open} aria-label={`Ações do grupo ${g.name}`}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem icon={<Pencil />} onClick={() => { close(); onEdit(g); }}>Editar</MenuItem>
                    {canManage && (
                      <MenuItem
                        icon={<Trash2 />}
                        tone="danger"
                        onClick={async () => {
                          close();
                          const r = await confirm({
                            title: `Excluir o grupo “${g.name}”?`,
                            description: g.productCount ? `Ele será removido de ${g.productCount} produto(s).` : undefined,
                            confirmLabel: 'Excluir grupo',
                            tone: 'danger',
                          });
                          if (r.confirmed) remove.mutate(g.id);
                        }}
                      >
                        Excluir
                      </MenuItem>
                    )}
                  </>
                )}
              </Menu>
            )}
          </div>
          <ul className="mt-3 flex-1 space-y-1 text-[0.8125rem]">
            {g.options.slice(0, 6).map((o) => (
              <li key={o.id} className={cx('flex justify-between gap-3', !o.isAvailable && 'text-faint line-through')}>
                <span className="truncate">{o.name}</span>
                <span className="num shrink-0 text-muted">{o.priceCents ? `+${formatBRL(o.priceCents)}` : '—'}</span>
              </li>
            ))}
            {g.options.length > 6 && <li className="text-xs text-muted">+ {g.options.length - 6} opções</li>}
          </ul>
          {canEdit && (
            <button type="button" className="mt-3 self-start text-[0.8125rem] font-medium text-brand hover:underline" onClick={() => onEdit(g)}>
              Editar grupo
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

function CategoryModal({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({ name: category?.name ?? '', description: category?.description ?? '', isActive: category?.isActive ?? true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: (body: unknown) => (category ? put(`/catalog/categories/${category.id}`, body) : post('/catalog/categories', body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.catalog });
      toast(category ? 'Categoria salva.' : 'Categoria criada.');
      onClose();
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });
  const submit = () => {
    const body = { ...form, description: form.description || null };
    const v = validate(categorySchema, body);
    setErrors(v.ok ? {} : v.errors);
    if (v.ok) save.mutate(body);
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={category ? 'Editar categoria' : 'Nova categoria'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {category ? 'Salvar' : 'Criar categoria'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="space-y-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Nome" htmlFor="c-name" error={errors.name}>
          <Input id="c-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errors.name} maxLength={60} placeholder="Ex.: Açaí no copo" />
        </Field>
        <Field label="Descrição" htmlFor="c-desc" optional>
          <Textarea id="c-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} />
        </Field>
        <Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Mostrar no cardápio" />
      </form>
    </Modal>
  );
}
