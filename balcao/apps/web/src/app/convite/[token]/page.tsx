'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { passwordSchema } from '@balcao/shared';
import { AuthShell } from '@/components/auth-shell';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ErrorNotice, Skeleton } from '@/components/ui/misc';
import { ApiError, get, post } from '@/lib/api';

interface InviteInfo {
  tenantName: string;
  email: string;
  roleLabel: string;
  name: string;
  needsPassword: boolean;
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => get<InviteInfo>(`/auth/invites/${encodeURIComponent(token)}`), retry: false });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();

  const accept = useMutation({
    mutationFn: () =>
      post<{ loggedIn: boolean }>('/auth/invites/accept', {
        token,
        ...(info.data?.needsPassword ? { name: name || info.data.name, password } : {}),
      }),
    onSuccess: (r) => router.replace(r.loggedIn ? '/painel' : '/entrar'),
  });

  if (info.isLoading) {
    return (
      <AuthShell title="Convite para a equipe">
        <div className="space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </AuthShell>
    );
  }

  if (info.error || !info.data) {
    return (
      <AuthShell title="Convite indisponível">
        <ErrorNotice message={(info.error as ApiError)?.message ?? 'Convite inválido.'} />
        <p className="mt-4 text-sm text-muted">Peça para quem convidou você gerar um novo link.</p>
        <ButtonLink href="/entrar" className="mt-5 w-full">
          Ir para o login
        </ButtonLink>
      </AuthShell>
    );
  }

  const invite = info.data;
  return (
    <AuthShell
      title={`Entrar na equipe de ${invite.tenantName}`}
      subtitle={
        <>
          Você foi convidado como <strong className="font-medium text-ink">{invite.roleLabel}</strong> com o e-mail {invite.email}.
        </>
      }
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (invite.needsPassword) {
            const p = passwordSchema.safeParse(password);
            if (!p.success) return setError(p.error.issues[0]?.message);
          }
          setError(undefined);
          accept.mutate();
        }}
      >
        {accept.error && <ErrorNotice message={(accept.error as ApiError).message} />}
        {invite.needsPassword ? (
          <>
            <Field label="Seu nome" htmlFor="name">
              <Input id="name" autoComplete="name" value={name} placeholder={invite.name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Crie uma senha" htmlFor="password" error={error} hint="Pelo menos 8 caracteres.">
              <Input id="password" type="password" autoComplete="new-password" autoFocus value={password} invalid={!!error} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        ) : (
          <p className="text-sm text-muted">Você já tem uma conta. Depois de aceitar, entre com a sua senha de sempre.</p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={accept.isPending}>
          Aceitar convite
        </Button>
      </form>
    </AuthShell>
  );
}
