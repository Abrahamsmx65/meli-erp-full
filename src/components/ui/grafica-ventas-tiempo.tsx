"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CANALES_TIEMPO,
  canalesSinHora,
  diasConHoras,
  etiquetaHora,
  puntosPorDia,
  puntosPorHora,
  type Medida,
  type SerieTiempo,
  type VentasTiempo,
} from "@/lib/graficas/ventas-tiempo";
import { columna, compacto, diaCorto, diaLargo, escala } from "./graficas";

/**
 * Venta POR DÍA y POR HORA (dueño, 9-oct-2026: «una gráfica por horas y por
 * días en todos los canales y en el general»). Un canal = un tono (el de su
 * marca en la página de inicio); varios canales = columnas apiladas en orden
 * fijo con leyenda y totales, porque el amarillo de TikTok no llega a 3:1
 * contra el fondo y su identidad no puede ir solo en el color. Por hora se
 * suma cada hora de México en TODO el rango y el globo da el promedio por día.
 */

const ALTO = 200;
const MARGEN = { arriba: 12, abajo: 26, izq: 52, der: 8 };

export function GraficaVentasTiempo({
  datos,
  desde,
  hasta,
  inicial = "dia",
}: {
  datos: VentasTiempo[];
  desde: string;
  hasta: string;
  /** la vista con la que abre */
  inicial?: "dia" | "hora";
}) {
  const [vista, setVista] = useState<"dia" | "hora">(inicial);
  const [medida, setMedida] = useState<Medida>("importe");
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

  // Orden y color fijos por canal: el color sigue al canal, nunca a su lugar.
  const series: SerieTiempo[] = useMemo(
    () =>
      CANALES_TIEMPO.flatMap((c) => {
        const d = datos.find((x) => x.canal === c.canal);
        return d ? [{ ...d, nombre: c.nombre, color: c.color }] : [];
      }),
    [datos],
  );
  const enVista = useMemo(() => (vista === "hora" ? series.filter((s) => s.horas.length > 0) : series), [series, vista]);
  const puntos = useMemo(
    () => (vista === "dia" ? puntosPorDia(enVista, desde, hasta, medida) : puntosPorHora(enVista, medida)),
    [enVista, vista, desde, hasta, medida],
  );
  const totales = useMemo(() => puntos.map((p) => Object.values(p.valores).reduce((a, x) => a + x, 0)), [puntos]);
  const porSerie = useMemo(
    () => Object.fromEntries(enVista.map((s) => [s.canal, puntos.reduce((a, p) => a + (p.valores[s.canal] ?? 0), 0)])),
    [enVista, puntos],
  );
  const { max, ticks } = useMemo(() => escala(totales), [totales]);
  const diasHora = useMemo(() => diasConHoras(enVista), [enVista]);
  const sinHora = canalesSinHora(series);

  const formato = (x: number) =>
    medida === "importe" ? `$${Math.round(x).toLocaleString("es-MX")}` : Math.round(x).toLocaleString("es-MX");

  const areaW = Math.max(1, ancho - MARGEN.izq - MARGEN.der);
  const areaH = ALTO - MARGEN.arriba - MARGEN.abajo;
  const banda = areaW / Math.max(1, puntos.length);
  const barra = Math.min(vista === "hora" ? 20 : 24, Math.max(3, banda - 2));
  const escalaY = (v: number) => (max > 0 ? (v / max) * areaH : 0);
  const base = ALTO - MARGEN.abajo;
  const cadaCuanto = vista === "hora" ? 3 : Math.max(1, Math.ceil(puntos.length / 7));
  const p = activo != null ? puntos[activo] : null;
  const etiquetaX = (clave: string) => (vista === "hora" ? etiquetaHora(Number(clave)) : diaCorto(clave));
  const tituloGlobo = (clave: string) =>
    vista === "hora" ? `${etiquetaHora(Number(clave))} a ${etiquetaHora((Number(clave) + 1) % 24)}` : diaLargo(clave);
  const variasSeries = enVista.length > 1;
  const hayDatos = totales.some((t) => t > 0);

  return (
    <div ref={caja}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmentos
          opciones={[
            { id: "dia", texto: "Por día" },
            { id: "hora", texto: "Por hora" },
          ]}
          valor={vista}
          alCambiar={(v) => {
            setVista(v as "dia" | "hora");
            setActivo(null);
          }}
        />
        <Segmentos
          opciones={[
            { id: "importe", texto: "Facturación" },
            { id: "unidades", texto: "Unidades" },
          ]}
          valor={medida}
          alCambiar={(v) => setMedida(v as Medida)}
        />
      </div>

      {variasSeries ? (
        <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
          {enVista.map((s) => (
            <li key={s.canal} className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
              <span className="texto-2">{s.nombre}</span>
              <span className="cifra font-medium">{formato(porSerie[s.canal] ?? 0)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {!hayDatos ? (
        <div className="vacio">{vista === "hora" ? "Sin ventas con hora en el periodo." : "Sin ventas en el periodo."}</div>
      ) : (
        <div className="relative w-full select-none" onMouseLeave={() => setActivo(null)}>
          <svg
            width={ancho}
            height={ALTO}
            role="img"
            aria-label={`${medida === "importe" ? "Facturación" : "Unidades"} ${vista === "hora" ? "por hora del día" : "por día"}`}
            className="block"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={MARGEN.izq} x2={ancho - MARGEN.der} y1={base - escalaY(t)} y2={base - escalaY(t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={MARGEN.izq - 8} y={base - escalaY(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-muted)">
                  {compacto(t)}
                </text>
              </g>
            ))}
            {puntos.map((pt, i) => {
              const x = MARGEN.izq + i * banda + (banda - barra) / 2;
              let acumulado = 0;
              const visibles = enVista.filter((s) => (pt.valores[s.canal] ?? 0) > 0);
              return (
                <g key={pt.clave} opacity={activo == null || activo === i ? 1 : 0.35}>
                  {visibles.map((s, k) => {
                    const h = escalaY(pt.valores[s.canal] ?? 0);
                    const y0 = base - acumulado - h;
                    acumulado += h;
                    const esTope = k === visibles.length - 1;
                    // 2 px de superficie entre segmentos: se le quita al de abajo.
                    const alto = Math.max(0, h - (esTope ? 0 : 2));
                    const yy = esTope ? y0 : y0 + 2;
                    return esTope ? (
                      <path key={s.canal} d={columna(x, yy, barra, alto, Math.min(4, barra / 2, alto))} fill={s.color} />
                    ) : (
                      <rect key={s.canal} x={x} y={yy} width={barra} height={alto} fill={s.color} />
                    );
                  })}
                  <rect
                    x={MARGEN.izq + i * banda}
                    y={MARGEN.arriba}
                    width={banda}
                    height={areaH}
                    fill="transparent"
                    onMouseEnter={() => setActivo(i)}
                    onFocus={() => setActivo(i)}
                    onClick={() => setActivo(i)}
                    tabIndex={0}
                    aria-label={`${tituloGlobo(pt.clave)}: ${formato(totales[i])}`}
                  />
                  {i % cadaCuanto === 0 || (vista === "dia" && i === puntos.length - 1) ? (
                    <text x={MARGEN.izq + i * banda + banda / 2} y={ALTO - 7} textAnchor="middle" fontSize={11} fill="var(--ink-muted)">
                      {etiquetaX(pt.clave)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <line x1={MARGEN.izq} x2={ancho - MARGEN.der} y1={base} y2={base} stroke="var(--axis)" strokeWidth={1} />
          </svg>

          {p && activo != null ? (
            <div
              className="pointer-events-none absolute z-10 rounded-lg px-3 py-2 text-xs shadow-lg"
              style={{
                left: Math.min(Math.max(MARGEN.izq + activo * banda + banda / 2 - 95, 0), ancho - 190),
                top: 0,
                width: 190,
                background: "var(--marca)",
                color: "#fff",
              }}
            >
              <div style={{ color: "rgba(255,255,255,.65)" }}>{tituloGlobo(p.clave)}</div>
              <div className="cifra mt-0.5 text-sm font-semibold">{formato(totales[activo])}</div>
              <div style={{ color: "rgba(255,255,255,.65)" }}>
                {p.ordenes.toLocaleString("es-MX")} órdenes
                {vista === "hora" && diasHora > 1 ? ` · ${formato(totales[activo] / diasHora)} por día` : ""}
              </div>
              {variasSeries ? (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {enVista.map((s) => (
                    <li key={s.canal} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden="true" className="inline-block size-2 rounded-sm" style={{ background: s.color }} />
                        {s.nombre}
                      </span>
                      <span className="cifra">{formato(p.valores[s.canal] ?? 0)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {vista === "hora" && sinHora.length ? (
        <p className="texto-tenue mt-2 text-xs">Sin hora registrada en el periodo: {sinHora.join(", ")}.</p>
      ) : null}
    </div>
  );
}

function Segmentos({
  opciones,
  valor,
  alCambiar,
}: {
  opciones: { id: string; texto: string }[];
  valor: string;
  alCambiar: (id: string) => void;
}) {
  return (
    <div role="group" className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--borde)" }}>
      {opciones.map((o) => {
        const activo = o.id === valor;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={activo}
            onClick={() => alCambiar(o.id)}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={activo ? { background: "var(--acento)", color: "#fff" } : { color: "var(--ink-2)" }}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}
