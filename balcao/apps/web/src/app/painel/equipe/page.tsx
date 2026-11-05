'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, MoreHorizontal, Pencil, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import {
  ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
  AVAILABLE_MODULES,
  ROLE_DESCRIPTIONS,
  ROLE_DEFAULTS,
  ROLE_LABELS,
  hasAccess,
  inviteMemberSchema,
  type AccessLevel,
  type ModuleKey,
  type PermissionOverrides,
  type Role,
} from '@balcao/shared';
import { useAdmin } from '@/components/admin/admin-context';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Switch } from '@/components/ui/field';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { Modal } from '@/components/ui/modal';
import { Badge, ErrorNotice, PageHeader, Skeleton } from '@/components/ui/misc';
import { useFeedback } from '@/components/ui/feedback';
import { del, errorMessage, get, post, put } from '@/lib/api';
import { cx, formatDateTime, timeAgo } from '@/lib/format';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { keys } from '@/lib/queries';
import type { TeamMember } from '@/lib/types';

interface TeamResponse {
  members: TeamMember[];
  assignableRoles: Role[];
}

export default function TeamPage() {
  const { me } = useAdmin();
  const perms = me.active!.permissions;
  const canEdit = hasAccess(perms, 'team', 'edit');
  const canManage = hasAccess(perms, 'team', 'manage');
  const team = useQuery({ queryKey: keys.team, queryFn: ({ signal }) => get<TeamResponse>('/team', signal) });
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [inviteLink, setInviteLink] = useState<{ url: string; emailSent: boolean; email: string } | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  return (
    <div>
      <PageHeader
        title="Funcionários"
        description="Quem acessa o painel e o que cada pessoa pode ver ou alterar."
        actions={
          <>
            {canManage && (
              <Button variant="ghost" onClick={() => setShowAudit(true)}>
                Registro de atividades
              </Button>
            )}
            {canEdit && (
              <Button icon={<UserPlus className="size-4" />} onClick={() => setInviting(true)}>
                Convidar pessoa
              </Button>
            )}
          </>
        }
      />
      {team.isLoading ? (
        <Skeleton className="h-64" />
      ) : team.error ? (
        <ErrorNotice message={team.error.message} onRetry={() => void team.refetch()} />
      ) : (
        <MembersTable data={team.data!} canEdit={canEdit} canManage={canManage} onEdit={setEditing} onInviteLink={setInviteLink} />
      )}

      {inviting && team.data && (
        <InviteModal
          roles={team.data.assignableRoles}
          canCustomize={me.active!.role === 'owner' || me.active!.role === 'admin'}
          onClose={() => setInviting(false)}
          onInvited={(r) => {
            setInviting(false);
            setInviteLink(r);
          }}
        />
      )}
      {editing && team.data && (
        <EditMemberModal member={editing} roles={team.data.assignableRoles} canCustomize={me.active!.role === 'owner' || me.active!.role === 'admin'} onClose={() => setEditing(null)} />
      )}
      {inviteLink && <InviteLinkModal {...inviteLink} onClose={() => setInviteLink(null)} />}
      {showAudit && <AuditModal onClose={() => setShowAudit(false)} />}
    </div>
  );
}

