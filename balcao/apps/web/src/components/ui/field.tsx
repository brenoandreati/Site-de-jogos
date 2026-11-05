'use client';

import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { centsToInput, formatPhone, normalizeBrazilianPhone, parseBRLToCents } from '@balcao/shared';
import { cx } from '@/lib/format';

const control =
  'w-full rounded-md border border-line-strong bg-surface px-3 text-[0.9375rem] text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-ink/25 focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15 disabled:bg-sunken disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15';

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
  optional,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  optional?: boolean;
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-ink-2">
          {label}
          {optional && <span className="ml-1 font-normal text-faint">(opcional)</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-[0.8125rem] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[0.8125rem] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; prefix?: string }>(
  function Input({ className, invalid, prefix, ...rest }, ref) {
    if (prefix) {
      return (
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">{prefix}</span>
          <input ref={ref} aria-invalid={invalid || undefined} className={cx(control, 'h-10', className)} style={{ paddingLeft: `calc(1.15rem + ${prefix.length}ch)` }} {...rest} />
        </div>
      );
    }
    return <input ref={ref} aria-invalid={invalid || undefined} className={cx(control, 'h-10', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, rows = 3, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} aria-invalid={invalid || undefined} className={cx(control, 'py-2.5 leading-snug', className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cx(
          control,
          'h-10 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%236b6963%27 stroke-width=%272.5%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-[length:12px] bg-[right_0.75rem_center] bg-no-repeat pr-9',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

/** Campo de valor em reais. Trabalha internamente em centavos. */
export function MoneyInput({
  value,
  onChange,
  id,
  invalid,
  placeholder = '0,00',
  allowEmpty,
  className,
  disabled,
  ...rest
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(value === null ? '' : centsToInput(value));
  useEffect(() => {
    const parsed = parseBRLToCents(text);
    if (parsed !== value) setText(value === null ? '' : centsToInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      prefix="R$"
      placeholder={placeholder}
      invalid={invalid}
      disabled={disabled}
      className={cx('num text-[0.875rem]', className)}
      value={text}
      onChange={(e) => {
        const next = e.target.value.replace(/[^\d.,]/g, '');
        setText(next);
        if (next === '') onChange(allowEmpty ? null : 0);
        else {
          const cents = parseBRLToCents(next);
          if (cents !== null) onChange(cents);
        }
      }}
      onBlur={() => {
        if (text === '') return;
        const cents = parseBRLToCents(text);
        if (cents !== null) setText(centsToInput(cents));
      }}
      {...rest}
    />
  );
}

/** Telefone brasileiro com máscara. Devolve o texto digitado; a validação/normalização acontece no envio. */
export function PhoneInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="(11) 91234-5678"
      value={value}
      onChange={(e) => onChange(maskPhone(e.target.value))}
      onBlur={() => {
        const n = normalizeBrazilianPhone(value);
        if (n) onChange(formatPhone(n));
      }}
      {...rest}
    />
  );
}

function maskPhone(input: string) {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const auto = useId();
  const sid = id ?? auto;
  const toggle = (
    <button
      id={sid}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-line-strong',
      )}
    >
      <span className={cx('inline-block size-5 rounded-full bg-white shadow-soft transition-transform duration-150', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
  if (!label) return toggle;
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={sid} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[0.8125rem] text-muted">{description}</span>}
      </label>
      {toggle}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-[18px] shrink-0 cursor-pointer appearance-none rounded border border-line-strong bg-surface bg-center bg-no-repeat transition-colors checked:border-brand checked:bg-brand checked:bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22white%22%20stroke-width=%223.5%22%3E%3Cpath%20d=%22M5%2012.5l4.5%204.5L19%207%22/%3E%3C/svg%3E')] bg-[length:12px]"
      />
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[0.8125rem] text-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Controle segmentado para escolhas curtas e excludentes. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  className?: string;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx('inline-flex rounded-md bg-sunken p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 rounded-[5px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 disabled:opacity-40',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
            value === o.value ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  size = 'md',
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'md';
  label: string;
}) {
  const btn = cx(
    'grid place-items-center rounded-md text-ink-2 transition-colors hover:bg-sunken disabled:opacity-30 disabled:hover:bg-transparent',
    size === 'sm' ? 'size-7' : 'size-9',
  );
  return (
    <div className="inline-flex items-center rounded-md border border-line-strong bg-surface" role="group" aria-label={label}>
      <button type="button" className={btn} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Diminuir ${label}`}>
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <span className={cx('num text-center text-sm', size === 'sm' ? 'w-6' : 'w-8')} aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Aumentar ${label}`}>
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  );
}
