'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '@/lib/format';

/**
 * Modal e gaveta lateral sobre o <dialog> nativo: foco preso, Esc fecha, fundo inerte.
 * `side="right"` abre como gaveta (detalhe de pedido, edição de produto); `side="bottom"` vira
 * folha inferior no celular (cardápio do cliente).
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  side = 'center',
  className,
  bodyClassName,
  hideClose,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  side?: 'center' | 'right' | 'bottom';
  className?: string;
  bodyClassName?: string;
  hideClose?: boolean;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      if (!open) return;
      document.documentElement.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    if (!open) document.documentElement.style.overflow = '';
  }, [open]);

  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];
  const position =
    side === 'right'
      ? cx('m-0 ml-auto h-dvh max-h-dvh w-full rounded-none sm:rounded-l-xl', { sm: 'sm:w-[380px]', md: 'sm:w-[480px]', lg: 'sm:w-[640px]', xl: 'sm:w-[820px]' }[size])
      : side === 'bottom'
        ? cx('mx-auto mb-0 mt-auto w-full max-h-[92dvh] rounded-t-2xl sm:m-auto sm:rounded-xl animate-slide-up sm:animate-rise', widths)
        : cx('m-auto w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] rounded-xl animate-rise', widths);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx('max-w-none overflow-hidden bg-surface p-0 text-ink shadow-pop backdrop:animate-fade', position, className)}
    >
      {open && (
        <div className="flex max-h-[inherit] h-full flex-col">
          {(title || !hideClose) && (
            <header className={cx('flex items-start justify-between gap-4 px-5 pt-5', title ? 'pb-3' : 'pb-0')}>
              <div className="min-w-0">
                {title && <h2 id={labelledBy} className="text-[1.0625rem] font-semibold leading-snug text-ink">{title}</h2>}
                {description && <p className="mt-1 text-sm text-muted">{description}</p>}
              </div>
              {!hideClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="-mr-1.5 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
                  aria-label="Fechar"
                >
                  <X className="size-[18px]" />
                </button>
              )}
            </header>
          )}
          <div className={cx('min-h-0 flex-1 overflow-y-auto px-5 pb-5', bodyClassName)}>{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3.5">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
