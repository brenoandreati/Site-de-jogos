'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cx } from '@/lib/format';
import { Button } from './button';
import { Modal } from './modal';
import { Field, Textarea } from './field';

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** Pede um texto (ex.: motivo do cancelamento). */
  reason?: { label: string; placeholder?: string; required?: boolean; suggestions?: readonly string[] };
}

interface FeedbackContext {
  toast: (message: string, tone?: ToastTone, action?: Toast['action']) => void;
  confirm: (options: ConfirmOptions) => Promise<{ confirmed: boolean; reason: string }>;
}

const Ctx = createContext<FeedbackContext | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (r: { confirmed: boolean; reason: string }) => void }) | null>(null);
  const [reason, setReason] = useState('');

  const toast = useCallback<FeedbackContext['toast']>((message, tone = 'success', action) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, tone, message, action }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);

  const confirm = useCallback<FeedbackContext['confirm']>((options) => {
    setReason('');
    return new Promise((resolve) => setPending({ ...options, resolve }));
  }, []);

  const close = (confirmed: boolean) => {
    pending?.resolve({ confirmed, reason: reason.trim() });
    setPending(null);
  };

  const reasonMissing = !!pending?.reason?.required && reason.trim().length < 2;

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-lg border bg-surface px-4 py-3 text-sm shadow-pop',
              t.tone === 'error' ? 'border-danger/25' : 'border-line',
            )}
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            {t.tone === 'success' && <CheckCircle2 className="mt-px size-[18px] shrink-0 text-brand" />}
            {t.tone === 'error' && <AlertCircle className="mt-px size-[18px] shrink-0 text-danger" />}
            {t.tone === 'info' && <Info className="mt-px size-[18px] shrink-0 text-info" />}
            <p className="min-w-0 flex-1 text-ink">{t.message}</p>
            {t.action && (
              <button type="button" className="shrink-0 font-semibold text-brand" onClick={t.action.onClick}>
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dispensar"
              className="-mr-1 shrink-0 text-faint hover:text-ink"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <Modal
        open={!!pending}
        onClose={() => close(false)}
        size="sm"
        title={pending?.title}
        description={pending?.description}
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Voltar
            </Button>
            <Button variant={pending?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)} disabled={reasonMissing}>
              {pending?.confirmLabel}
            </Button>
          </>
        }
      >
        {pending?.reason && (
          <div className="space-y-3 pt-1">
            {pending.reason.suggestions && (
              <div className="flex flex-wrap gap-1.5">
                {pending.reason.suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setReason(s)}
                    className={cx(
                      'rounded-full border px-3 py-1 text-[0.8125rem] transition-colors',
                      reason === s ? 'border-ink bg-ink text-white' : 'border-line-strong text-ink-2 hover:border-ink/40',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <Field label={pending.reason.label} htmlFor="confirm-reason">
              <Textarea
                id="confirm-reason"
                rows={2}
                value={reason}
                placeholder={pending.reason.placeholder}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
              />
            </Field>
          </div>
        )}
      </Modal>
    </Ctx.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('FeedbackProvider ausente');
  return ctx;
}
