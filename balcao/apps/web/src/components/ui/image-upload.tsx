'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { errorMessage, uploadImage } from '@/lib/api';
import { cx } from '@/lib/format';
import { Spinner } from './misc';

export function ImageUpload({
  value,
  onChange,
  aspect = 'square',
  label = 'Enviar imagem',
  className,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  aspect?: 'square' | 'wide';
  label?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setLoading(true);
    try {
      onChange(await uploadImage(file));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className={className}>
      <div
        className={cx(
          'group relative overflow-hidden rounded-lg border border-dashed border-line-strong bg-canvas',
          aspect === 'square' ? 'aspect-square w-32' : 'aspect-[3/1] w-full',
        )}
      >
        {value ? (
          <img src={value} alt="" className="size-full object-cover" />
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex size-full flex-col items-center justify-center gap-1.5 text-xs text-muted hover:text-ink"
          >
            <ImagePlus className="size-5" />
            {label}
          </button>
        )}
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-surface/80">
            <Spinner />
          </div>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <div className="mt-2 flex items-center gap-3 text-xs">
        {value && (
          <>
            <button type="button" className="font-medium text-brand hover:underline" onClick={() => input.current?.click()}>
              Trocar
            </button>
            <button type="button" className="inline-flex items-center gap-1 text-muted hover:text-danger" onClick={() => onChange(null)}>
              <Trash2 className="size-3" /> Remover
            </button>
          </>
        )}
        {!value && <span className="text-faint">JPG, PNG ou WEBP até 5 MB</span>}
      </div>
      {error && (
        <p className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
