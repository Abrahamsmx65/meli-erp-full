"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Gráficas del ERP (rediseño del 9-oct-2026), con las reglas de la guía de
 * visualización: una sola serie = un solo tono (el índigo de acción), sin
 * leyenda (el título dice qué es), columnas de máximo 24 px con la punta
 * redondeada y la base cuadrada, rejilla de 1 px recesiva, pocas etiquetas y
 * el dato exacto al pasar el cursor. El texto nunca va en el color del dato.
 */

export interface PuntoDia {
  /** YYYY-MM-DD */
  fecha: string;
  valor: number;
  /** línea extra del globo («42 pares · 38 órdenes») */
  detalle?: string;
}

const ALTO = 180;
const MARGEN = { arriba: 12, abajo: 24, izq: 52, der: 8 };

export function BarrasPorDia({
  puntos,
  unidad = "pesos",
  etiqueta = "Venta",
}: {
  puntos: PuntoDia[];
  /** cómo se escribe el valor del globo (una función no cruza de servidor a cliente) */
  unidad?: "pesos" | "numero";
  etiqueta?: string;
}) {
  const formato = (x: number) =>
    unidad === "pesos" ? `${x < 0 ? "-" : ""}$${Math.round(Math.abs(x)).toLocaleString("es-MX")}` : Math.round(x).toLocaleString("es-MX");
  const [activo, setActivo] = useState<number | null>(null);
  const [ancho, setAncho] = useState(640);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(240, el.clientWidth));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { max, ticks } = useMemo(() => escala(puntos.map((p) => p.valor)), [puntos]);
  if (!puntos.length) return <div className="vacio">Sin datos en el periodo.</div>;

  const areaW = Math.max(1, ancho - MARGEN.izq - MARGEN.der);
  const areaH = ALTO - MARGEN.arriba - MARGEN.abajo;
  const banda = areaW / puntos.length;
  const barra = Math.min(24, Math.max(3, banda - 2));
  const y = (v: number) => MARGEN.arriba + areaH - (max > 0 ? (v / max) * areaH : 0);
  const cadaCuanto = Math.max(1, Math.ceil(puntos.length / 7));
  const p = activo != null ? puntos[activo] : null;

  return (
    <div
      className="relative w-full select-none"
      ref={caja}
      onMouseLeave={() => setActivo(null)}
    >
      <svg width={ancho} height={ALTO} role="img" aria-label={`${etiqueta} por día`} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={MARGEN.izq} x2={ancho - MARGEN.der} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={MARGEN.izq - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-muted)">
              {compacto(t)}
            </text>
          </g>
        ))}
        {puntos.map((pt, i) => {
          const x = MARGEN.izq + i * banda + (banda - barra) / 2;
          const alto = Math.max(pt.valor > 0 ? 2 : 0, ALTO - MARGEN.abajo - y(pt.valor));
          const tope = ALTO - MARGEN.abajo - alto;
          const r = Math.min(4, barra / 2, alto);
          return (
            <g key={pt.fecha}>
              <path
                d={columna(x, tope, barra, alto, r)}
                fill="var(--acento)"
                opacity={activo == null || activo === i ? 1 : 0.35}
              />
              {/* Zona de cursor: toda la banda, más grande que la barra. */}
              <rect
                x={MARGEN.izq + i * banda}
                y={MARGEN.arriba}
                width={banda}
                height={areaH}
                fill="transparent"
                onMouseEnter={() => setActivo(i)}
                onFocus={() => setActivo(i)}
                tabIndex={0}
                aria-label={`${diaCorto(pt.fecha)}: ${formato(pt.valor)}`}
              />
              {i % cadaCuanto === 0 || i === puntos.length - 1 ? (
                <text
                  x={MARGEN.izq + i * banda + banda / 2}
                  y={ALTO - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--ink-muted)"
                >
                  {diaCorto(pt.fecha)}
                </text>
              ) : null}
            </g>
          );
        })}
        <line
          x1={MARGEN.izq}
          x2={ancho - MARGEN.der}
          y1={ALTO - MARGEN.abajo}
          y2={ALTO - MARGEN.abajo}
          stroke="var(--axis)"
          strokeWidth={1}
        />
      </svg>

      {p && activo != null ? (
        <div
          className="pointer-events-none absolute z-10 rounded-lg px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(MARGEN.izq + activo * banda + banda / 2 - 70, 0), ancho - 140),
            top: Math.max(0, y(p.valor) - 64),
            width: 140,
            background: "var(--marca)",
            color: "#fff",
          }}
        >
          <div style={{ color: "rgba(255,255,255,.65)" }}>{diaLargo(p.fecha)}</div>
          <div className="cifra mt-0.5 text-sm font-semibold">{formato(p.valor)}</div>
          {p.detalle ? <div style={{ color: "rgba(255,255,255,.65)" }}>{p.detalle}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Columna con la punta redondeada (r) y la base cuadrada. */
function columna(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/** Máximo redondo y tres marcas limpias (0, mitad, tope). */
function escala(valores: number[]): { max: number; ticks: number[] } {
  const bruto = Math.max(0, ...valores);
  if (bruto <= 0) return { max: 1, ticks: [0] };
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((s) => s * 4 >= bruto) ?? pot * 10;
  const max = Math.ceil(bruto / paso) * paso;
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += paso) ticks.push(t);
  return { max, ticks };
}

function compacto(x: number): string {
  if (x >= 1_000_000) return `${(x / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} M`;
  if (x >= 1_000) return `${(x / 1_000).toLocaleString("es-MX", { maximumFractionDigits: 0 })} k`;
  return x.toLocaleString("es-MX");
}

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function diaCorto(f: string): string {
  const d = new Date(`${f}T12:00:00Z`);
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}

function diaLargo(f: string): string {
  const d = new Date(`${f}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}
