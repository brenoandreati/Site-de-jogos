'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { changePasswordSchema } from '@balcao/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useFeedback } from '@/components/ui/feedback';
import { put } from '@/lib/api';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/forms';
import { ErrorNotice } from '@/components/ui/misc';

export function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useFeedback();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: () => put('/auth/password', form),
    onSuccess: () => {
      toast('Senha alterada. As outras sessões foram encerradas.');
      setForm({ currentPassword: '', newPassword: '' });
      onClose();
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Trocar senha"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="password-form"
            loading={mutation.isPending}
          >
            Salvar senha
          </Button>
        </>
      }
    >
      <form
        id="password-form"
        noValidate
        className="space-y-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          const v = validate(changePasswordSchema, form);
          setErrors(v.ok ? {} : v.errors);
          if (v.ok) mutation.mutate();
        }}
      >
        {mutation.error && !Object.keys(serverFieldErrors(mutation.error)).length && <ErrorNotice message={mutation.error.message} />}
        <Field label="Senha atual" htmlFor="current-password" error={errors.currentPassword}>
          <Input id="current-password" type="password" autoComplete="current-password" value={form.currentPassword} invalid={!!errors.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </Field>
        <Field label="Nova senha" htmlFor="new-password" error={errors.newPassword} hint="Pelo menos 8 caracteres.">
          <Input id="new-password" type="password" autoComplete="new-password" value={form.newPassword} invalid={!!errors.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}
