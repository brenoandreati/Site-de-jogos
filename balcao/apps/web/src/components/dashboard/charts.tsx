'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '@/lib/format';

/**
 * Gráficos do painel, em SVG próprio.
 * Regras: um eixo só; linha de 2px com lavagem de 10%; colunas de no máximo 24px com ponta
 * arredondada; grade em linha fina; o período em foco em verde e a comparação em cinza;
 * cruz de leitura com dica que mostra todos os valores daquele ponto; leitura por teclado.
 */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export interface TimePoint {
  label: string;
  /** Rótulo longo para a dica e a tabela (ex.: "05/11 · quarta"). */
  fullLabel: string;
  value: number;
  previous?: number;
}

export function TimeChart({
  points,
  kind,
  format,
  formatAxis,
  seriesLabel,
  previousLabel,
  height = 232,
}: {
  points: TimePoint[];
  kind: 'line' | 'column';
  format: (v: number) => string;
  formatAxis: (v: number) => string;
  seriesLabel: string;
  previousLabel?: string;
  height?: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const showPrev = !!previousLabel && points.some((p) => p.previous !== undefined);

  const pad = { top: 12, right: 12, bottom: 26, left: 56 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...points.map((p) => Math.max(p.value, showPrev ? (p.previous ?? 0) : 0)), 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const n = points.length;
  const band = n > 0 ? innerW / n : 0;
  const x = (i: number) => (kind === 'column' ? pad.left + band * i + band / 2 : pad.left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1)));
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 56))));

  const linePath = (key: 'value' | 'previous') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y((key === 'value' ? p.value : p.previous) ?? 0).toFixed(1)}`).join('');
  const areaPath = `${linePath('value')}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;

  const barW = Math.min(24, Math.max(2, band * 0.6));
  const column = (i: number, v: number) => {
    const h = Math.max(0, y(0) - y(v));
    const r = Math.min(4, h, barW / 2);
    const x0 = x(i) - barW / 2;
    const top = y(v);
    if (h <= 0) return '';
    return `M${x0},${y(0)}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${y(0)}Z`;
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    setActive(best);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  const tip = active !== null ? points[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active), 90), width - 90) : 0;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${seriesLabel}. Use as setas para ler os valores.`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="overflow-visible outline-none focus-visible:outline-2 focus-visible:outline-brand"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-chart-grid)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[10.5px] tabular">
                {formatAxis(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text key={p.label + i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-muted text-[10.5px] tabular">
                {p.label}
              </text>
            ) : null,
          )}

          {kind === 'line' ? (
            <>
              {showPrev && <path d={linePath('previous')} fill="none" stroke="var(--color-chart-muted)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
              <path d={areaPath} fill="var(--color-chart)" fillOpacity={0.1} />
              <path d={linePath('value')} fill="none" stroke="var(--color-chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {n > 0 && active === null && <circle cx={x(n - 1)} cy={y(points[n - 1]!.value)} r={4} fill="var(--color-chart)" stroke="var(--color-surface)" strokeWidth={2} />}
            </>
          ) : (
            points.map((p, i) => (
              <path key={i} d={column(i, p.value)} fill="var(--color-chart)" opacity={active === null || active === i ? 1 : 0.55} className="transition-opacity duration-100" />
            ))
          )}

          {active !== null && tip && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={pad.top} y2={y(0)} stroke="var(--color-line-strong)" strokeWidth={1} shapeRendering="crispEdges" />
              {kind === 'line' && (
                <>
                  {showPrev && tip.previous !== undefined && <circle cx={x(active)} cy={y(tip.previous)} r={4} fill="var(--color-chart-muted)" stroke="var(--color-surface)" strokeWidth={2} />}
                  <circle cx={x(active)} cy={y(tip.value)} r={4.5} fill="var(--color-chart)" stroke="var(--color-surface)" strokeWidth={2} />
                </>
              )}
            </g>
          )}
        </svg>
      )}
      {tip && active !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 min-w-40 -translate-x-1/2 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-pop"
          style={{ left: tipLeft }}
        >
          <p className="mb-1 text-muted">{tip.fullLabel}</p>
          <p className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded bg-chart" aria-hidden="true" />
            <span className="num font-semibold text-ink">{format(tip.value)}</span>
            <span className="text-muted">{seriesLabel}</span>
          </p>
          {showPrev && tip.previous !== undefined && (
            <p className="mt-0.5 flex items-center gap-2">
              <span className="h-0.5 w-3 rounded bg-chart-muted" aria-hidden="true" />
              <span className="num font-semibold text-ink">{format(tip.previous)}</span>
              <span className="text-muted">{previousLabel}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; tone: 'chart' | 'muted' }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={cx('h-0.5 w-4 rounded', i.tone === 'chart' ? 'bg-chart' : 'bg-chart-muted')} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Barras horizontais ordenadas (uma cor): para comparar partes entre si. Valores sempre visíveis. */
export function RankedBars({
  rows,
  format,
  secondary,
  empty = 'Sem dados no período.',
}: {
  rows: { label: string; value: number; hint?: string }[];
  format: (v: number) => string;
  secondary?: (row: { label: string; value: number; hint?: string }) => string | undefined;
  empty?: string;
}) {
  const max = useMemo(() => Math.max(1, ...rows.map((r) => r.value)), [rows]);
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${format(r.value)}${total ? ` (${Math.round((r.value / total) * 100)}%)` : ''}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[0.8125rem]">
            <span className="truncate text-ink-2">{r.label}</span>
            <span className="shrink-0">
              <span className="num text-ink">{format(r.value)}</span>
              {secondary?.(r) && <span className="ml-2 text-xs text-muted">{secondary(r)}</span>}
            </span>
          </div>
          <div className="h-2 rounded-r bg-transparent">
            <div className="h-2 rounded-r-[4px] bg-chart" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
