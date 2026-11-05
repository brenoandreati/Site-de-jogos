'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { passwordSchema } from '@balcao/shared';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/misc';
import { ApiError, post } from '@/lib/api';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const reset = useMutation({
    mutationFn: () => post('/auth/reset-password', { token, password }),
    onSuccess: () => router.replace('/entrar?motivo=senha-redefinida'),
  });

  if (!token) {
    return (
      <ErrorNotice message="Link incompleto. Abra o link do e-mail novamente ou peça um novo." />
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const p = passwordSchema.safeParse(password);
        const next = {
          password: p.success ? undefined : p.error.issues[0]?.message,
          confirm: password !== confirm ? 'As senhas não são iguais' : undefined,
        };
        setErrors(next);
        if (!next.password && !next.confirm) reset.mutate();
      }}
    >
      {reset.error && (
        <ErrorNotice message={(reset.error as ApiError).message} />
      )}
      <Field label="Nova senha" htmlFor="password" error={errors.password} hint="Pelo menos 8 caracteres.">
        <Input id="password" type="password" autoComplete="new-password" autoFocus value={password} invalid={!!errors.password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Repita a nova senha" htmlFor="confirm" error={errors.confirm}>
        <Input id="confirm" type="password" autoComplete="new-password" value={confirm} invalid={!!errors.confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={reset.isPending}>
        Salvar nova senha
      </Button>
      {reset.error && (
        <p className="text-center text-sm">
          <Link href="/recuperar-senha" className="text-brand hover:underline">
            Pedir um novo link
          </Link>
        </p>
      )}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Criar nova senha" subtitle="Ao salvar, as sessões abertas em outros aparelhos são encerradas.">
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
