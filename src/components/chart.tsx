/**
 * Gráficos em SVG puro. Uma biblioteca de charts custaria ~50 KB no bundle
 * para desenhar duas formas — aqui o SVG é renderizado no servidor e chega
 * pronto, sem JavaScript no cliente.
 */

export interface Point {
  label: string;
  value: number;
}

/** Escala segura: série vazia ou toda zerada não pode virar divisão por zero. */
function scaleMax(values: number[]): number {
  const max = Math.max(0, ...values);
  return max > 0 ? max : 1;
}

const fmt = new Intl.NumberFormat("pt-BR");

export function LineChart({
  data,
  height = 220,
  label = "Série temporal",
}: {
  data: Point[];
  height?: number;
  label?: string;
}) {
  if (data.length === 0) {
    return <ChartEmpty height={height} />;
  }

  // viewBox fixo + preserveAspectRatio="none" faz o gráfico acompanhar
  // qualquer largura do container sem recalcular nada no cliente.
  const W = 1000;
  const H = height;
  const padTop = 12;
  const padBottom = 26;
  const plotH = H - padTop - padBottom;

  const max = scaleMax(data.map((d) => d.value));
  const stepX = data.length > 1 ? W / (data.length - 1) : 0;
  const y = (v: number) => padTop + plotH - (v / max) * plotH;

  const points = data.map((d, i) => `${i * stepX},${y(d.value)}`);
  const line = `M ${points.join(" L ")}`;
  const area = `${line} L ${(data.length - 1) * stepX},${padTop + plotH} L 0,${padTop + plotH} Z`;

  const grid = [0, 0.25, 0.5, 0.75, 1];
  const ticks = tickIndexes(data.length);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${data.length} pontos, máximo ${fmt.format(max)}`}
        className="h-56 w-full"
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {grid.map((g) => (
          <line
            key={g}
            x1="0"
            x2={W}
            y1={padTop + plotH * g}
            y2={padTop + plotH * g}
            stroke="var(--border)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={area} fill="url(#areaFill)" />
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Rótulos fora do SVG: dentro eles esticariam junto com o viewBox. */}
      <div className="mt-1 flex justify-between text-xs text-muted">
        {ticks.map((i) => (
          <span key={i}>{data[i].label}</span>
        ))}
      </div>
      <figcaption className="mt-1 text-xs text-muted">
        Máximo no período: {fmt.format(max)}
      </figcaption>
    </figure>
  );
}

/** No máximo 6 rótulos no eixo, senão viram um borrão em 90 dias. */
function tickIndexes(n: number): number[] {
  if (n <= 1) return [0];
  const wanted = Math.min(6, n);
  const step = (n - 1) / (wanted - 1);
  return Array.from({ length: wanted }, (_, i) => Math.round(i * step));
}

export function BarChart({ data, label = "Ranking" }: { data: Point[]; label?: string }) {
  if (data.length === 0) return <ChartEmpty height={160} />;

  const max = scaleMax(data.map((d) => d.value));

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={label}>
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-sm">{d.label}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(d.value / max) * 100}%` }}
              />
            </div>
          </div>
          <span className="tabular-nums text-sm text-muted">{fmt.format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted"
      style={{ height }}
    >
      Sem dados no período
    </div>
  );
}
