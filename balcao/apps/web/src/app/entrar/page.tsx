'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { loginSchema } from '@balcao/shared';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/misc';
import { ApiError, post } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/forms';
import { useSetMe } from '@/lib/session';
import type { Me } from '@/lib/types';

function safeNext(next: string | null) {
  return next && next.startsWith('/painel') ? next : '/painel';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setMe = useSetMe();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const login = useMutation({
    mutationFn: (body: unknown) => post<Me>('/auth/login', body),
    onSuccess: (me) => {
      setMe(me);
      router.replace(safeNext(params.get('next')));
    },
  });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const v = validate(loginSchema, { email, password });
        setErrors(v.ok ? {} : v.errors);
        if (v.ok) login.mutate(v.data);
      }}
    >
      {login.error && <ErrorNotice message={(login.error as ApiError).message} />}
      {params.get('motivo') === 'senha-redefinida' && !login.error && (
        <p className="rounded-md bg-brand-soft px-4 py-3 text-sm text-brand-ink">Senha redefinida. Entre com a nova senha.</p>
      )}
      <Field label="E-mail" htmlFor="email" error={errors.email}>
        <Input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} />
      </Field>
      <div>
        <Field label="Senha" htmlFor="password" error={errors.password}>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} />
        </Field>
        <p className="mt-2 text-right text-[0.8125rem]">
          <Link href="/recuperar-senha" className="text-brand hover:underline">
            Esqueci a senha
          </Link>
        </p>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={login.isPending}>
        Entrar
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell
      title="Entrar no painel"
      subtitle="Acompanhe pedidos, cardápio e equipe da sua loja."
      footer={
        <>
          Ainda não usa o Balcão?{' '}
          <Link href="/cadastro" className="font-medium text-brand hover:underline">
            Cadastre sua loja
          </Link>
        </>
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
