'use client';

import { use, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FULFILLMENT_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, formatBRL, formatPhone } from '@balcao/shared';
import { Button } from '@/components/ui/button';
import { ErrorNotice, Skeleton } from '@/components/ui/misc';
import { get, post } from '@/lib/api';
import { formatAddress, formatDateTime } from '@/lib/format';
import { useAdmin } from '@/components/admin/admin-context';
import type { OrderDetail } from '@/lib/types';

/** Comanda para impressora térmica de 80 mm (também funciona em A4). */
export default function PrintOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useAdmin();
  const order = useQuery({ queryKey: ['orders', 'print', id], queryFn: () => get<OrderDetail>(`/orders/${id}`) });
  const printed = useRef(false);

  useEffect(() => {
    if (order.data && !printed.current) {
      printed.current = true;
      void post(`/orders/${id}/printed`).catch(() => undefined);
      setTimeout(() => window.print(), 300);
    }
  }, [order.data, id]);

  if (order.isLoading) return <Skeleton className="mx-auto h-96 max-w-[80mm]" />;
  if (order.error || !order.data) return <ErrorNotice message={order.error?.message ?? 'Pedido não encontrado.'} />;
  const o = order.data;

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-canvas print:static print:bg-white">
      <style>{`@page { size: 80mm auto; margin: 4mm; } @media print { header, aside, nav { display: none !important; } }`}</style>
      <div className="no-print mx-auto flex max-w-[80mm] justify-between gap-2 py-4">
        <Button variant="secondary" size="sm" onClick={() => window.close()}>
          Fechar
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          Imprimir
        </Button>
      </div>
      <article className="mx-auto max-w-[80mm] bg-white p-4 font-mono text-[11px] leading-snug text-black shadow-soft print:p-0 print:shadow-none">
        <p className="text-center text-[12px] font-semibold uppercase">{me.active?.tenant.tradeName}</p>
        <p className="mt-1 text-center text-[28px] font-bold leading-none">#{o.number}</p>
        <p className="mt-1 text-center uppercase">{FULFILLMENT_LABELS[o.fulfillment]}</p>
        <p className="text-center">{formatDateTime(o.createdAt)}</p>
        <hr className="my-2 border-dashed border-black" />
        <p className="font-semibold">{o.customerName}</p>
        {o.customerPhone && <p>{formatPhone(o.customerPhone)}</p>}
        {o.address && (
          <p>
            {formatAddress(o.address)}
            {o.address.reference && <><br />Ref.: {o.address.reference}</>}
          </p>
        )}
        {o.tableNumber && <p>Mesa {o.tableNumber}</p>}
        <hr className="my-2 border-dashed border-black" />
        {o.items.map((i) => (
          <div key={i.id} className="mb-1.5">
            <div className="flex justify-between gap-2">
              <span className="font-semibold">
                {i.quantity}x {i.productName}
              </span>
              <span>{formatBRL(i.totalCents)}</span>
            </div>
            {i.modifiers.map((m, idx) => (
              <p key={idx} className="pl-3">
                + {m.quantity > 1 ? `${m.quantity}x ` : ''}
                {m.name}
              </p>
            ))}
            {i.notes && <p className="pl-3 font-semibold">OBS: {i.notes}</p>}
          </div>
        ))}
        {o.notes && (
          <>
            <hr className="my-2 border-dashed border-black" />
            <p className="font-semibold">OBS DO PEDIDO: {o.notes}</p>
          </>
        )}
        <hr className="my-2 border-dashed border-black" />
        <Line label="Subtotal" value={formatBRL(o.subtotalCents)} />
        {o.discountCents > 0 && <Line label="Desconto" value={`-${formatBRL(o.discountCents)}`} />}
        {o.fulfillment === 'delivery' && <Line label="Entrega" value={formatBRL(o.deliveryFeeCents)} />}
        <div className="mt-1 flex justify-between text-[13px] font-bold">
          <span>TOTAL</span>
          <span>{formatBRL(o.totalCents)}</span>
        </div>
        <hr className="my-2 border-dashed border-black" />
        <Line label="Pagamento" value={PAYMENT_METHOD_LABELS[o.paymentMethod]} />
        <Line label="Situação" value={PAYMENT_STATUS_LABELS[o.paymentStatus]} />
        {o.paymentMethod === 'cash' && o.changeForCents !== null && (
          <>
            <Line label="Troco para" value={formatBRL(o.changeForCents)} />
            <Line label="Levar de troco" value={formatBRL(o.changeForCents - o.totalCents)} />
          </>
        )}
      </article>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
