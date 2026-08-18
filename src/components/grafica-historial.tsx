import type { DiaHistorial } from "@/lib/servicios/historial";

/**
 * Historial de 90 días de un SKU.
 *
 * Son DOS paneles apilados que comparten el eje de tiempo, no una gráfica con
 * dos escalas. Stock y ventas se miden en cosas distintas: superponerlos en un
 * mismo plot inventaría una correlación que no está en los datos, porque la
 * alineación entre las dos escalas sería arbitraria.
 *
 * Las franjas rojas son los días agotado. Ese es el punto de toda la pantalla:
 * ver de un golpe cuánto tiempo el producto no tuvo nada que vender.
 */

const AZUL = "#2a78d6";
const AZUL_OSCURO = "#3987e5";
const CRITICO = "#d03b3b";

interface Props {
  dias: DiaHistorial[];
  /** para dibujar la línea del objetivo en el panel de stock */
  nivelObjetivo?: number;
}

const ANCHO = 900;
const ALTO_STOCK = 150;
const ALTO_VENTAS = 90;
const PAD_IZQ = 48;
const PAD_DER = 12;
const PAD_ARRIBA = 12;
const GAP = 34;

export function GraficaHistorial({ dias, nivelObjetivo }: Props) {
  if (!dias.length) return null;

  const n = dias.length;
  const anchoPlot = ANCHO - PAD_IZQ - PAD_DER;
  const paso = anchoPlot / n;

  const maxStock = Math.max(1, ...dias.map((d) => d.fin), nivelObjetivo ?? 0);
  const maxVenta = Math.max(1, ...dias.map((d) => d.unidades));

  const x = (i: number) => PAD_IZQ + i * paso;
  const yStock = (v: number) => PAD_ARRIBA + ALTO_STOCK - (v / maxStock) * ALTO_STOCK;
  const baseVentas = PAD_ARRIBA + ALTO_STOCK + GAP + ALTO_VENTAS;
  const yVenta = (v: number) => baseVentas - (v / maxVenta) * ALTO_VENTAS;

  // Días agotados, agrupados en rachas para dibujar una franja por racha en
  // vez de 40 rectángulos sueltos pegados.
  const rachas: { desde: number; hasta: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (dias[i].fraccion >= 0.5) continue;
    const ultima = rachas[rachas.length - 1];
    if (ultima && ultima.hasta === i - 1) ultima.hasta = i;
    else rachas.push({ desde: i, hasta: i });
  }

  const linea = dias
    .map((d, i) => `${i === 0 ? "M" : "L"} ${(x(i) + paso / 2).toFixed(1)} ${yStock(d.fin).toFixed(1)}`)
    .join(" ");

  const area =
    `M ${(x(0) + paso / 2).toFixed(1)} ${(PAD_ARRIBA + ALTO_STOCK).toFixed(1)} ` +
    dias.map((d, i) => `L ${(x(i) + paso / 2).toFixed(1)} ${yStock(d.fin).toFixed(1)}`).join(" ") +
    ` L ${(x(n - 1) + paso / 2).toFixed(1)} ${(PAD_ARRIBA + ALTO_STOCK).toFixed(1)} Z`;

  const ticksStock = [0, Math.round(maxStock / 2), Math.round(maxStock)];
  const ticksVenta = [0, Math.round(maxVenta)];

  // Un mes de por medio, para no saturar el eje.
  const marcasX = dias
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.fecha.endsWith("-01") || d.fecha.endsWith("-15"));

  const altoTotal = baseVentas + 26;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${ANCHO} ${altoTotal}`}
        className="w-full"
        role="img"
        aria-label={`Stock disponible y ventas diarias de los últimos ${n} días. ${rachas.length} rachas sin stock.`}
      >
        <style>{`
          .g-linea { stroke: ${AZUL}; }
          .g-area  { fill: ${AZUL}; }
          .g-barra { fill: ${AZUL}; }
          @media (prefers-color-scheme: dark) {
            :root:where(:not([data-theme="light"])) .g-linea { stroke: ${AZUL_OSCURO}; }
            :root:where(:not([data-theme="light"])) .g-area  { fill: ${AZUL_OSCURO}; }
            :root:where(:not([data-theme="light"])) .g-barra { fill: ${AZUL_OSCURO}; }
          }
        `}</style>

        {/* Franjas de días agotado — color de estado, no de serie */}
        {rachas.map((r, k) => (
          <rect
            key={k}
            x={x(r.desde)}
            y={PAD_ARRIBA}
            width={Math.max(paso, (r.hasta - r.desde + 1) * paso)}
            height={ALTO_STOCK + GAP + ALTO_VENTAS}
            fill={CRITICO}
            opacity={0.1}
          />
        ))}

        {/* --- Panel 1: stock disponible ---------------------------------- */}
        {ticksStock.map((t) => (
          <g key={`s${t}`}>
            <line
              x1={PAD_IZQ}
              x2={ANCHO - PAD_DER}
              y1={yStock(t)}
              y2={yStock(t)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text
              x={PAD_IZQ - 8}
              y={yStock(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--ink-muted)"
              className="cifra"
            >
              {t.toLocaleString("es-MX")}
            </text>
          </g>
        ))}

        <path d={area} className="g-area" opacity={0.1} />
        <path d={linea} className="g-linea" fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {nivelObjetivo && nivelObjetivo <= maxStock ? (
          <>
            <line
              x1={PAD_IZQ}
              x2={ANCHO - PAD_DER}
              y1={yStock(nivelObjetivo)}
              y2={yStock(nivelObjetivo)}
              stroke="var(--axis)"
              strokeWidth={1}
            />
            <text
              x={ANCHO - PAD_DER}
              y={yStock(nivelObjetivo) - 5}
              textAnchor="end"
              fontSize={10}
              fill="var(--ink-muted)"
            >
              objetivo {nivelObjetivo.toLocaleString("es-MX")}
            </text>
          </>
        ) : null}

        <text x={PAD_IZQ} y={PAD_ARRIBA - 1} fontSize={11} fill="var(--ink-2)" fontWeight={600}>
          Pares disponibles en Full
        </text>

        {/* --- Panel 2: ventas por día ------------------------------------ */}
        <text
          x={PAD_IZQ}
          y={PAD_ARRIBA + ALTO_STOCK + GAP - 12}
          fontSize={11}
          fill="var(--ink-2)"
          fontWeight={600}
        >
          Pares vendidos por día
        </text>

        {ticksVenta.map((t) => (
          <g key={`v${t}`}>
            <line
              x1={PAD_IZQ}
              x2={ANCHO - PAD_DER}
              y1={yVenta(t)}
              y2={yVenta(t)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text
              x={PAD_IZQ - 8}
              y={yVenta(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--ink-muted)"
              className="cifra"
            >
              {t}
            </text>
          </g>
        ))}

        {dias.map((d, i) =>
          d.unidades > 0 ? (
            <rect
              key={d.fecha}
              x={x(i) + 1}
              y={yVenta(d.unidades)}
              width={Math.max(1, paso - 2)}
              height={Math.max(1, baseVentas - yVenta(d.unidades))}
              rx={Math.min(2, paso / 3)}
              className="g-barra"
            >
              <title>{`${d.fecha}: ${d.unidades} pares vendidos, ${d.fin} en Full al cierre`}</title>
            </rect>
          ) : null,
        )}

        {/* --- Eje de tiempo ---------------------------------------------- */}
        {marcasX.map(({ d, i }) => (
          <text
            key={d.fecha}
            x={x(i) + paso / 2}
            y={altoTotal - 8}
            textAnchor="middle"
            fontSize={10}
            fill="var(--ink-muted)"
          >
            {d.fecha.slice(5)}
          </text>
        ))}
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--ink-2)" }}>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 14, height: 2, background: AZUL, display: "inline-block" }} />
          Stock disponible
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            style={{ width: 12, height: 10, background: CRITICO, opacity: 0.25, display: "inline-block" }}
          />
          Agotado — sin nada que vender
        </span>
        <span>Pasa el cursor sobre una barra para ver el día.</span>
      </figcaption>
    </figure>
  );
}
