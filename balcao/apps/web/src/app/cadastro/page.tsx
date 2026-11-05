'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS, signupSchema, slugify } from '@balcao/shared';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, PhoneInput, Select } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/misc';
import { ApiError, post } from '@/lib/api';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { useSetMe } from '@/lib/session';
import type { Me } from '@/lib/types';

export default function SignupPage() {
  const router = useRouter();
  const setMe = useSetMe();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    storeName: '',
    slug: '',
    whatsapp: '',
    businessCategory: '',
    acceptTerms: false,
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [host, setHost] = useState('');
  useEffect(() => setHost(window.location.host), []);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const signup = useMutation({
    mutationFn: (body: unknown) => post<Me>('/auth/signup', body),
    onSuccess: (me) => {
      setMe(me);
      router.replace('/painel?bem-vindo=1');
    },
    onError: (err) => setErrors(serverFieldErrors(err)),
  });

  return (
    <AuthShell
      title="Cadastre sua loja"
      subtitle="Em poucos minutos você tem cardápio digital e painel de pedidos funcionando."
      footer={
        <>
          Já tem conta?{' '}
          <Link href="/entrar" className="font-medium text-brand hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const v = validate(signupSchema, form);
          setErrors(v.ok ? {} : v.errors);
          if (v.ok) signup.mutate(form);
        }}
      >
        {signup.error && !Object.keys(serverFieldErrors(signup.error)).length && <ErrorNotice message={(signup.error as ApiError).message} />}

        <fieldset className="min-w-0 space-y-4">
          <legend className="mb-3 text-2xs font-semibold uppercase tracking-[0.08em] text-faint">Sua loja</legend>
          <Field label="Nome da loja" htmlFor="storeName" error={errors.storeName}>
            <Input
              id="storeName"
              autoFocus
              value={form.storeName}
              invalid={!!errors.storeName}
              onChange={(e) => {
                set('storeName', e.target.value);
                if (!slugTouched) set('slug', slugify(e.target.value));
              }}
            />
          </Field>
          <Field
            label="Endereço do cardápio"
            htmlFor="slug"
            error={errors.slug}
            hint={form.slug ? <span className="num text-xs">{host}/{form.slug}</span> : 'É o link que você vai mandar para os clientes.'}
          >
            <Input
              id="slug"
              value={form.slug}
              invalid={!!errors.slug}
              autoCapitalize="none"
              onChange={(e) => {
                setSlugTouched(true);
                set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
              }}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de negócio" htmlFor="businessCategory" error={errors.businessCategory}>
              <Select id="businessCategory" value={form.businessCategory} invalid={!!errors.businessCategory} onChange={(e) => set('businessCategory', e.target.value)}>
                <option value="" disabled>
                  Escolha
                </option>
                {BUSINESS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {BUSINESS_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="WhatsApp da loja" htmlFor="whatsapp" error={errors.whatsapp}>
              <PhoneInput id="whatsapp" value={form.whatsapp} invalid={!!errors.whatsapp} onChange={(v) => set('whatsapp', v)} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="min-w-0 space-y-4 border-t border-line pt-5">
          <legend className="mb-3 text-2xs font-semibold uppercase tracking-[0.08em] text-faint">Seu acesso</legend>
          <Field label="Seu nome" htmlFor="name" error={errors.name}>
            <Input id="name" autoComplete="name" value={form.name} invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="E-mail" htmlFor="email" error={errors.email}>
            <Input id="email" type="email" autoComplete="email" value={form.email} invalid={!!errors.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Senha" htmlFor="password" error={errors.password} hint="Pelo menos 8 caracteres.">
            <Input id="password" type="password" autoComplete="new-password" value={form.password} invalid={!!errors.password} onChange={(e) => set('password', e.target.value)} />
          </Field>
        </fieldset>

        <div>
          <Checkbox
            checked={form.acceptTerms}
            onChange={(v) => set('acceptTerms', v)}
            label={
              <>
                Li e aceito os{' '}
                <Link href="/termos" target="_blank" className="text-brand underline-offset-2 hover:underline">
                  termos de uso
                </Link>{' '}
                e a{' '}
                <Link href="/privacidade" target="_blank" className="text-brand underline-offset-2 hover:underline">
                  política de privacidade
                </Link>
                .
              </>
            }
          />
          {errors.acceptTerms && <p className="mt-1.5 text-[0.8125rem] text-danger">{errors.acceptTerms}</p>}
        </div>

        <Button type="submit" size="lg" className="w-full" loading={signup.isPending}>
          Criar minha loja
        </Button>
      </form>
    </AuthShell>
  );
}
