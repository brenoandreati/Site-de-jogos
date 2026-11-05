'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { describeAvailability } from '@balcao/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useFeedback } from '@/components/ui/feedback';
import { errorMessage, post } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { keys } from '@/lib/queries';
import type { Settings } from '@/lib/types';
import { cx } from '@/lib/format';

const DURATIONS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hora', value: 60 },
  { label: 'Até eu reabrir', value: null },
];

export function PauseStoreModal({ open, onClose, settings }: { open: boolean; onClose: () => void; settings: Settings }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [duration, setDuration] = useState<number | null>(30);
  const [reason, setReason] = useState('');
  const paused = settings.pause.isPaused && settings.availability.reason === 'paused';

  const mutation = useMutation({
    mutationFn: (body: unknown) => post<Settings>('/settings/pause', body),
    onSuccess: (data) => {
      qc.setQueryData(keys.settings, data);
      toast(data.pause.isPaused ? 'Loja pausada. O cardápio não aceita pedidos novos.' : 'Loja reaberta para pedidos.');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (paused) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="sm"
        title="Reabrir a loja"
        description={
          settings.pause.pausedUntil
            ? `A pausa termina sozinha às ${formatTime(settings.pause.pausedUntil)}.`
            : 'A loja está pausada até alguém reabrir.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Manter pausada
            </Button>
            <Button loading={mutation.isPending} onClick={() => mutation.mutate({ paused: false })}>
              Reabrir agora
            </Button>
          </>
        }
      >
        {settings.pause.reason && <p className="text-sm text-ink-2">Motivo: {settings.pause.reason}</p>}
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Pausar pedidos"
      description={
        settings.availability.isOpen
          ? 'O cardápio continua visível, mas ninguém consegue finalizar pedido durante a pausa.'
          : `${describeAvailability(settings.availability)}. Pausar agora vale também para quando a loja abrir.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate({ paused: true, durationMinutes: duration, reason: reason || null })}>
            Pausar pedidos
          </Button>
        </>
      }
    >
      <div className="space-y-4 pt-1">
        <div role="radiogroup" aria-label="Duração da pausa" className="grid grid-cols-2 gap-2">
          {DURATIONS.map((d) => (
            <button
              key={d.label}
              type="button"
              role="radio"
              aria-checked={duration === d.value}
              onClick={() => setDuration(d.value)}
              className={cx(
                'h-10 rounded-md border text-sm font-medium transition-colors',
                duration === d.value ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong text-ink-2 hover:border-ink/30',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        <Field label="Motivo" htmlFor="pause-reason" optional hint="Só a equipe vê.">
          <Input id="pause-reason" value={reason} maxLength={120} placeholder="Ex.: cozinha lotada" onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