function MembersTable({
  data,
  canEdit,
  canManage,
  onEdit,
  onInviteLink,
}: {
  data: TeamResponse;
  canEdit: boolean;
  canManage: boolean;
  onEdit: (m: TeamMember) => void;
  onInviteLink: (r: { url: string; emailSent: boolean; email: string }) => void;
}) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const resend = useMutation({
    mutationFn: (m: TeamMember) => post<{ inviteUrl: string; emailSent: boolean }>(`/team/${m.id}/resend-invite`).then((r) => ({ ...r, email: m.email })),
    onSuccess: (r) => onInviteLink({ url: r.inviteUrl, emailSent: r.emailSent, email: r.email }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/team/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.team });
      toast('Pessoa removida da equipe.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-4 py-2.5 font-medium">Pessoa</th>
            <th className="px-4 py-2.5 font-medium">Função</th>
            <th className="px-4 py-2.5 font-medium">Situação</th>
            <th className="px-4 py-2.5 font-medium">Último acesso</th>
            <th className="w-12 px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.members.map((m) => {
            const editable = canEdit && !m.isYou && data.assignableRoles.includes(m.role);
            return (
              <tr key={m.id}>
                <td className="px-4 py-3">
                  <span className="block font-medium text-ink">
                    {m.name} {m.isYou && <span className="font-normal text-muted">(você)</span>}
                  </span>
                  <span className="text-xs text-muted">{m.email}</span>
                </td>
                <td className="px-4 py-3">
                  {ROLE_LABELS[m.role]}
                  {m.customPermissions && <span className="ml-1.5 text-xs text-muted">· personalizado</span>}
                </td>
                <td className="px-4 py-3">
                  {m.status === 'active' ? <Badge tone="brand" dot>Ativo</Badge> : m.status === 'invited' ? <Badge tone="warn" dot>Convite pendente</Badge> : <Badge dot>Desativado</Badge>}
                </td>
                <td className="px-4 py-3 text-xs text-muted">{m.lastLoginAt ? timeAgo(m.lastLoginAt) : '—'}</td>
                <td className="px-4 py-3 text-right">
                  {editable && (
                    <Menu
                      label={`Ações para ${m.name}`}
                      trigger={({ toggle, open }) => (
                        <Button variant="ghost" size="icon-sm" onClick={toggle} aria-expanded={open} aria-label={`Ações para ${m.name}`}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      )}
                    >
                      {(close) => (
                        <>
                          <MenuItem icon={<Pencil />} onClick={() => { close(); onEdit(m); }}>Função e permissões</MenuItem>
                          {m.status === 'invited' && (
                            <MenuItem icon={<RefreshCw />} onClick={() => { close(); resend.mutate(m); }}>Gerar novo convite</MenuItem>
                          )}
                          {canManage && m.role !== 'owner' && (
                            <>
                              <MenuSeparator />
                              <MenuItem
                                icon={<Trash2 />}
                                tone="danger"
                                onClick={async () => {
                                  close();
                                  const r = await confirm({ title: `Remover ${m.name} da equipe?`, description: 'A pessoa perde o acesso a este estabelecimento imediatamente.', confirmLabel: 'Remover', tone: 'danger' });
                                  if (r.confirmed) remove.mutate(m.id);
                                }}
                              >
                                Remover da equipe
                              </MenuItem>
                            </>
                          )}
                        </>
                      )}
                    </Menu>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PermissionMatrix({ role, value, onChange, disabled }: { role: Role; value: PermissionOverrides; onChange: (v: PermissionOverrides) => void; disabled?: boolean }) {
  const defaults = ROLE_DEFAULTS[role];
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-canvas text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Módulo</th>
            {ACCESS_LEVELS.map((l) => (
              <th key={l} className="px-2 py-2 text-center font-medium">
                {ACCESS_LEVEL_LABELS[l]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {AVAILABLE_MODULES.map((m) => {
            const current: AccessLevel = value[m.key as ModuleKey] ?? defaults[m.key as ModuleKey];
            return (
              <tr key={m.key}>
                <td className="px-3 py-2">{m.label}</td>
                {ACCESS_LEVELS.map((l) => (
                  <td key={l} className="px-2 py-2 text-center">
                    <input
                      type="radio"
                      name={`perm-${m.key}`}
                      aria-label={`${m.label}: ${ACCESS_LEVEL_LABELS[l]}`}
                      checked={current === l}
                      disabled={disabled}
                      onChange={() => {
                        const next = { ...value };
                        if (defaults[m.key as ModuleKey] === l) delete next[m.key as ModuleKey];
                        else next[m.key as ModuleKey] = l;
                        onChange(next);
                      }}
                      className="size-4 accent-[var(--color-brand)]"
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-line bg-canvas px-3 py-2 text-xs text-muted">
        Visualizar: só consulta. Editar: opera no dia a dia. Administrar: inclui ações sensíveis, como cancelar pedidos, dar desconto e excluir.
      </p>
    </div>
  );
}

function RoleSelect({ roles, value, onChange }: { roles: Role[]; value: Role; onChange: (r: Role) => void }) {
  return (
    <Field label="Função" htmlFor="role" hint={ROLE_DESCRIPTIONS[value]}>
      <Select id="role" value={value} onChange={(e) => onChange(e.target.value as Role)}>
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function InviteModal({ roles, canCustomize, onClose, onInvited }: { roles: Role[]; canCustomize: boolean; onClose: () => void; onInvited: (r: { url: string; emailSent: boolean; email: string }) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', role: (roles.includes('attendant') ? 'attendant' : roles[0]) as Role });
  const [custom, setCustom] = useState(false);
  const [permissions, setPermissions] = useState<PermissionOverrides>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const invite = useMutation({
    mutationFn: (body: unknown) => post<{ inviteUrl: string; emailSent: boolean }>('/team', body),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.team });
      onInvited({ url: r.inviteUrl, emailSent: r.emailSent, email: form.email });
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });
  const submit = () => {
    const body = { ...form, permissions: custom && Object.keys(permissions).length ? permissions : null };
    const v = validate(inviteMemberSchema, body);
    setErrors(v.ok ? {} : v.errors);
    if (v.ok) invite.mutate(body);
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Convidar para a equipe"
      description="A pessoa recebe um link para criar a senha e entrar. O link vale por 7 dias."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={invite.isPending} onClick={submit}>
            Enviar convite
          </Button>
        </>
      }
    >
      <form noValidate className="space-y-4 pt-1" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {invite.error && !Object.keys(serverFieldErrors(invite.error)).length && <ErrorNotice message={invite.error.message} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" htmlFor="i-name" error={errors.name}>
            <Input id="i-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errors.name} />
          </Field>
          <Field label="E-mail" htmlFor="i-email" error={errors.email}>
            <Input id="i-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} invalid={!!errors.email} />
          </Field>
        </div>
        <RoleSelect roles={roles} value={form.role} onChange={(role) => { setForm({ ...form, role }); setPermissions({}); }} />
        {canCustomize && form.role !== 'owner' && (
          <>
            <Switch checked={custom} onChange={setCustom} label="Personalizar permissões" description="Ajuste o acesso por módulo além do padrão da função." />
            {custom && <PermissionMatrix role={form.role} value={permissions} onChange={setPermissions} />}
          </>
        )}
      </form>
    </Modal>
  );
}

function EditMemberModal({ member, roles, canCustomize, onClose }: { member: TeamMember; roles: Role[]; canCustomize: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [role, setRole] = useState<Role>(member.role);
  const [permissions, setPermissions] = useState<PermissionOverrides>(member.customPermissions ?? {});
  const [active, setActive] = useState(member.status !== 'disabled');
  const save = useMutation({
    mutationFn: () => put(`/team/${member.id}`, { role, permissions: Object.keys(permissions).length ? permissions : null, isActive: active }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.team });
      toast('Acesso atualizado.');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={member.name}
      description={member.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Salvar acesso
          </Button>
        </>
      }
    >
      <div className="space-y-5 pt-1">
        <RoleSelect roles={roles} value={role} onChange={(r) => { setRole(r); setPermissions({}); }} />
        {canCustomize && role !== 'owner' && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[0.8125rem] font-medium text-ink-2">Permissões</p>
              {Object.keys(permissions).length > 0 && (
                <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setPermissions({})}>
                  Voltar ao padrão da função
                </button>
              )}
            </div>
            <PermissionMatrix role={role} value={permissions} onChange={setPermissions} />
          </div>
        )}
        {member.status !== 'invited' && (
          <Switch checked={active} onChange={setActive} label="Acesso ativo" description="Desative para bloquear o acesso sem apagar o histórico desta pessoa." />
        )}
      </div>
    </Modal>
  );
}

function InviteLinkModal({ url, emailSent, email, onClose }: { url: string; emailSent: boolean; email: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Convite criado"
      description={
        emailSent
          ? `Enviamos o link para ${email}. Você também pode mandar por WhatsApp.`
          : `O envio de e-mail não está configurado nesta instalação. Copie o link e envie para ${email} por WhatsApp ou outro canal.`
      }
      footer={<Button onClick={onClose}>Concluir</Button>}
    >
      <div className="flex gap-2 pt-1">
        <Input readOnly value={url} className="num text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Link do convite" />
        <Button
          variant="secondary"
          icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          onClick={async () => {
            await navigator.clipboard.writeText(url).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </Modal>
  );
}

function AuditModal({ onClose }: { onClose: () => void }) {
  const audit = useQuery({
    queryKey: ['team', 'audit'],
    queryFn: ({ signal }) => get<{ entries: { id: string; action: string; summary: string | null; actorName: string | null; createdAt: string; ip: string | null }[] }>('/team/audit', signal),
  });
  return (
    <Modal open onClose={onClose} side="right" size="md" title="Registro de atividades" description="As 100 alterações mais recentes feitas no painel.">
      {audit.isLoading ? (
        <Skeleton className="h-64" />
      ) : audit.error ? (
        <ErrorNotice message={audit.error.message} />
      ) : (
        <ol className="divide-y divide-line">
          {audit.data!.entries.map((e) => (
            <li key={e.id} className="py-3">
              <p className="text-sm text-ink">{e.summary ?? e.action}</p>
              <p className={cx('text-xs text-muted')}>
                {formatDateTime(e.createdAt)} · {e.actorName ?? 'Sistema'}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
