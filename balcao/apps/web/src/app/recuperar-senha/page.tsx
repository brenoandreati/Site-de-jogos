'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { forgotPasswordSchema } from '@balcao/shared';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/misc';
import { ApiError, post } from '@/lib/api';
import { validate } from '@/lib/forms';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const send = useMutation({ mutationFn: (body: unknown) => post('/auth/forgot-password', body) });

  return (
    <AuthShell
      title="Recuperar senha"
      subtitle="Informe o e-mail da sua conta. Vamos enviar um link para criar uma senha nova."
      footer={
        <Link href="/entrar" className="font-medium text-brand hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {send.isSuccess ? (
        <div className="flex gap-3 rounded-md bg-brand-soft px-4 py-4 text-sm text-brand-ink" role="status">
          <MailCheck className="mt-0.5 size-5 shrink-0" />
          <p>
            Se houver uma conta com <strong>{email}</strong>, o link chega em alguns minutos. Ele vale por 1 hora. Confira também a caixa de spam.
          </p>
        </div>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const v = validate(forgotPasswordSchema, { email });
            setError(v.ok ? undefined : v.errors.email);
            if (v.ok) send.mutate(v.data);
          }}
        >
          {send.error && <ErrorNotice message={(send.error as ApiError).message} />}
          <Field label="E-mail" htmlFor="email" error={error}>
            <Input id="email" type="email" autoComplete="email" autoFocus value={email} invalid={!!error} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={send.isPending}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
