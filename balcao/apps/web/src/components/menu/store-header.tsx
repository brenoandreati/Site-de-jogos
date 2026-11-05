'use client';

import { useState } from 'react';
import { AtSign, Bike, Clock, MapPin, MessageCircle, ShoppingBag, Utensils } from 'lucide-react';
import { WEEKDAYS, formatBRL, whatsappLink } from '@balcao/shared';
import { Modal } from '@/components/ui/modal';
import { deliveryFeeHint } from '@/lib/cart';
import { cx, formatAddress } from '@/lib/format';
import type { PublicStore } from '@/lib/types';

export function StoreHeader({ store }: { store: PublicStore['store'] }) {
  const [hoursOpen, setHoursOpen] = useState(false);
  const open = store.availability.isOpen;
  return (
    <header>
      {store.coverUrl ? (
        <div className="aspect-[3/1] max-h-56 w-full overflow-hidden bg-sunken sm:rounded-b-xl">
          <img src={store.coverUrl} alt="" className="size-full object-cover" />
        </div>
      ) : (
        <div className="h-20 w-full bg-[var(--accent)] sm:h-24 sm:rounded-b-xl" aria-hidden="true" />
      )}
      <div className="px-4 sm:px-0">
        <div className="-mt-9 flex items-end gap-4">
          <div className="grid size-[76px] shrink-0 place-items-center overflow-hidden rounded-xl border-4 border-surface bg-surface shadow-soft">
            {store.logoUrl ? (
              <img src={store.logoUrl} alt={`Logo ${store.name}`} className="size-full object-cover" />
            ) : (
              <span className="text-2xl font-semibold text-[var(--accent)]">{store.name.charAt(0)}</span>
            )}
          </div>
        </div>
        <h1 className="mt-3 text-[1.625rem] font-semibold leading-tight tracking-[-0.02em]">{store.name}</h1>
        {store.description && <p className="mt-1 text-sm leading-relaxed text-muted">{store.description}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <button type="button" onClick={() => setHoursOpen(true)} className="inline-flex items-center gap-1.5 font-medium hover:underline">
            <span className={cx('size-2 rounded-full', open ? 'bg-brand' : 'bg-danger')} aria-hidden="true" />
            <span className={open ? 'text-ink' : 'text-danger'}>{store.availabilityText}</span>
          </button>
          <button type="button" onClick={() => setHoursOpen(true)} className="inline-flex items-center gap-1 text-muted hover:text-ink">
            <Clock className="size-3.5" /> Horários e informações
          </button>
        </div>

        <ul className="mt-4 flex flex-wrap gap-2 text-[0.8125rem]">
          {store.acceptsDelivery && (
            <li className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-ink-2">
              <Bike className="size-3.5 text-muted" />
              Entrega <span className="tabular">{store.prepTimeMinutes + store.deliveryTimeMinutes}–{store.prepTimeMinutes + store.deliveryTimeMinutes + 10} min</span>
              <span className="text-muted">· {deliveryFeeHint(store)}</span>
            </li>
          )}
          {store.acceptsPickup && (
            <li className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-ink-2">
              <ShoppingBag className="size-3.5 text-muted" />
              Retirada <span className="tabular">{store.prepTimeMinutes} min</span>
            </li>
          )}
          {store.acceptsDineIn && (
            <li className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-ink-2">
              <Utensils className="size-3.5 text-muted" />
              No local
            </li>
          )}
          {store.minOrderCents > 0 && store.acceptsDelivery && (
            <li className="inline-flex items-center rounded-full border border-line px-3 py-1.5 text-muted">Pedido mínimo {formatBRL(store.minOrderCents)}</li>
          )}
          {store.freeDeliveryAboveCents !== null && store.acceptsDelivery && deliveryFeeHint(store) !== 'grátis' && (
            <li className="inline-flex items-center rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-ink">Entrega grátis acima de {formatBRL(store.freeDeliveryAboveCents)}</li>
          )}
        </ul>
      </div>

      <Modal open={hoursOpen} onClose={() => setHoursOpen(false)} side="bottom" size="sm" title={store.name}>
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Horário de funcionamento</h3>
            {store.hours.length === 0 ? (
              <p className="text-sm text-muted">A loja ainda não informou os horários.</p>
            ) : (
              <dl className="space-y-1 text-sm">
                {WEEKDAYS.map((day, d) => {
                  const list = store.hours.filter((h) => h.weekday === d);
                  return (
                    <div key={day} className="flex justify-between gap-4">
                      <dt className="text-muted">{day}</dt>
                      <dd className="num text-xs leading-5 text-ink">{list.length ? list.map((h) => `${h.opensAt}–${h.closesAt}`).join(' · ') : 'Fechado'}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </section>
          {store.address && (
            <section>
              <h3 className="mb-1 text-sm font-semibold">Endereço</h3>
              <p className="flex gap-2 text-sm text-ink-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
                {formatAddress(store.address)}
              </p>
            </section>
          )}
          <section className="flex flex-wrap gap-2">
            {store.whatsapp && (
              <a href={whatsappLink(store.whatsapp)} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-sm font-medium hover:bg-canvas">
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            )}
            {store.instagram && (
              <a href={`https://instagram.com/${store.instagram}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-sm font-medium hover:bg-canvas">
                <AtSign className="size-4" /> Instagram
              </a>
            )}
          </section>
          {store.cancellationPolicy && (
            <section>
              <h3 className="mb-1 text-sm font-semibold">Cancelamento</h3>
              <p className="text-sm text-muted">{store.cancellationPolicy}</p>
            </section>
          )}
        </div>
      </Modal>
    </header>
  );
}
