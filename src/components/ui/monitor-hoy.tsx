"use client";

import { useEffect, useRef, useState } from "react";
import { cambio, valorDe, type Cifra, type MonitorHoy as Monitor } from "@/lib/graficas/monitor-hoy";
import { etiquetaHora, type Medida } from "@/lib/graficas/ventas-tiempo";
import { compacto, escala } from "./graficas";

/**
 * Monitor de venta de hoy contra ayer y contra el mismo día de la semana
 * pasada, A LA MISMA HORA (motor en `graficas/monitor-hoy.ts`). Tres cifras,
 * la curva acumulada por hora de los tres días y el desglose por canal.
 */

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ALTO = 180;
const MARGEN = { arriba: 10, abajo: 24, izq: 52, der: 72 };
// Hoy en el café de acento; los días de comparación en grises cálidos, el de
// la semana pasada además punteado: la identidad no va solo en el color.
const LINEAS = {
  hoy: { color: "#8b6640", ancho: 2.5, guiones: undefined },
  ayer: { color: "#998a7b", ancho: 1.75, guiones: undefined },
  semana: { color: "#c9b8a4", ancho: 1.75, guiones: "5 4" },
} as const;

export function MonitorHoy({ monitor }: { monitor: Monitor }) {
  const [medida, setMedida] = useState<Medida>("importe");
  const m = monitor;
  const diaSemana = DIAS[new Date(`${m.semana}T12:00:00Z`).getUTCDay()];
  const hora = horaMinuto(m.minuto);
  const fmt = (x: number) => (medida === "importe" ? pesos(x) : n(x));
  const v = (c: Cifra | null | undefined) => valorDe(c, medida);

  const hoyV = v(m.total.hoy);
  const comparaciones = [
    {
      titulo: "Ayer a esta hora",
      base: m.total.ayer,
      hoy: m.total.hoyContraAyer,
      cerro: m.total.ayerCompleto,
      cerroTexto: "Ayer cerró en",
      fuera: m.sinHoraAyer,
    },
    {
      titulo: `El ${diaSemana} pasado a esta hora`,
      base: m.total.semana,
      hoy: m.total.hoyContraSemana,
      cerro: m.total.semanaCompleto,
      cerroTexto: `El ${diaSemana} pasado cerró en`,
      fuera: m.sinHoraSemana,
    },
  ];
  const fuera = [...new Set([...m.sinHoraAyer, ...m.sinHoraSemana])];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="texto-tenue text-xs">Comparado hasta las {hora}</span>
        <div role="group" className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--borde)" }}>
          {(
            [
              ["importe", "Facturación"],
              ["unidades", "Unidades"],
            ] as const
          ).map(([id, texto]) => (
            <button
              key={id}
              type="button"
              aria-pressed={medida === id}
              onClick={() => setMedida(id)}
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={medida === id ? { background: "var(--acento)", color: "#fff" } : { color: "var(--ink-2)" }}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="texto-2 text-xs font-medium">Hoy hasta ahora</div>
          <div className="cifra mt-1 text-3xl font-semibold">{fmt(hoyV)}</div>
          <div className="texto-tenue mt-0.5 text-xs">
            {medida === "importe" ? `${n(m.total.hoy.u)} unidades` : pesos(m.total.hoy.i)}
          </div>
        </div>
        {comparaciones.map((c) => {
          // Hoy solo con los canales que ese día se pueden partir por hora.
          const d = c.base ? cambio(v(c.hoy), v(c.base)) : null;
          return (
            <div key={c.titulo}>
              <div className="texto-2 text-xs font-medium">{c.titulo}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="cifra text-2xl font-semibold">{c.base ? fmt(v(c.base)) : "—"}</span>
                <Cambio valor={d} grande />
              </div>
              <div className="texto-tenue mt-0.5 text-xs">
                {c.cerroTexto} {fmt(v(c.cerro))}
              </div>
              {c.fuera.length && c.base ? (
                <div className="texto-tenue text-xs">
                  Contra {fmt(v(c.hoy))} de hoy sin {c.fuera.join(", ")}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <Curvas monitor={m} medida={medida} diaSemana={diaSemana} />

      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="datos">
          <thead>
            <tr>
              <th>Canal</th>
              <th className="num">Hoy</th>
              <th className="num">Ayer a esta hora</th>
              <th className="num">vs ayer</th>
              <th className="num">{`${capital(diaSemana)} pasado`}</th>
              <th className="num">vs semana</th>
              <th className="num">Ayer completo</th>
            </tr>
          </thead>
          <tbody>
            {m.canales.map((k) => (
              <tr key={k.canal}>
                <td>
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: k.color }} />
                    {k.nombre}
                  </span>
                </td>
                <td className="num cifra font-medium">{fmt(v(k.hoy.completo))}</td>
                <td className="num cifra">{k.ayer.aEstaHora ? fmt(v(k.ayer.aEstaHora)) : "—"}</td>
                <td className="num">
                  <Cambio valor={k.ayer.aEstaHora ? cambio(v(k.hoy.completo), v(k.ayer.aEstaHora)) : null} />
                </td>
                <td className="num cifra">{k.semana.aEstaHora ? fmt(v(k.semana.aEstaHora)) : "—"}</td>
                <td className="num">
                  <Cambio valor={k.semana.aEstaHora ? cambio(v(k.hoy.completo), v(k.semana.aEstaHora)) : null} />
                </td>
                <td className="num cifra texto-2">{fmt(v(k.ayer.completo))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fuera.length ? (
        <p className="texto-tenue -mt-2 text-xs">
          {fuera.join(", ")} sin hora registrada en el día de comparación: queda fuera de «a esta hora».
        </p>
      ) : null}
    </div>
  );
}

function Cambio({ valor, grande }: { valor: number | null; grande?: boolean }) {
  if (valor == null) return <span className="texto-tenue text-xs">—</span>;
  const pct = Math.round(valor * 100);
  const color = pct > 0 ? "var(--exito-texto)" : pct < 0 ? "var(--critico-texto)" : "var(--ink-2)";
  return (
    <span className={`cifra font-medium ${grande ? "text-sm" : "text-xs"}`} style={{ color }}>
      {pct > 0 ? "▲ +" : pct < 0 ? "▼ " : ""}
      {pct.toLocaleString("es-MX")} %
    </span>
  );
}

function Curvas({ monitor, medida, diaSemana }: { monitor: Monitor; medida: Medida; diaSemana: string }) {
  const [ancho, setAncho] = useState(640);
  const [activo, setActivo] = useState<number | null>(null);
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

  const series = [
    { clave: "semana" as const, nombre: `${capital(diaSemana)} pasado`, puntos: monitor.curvas.semana },
    { clave: "ayer" as const, nombre: "Ayer", puntos: monitor.curvas.ayer },
    { clave: "hoy" as const, nombre: "Hoy", puntos: monitor.curvas.hoy },
  ];
  const val = (c: Cifra) => valorDe(c, medida);
  const { max, ticks } = escala(series.flatMap((s) => s.puntos.map(val)));
  if (max <= 1 && series.every((s) => s.puntos.every((p) => val(p) === 0))) return null;

  const areaW = Math.max(1, ancho - MARGEN.izq - MARGEN.der);
  const areaH = ALTO - MARGEN.arriba - MARGEN.abajo;
  const x = (h: number) => MARGEN.izq + (h / 23) * areaW;
  const y = (v: number) => ALTO - MARGEN.abajo - (max > 0 ? (v / max) * areaH : 0);
  const fmt = (v: number) => (medida === "importe" ? pesos(v) : n(v));

  // Etiquetas al final de cada línea, separadas para que no se encimen.
  const finales = series
    .filter((s) => s.puntos.length)
    .map((s) => ({ ...s, yy: y(val(s.puntos[s.puntos.length - 1])), xx: x(s.puntos.length - 1) }))
    .sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < finales.length; i++) finales[i].yy = Math.max(finales[i].yy, finales[i - 1].yy + 13);

  return (
    <div ref={caja} className="relative select-none" onMouseLeave={() => setActivo(null)}>
      <svg width={ancho} height={ALTO} role="img" aria-label="Venta acumulada por hora: hoy, ayer y la semana pasada" className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={MARGEN.izq} x2={ancho - MARGEN.der} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={MARGEN.izq - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-muted)">
              {compacto(t)}
            </text>
          </g>
        ))}
        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} x={x(h)} y={ALTO - 6} textAnchor="middle" fontSize={11} fill="var(--ink-muted)">
            {etiquetaHora(h)}
          </text>
        ))}
        {activo != null ? <line x1={x(activo)} x2={x(activo)} y1={MARGEN.arriba} y2={ALTO - MARGEN.abajo} stroke="var(--axis)" /> : null}
        {series.map((s) =>
          s.puntos.length ? (
            <polyline
              key={s.clave}
              points={s.puntos.map((p, h) => `${x(h)},${y(val(p))}`).join(" ")}
              fill="none"
              stroke={LINEAS[s.clave].color}
              strokeWidth={LINEAS[s.clave].ancho}
              strokeDasharray={LINEAS[s.clave].guiones}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null,
        )}
        {finales.map((s) => (
          <g key={s.clave}>
            <circle cx={s.xx} cy={y(val(s.puntos[s.puntos.length - 1]))} r={s.clave === "hoy" ? 3.5 : 2.5} fill={LINEAS[s.clave].color} />
            <text x={Math.min(s.xx + 6, ancho - MARGEN.der + 6)} y={s.yy} dy="0.32em" fontSize={11} fill="var(--ink-2)">
              {s.nombre}
            </text>
          </g>
        ))}
        {Array.from({ length: 24 }, (_, h) => (
          <rect
            key={h}
            x={x(h) - areaW / 46}
            y={MARGEN.arriba}
            width={areaW / 23}
            height={areaH}
            fill="transparent"
            onMouseEnter={() => setActivo(h)}
            onClick={() => setActivo(h)}
          />
        ))}
      </svg>
      {activo != null ? (
        <div
          className="pointer-events-none absolute z-10 rounded-lg px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(x(activo) - 90, 0), ancho - 180),
            top: 0,
            width: 180,
            background: "var(--marca)",
            color: "#fff",
          }}
        >
          <div style={{ color: "rgba(255,255,255,.65)" }}>Acumulado hasta las {etiquetaHora((activo + 1) % 24)}</div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {[...series].reverse().map((s) => (
              <li key={s.clave} className="flex justify-between gap-2">
                <span>{s.nombre}</span>
                <span className="cifra">{s.puntos[activo] ? fmt(val(s.puntos[activo])) : "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function horaMinuto(minuto: number): string {
  const h = Math.floor(minuto / 60);
  const mm = String(minuto % 60).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${h < 12 ? "a. m." : "p. m."}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const n = (x: number) => Math.round(x).toLocaleString("es-MX");
const pesos = (x: number) => (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("es-MX");
