"use client";

/**
 * Existencias por CATEGORÍA que se abre por MODELO (dueño, 25-nov-2026: «no
 * es nada claro, algo más legible que se vaya abriendo; ver por categoría y
 * luego abrir abajo y ver cómo se divide por modelo; las que están en cero
 * que no salgan»). Solo pinta: los números ya vienen de
 * `inversionPorCategoria`. Lo que está en cero (una categoría, un modelo o
 * un lugar entero, como el barco de las fundas) no sale.
 */
import { Fragment, useMemo, useState } from "react";
import type { InversionCategoria, InversionEnBodega, InversionModelo } from "@/lib/servicios/inventario";

type Lugar = "enBodega" | "enCamino" | "enFull" | "enFba" | "enTikTok";

export const LUGARES: { id: Lugar; nombre: string; color: string }[] = [
  { id: "enBodega", nombre: "Bodega", color: "#6b4b2e" },
  { id: "enCamino", nombre: "En barco", color: "#d3a52e" },
  { id: "enFull", nombre: "Full", color: "#5b8a72" },
  { id: "enFba", nombre: "FBA", color: "#c07a4e" },
  { id: "enTikTok", nombre: "TikTok", color: "#3a2c21" },
];

const n = (x: number) => Math.round(x).toLocaleString("es-MX");
const pesos = (x: number) => "$" + Math.round(x).toLocaleString("es-MX");
const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;

type ConLugares = {
  pares: Record<Lugar, number>;
  valor: Record<Lugar, number> & { total: number };
};
const paresDe = (x: ConLugares) => LUGARES.reduce((a, l) => a + x.pares[l.id], 0);

/** Barra apilada fina: cuánto del valor está en cada lugar. */
function BarraLugares({ x, lugares, alto = 8 }: { x: ConLugares; lugares: typeof LUGARES; alto?: number }) {
  const total = x.valor.total;
  if (total <= 0) return null;
  const titulo = lugares
    .filter((l) => x.valor[l.id] > 0)
    .map((l) => `${l.nombre}: ${pesos(x.valor[l.id])} (${pct(x.valor[l.id] / total)})`)
    .join(" · ");
  return (
    <div
      className="flex w-full overflow-hidden rounded-full"
      style={{ height: alto, background: "var(--grid)" }}
      title={titulo}
      aria-label={titulo}
    >
      {lugares.map((l) =>
        x.valor[l.id] > 0 ? (
          <span key={l.id} style={{ width: `${(x.valor[l.id] / total) * 100}%`, background: l.color }} />
        ) : null,
      )}
    </div>
  );
}

/**
 * «¿Dónde está el dinero?»: una barra grande y debajo un renglón por lugar
 * con pares, valor y su parte. Los lugares en cero no salen.
 */
export function DondeEsta({
  inversion,
  unidad,
  notaBarco,
}: {
  inversion: InversionEnBodega;
  unidad: string;
  notaBarco?: string | null;
}) {
  const pares: Record<Lugar, number> = { enBodega: 0, enCamino: 0, enFull: 0, enFba: 0, enTikTok: 0 };
  for (const c of inversion.categorias) for (const l of LUGARES) pares[l.id] += c.pares[l.id];
  const x: ConLugares = { pares, valor: inversion.total };
  const lugares = LUGARES.filter((l) => inversion.total[l.id] > 0 || pares[l.id] > 0);
  const total = inversion.total.total;
  if (total <= 0) return <p className="texto-2 text-sm">No hay nada costeado.</p>;
  return (
    <div className="space-y-4">
      <BarraLugares x={x} lugares={lugares} alto={14} />
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))` }}>
        {lugares.map((l) => (
          <div key={l.id} className="rounded-lg border p-3 hairline" style={{ background: "var(--surface-1)" }}>
            <div className="flex items-center gap-2 text-[13px] texto-2">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
              {l.nombre}
              <span className="ml-auto cifra texto-tenue">{pct(inversion.total[l.id] / total)}</span>
            </div>
            <div className="cifra mt-1 text-lg font-semibold">{pesos(inversion.total[l.id])}</div>
            <div className="cifra text-[12px] texto-tenue">
              {n(pares[l.id])} {unidad}
            </div>
            {l.id === "enCamino" && notaBarco ? <div className="mt-1 text-[11px] texto-tenue">{notaBarco}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Chevron({ abierto }: { abierto: boolean }) {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 12 12"
      className="shrink-0 transition-transform"
      style={{ transform: abierto ? "rotate(90deg)" : "none", transitionTimingFunction: "var(--ease-out)" }}
    >
      <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Ganancia estimada con su parte sobre la inversión; «—» si no hay con qué. */
function Ganancia({ g, fuerte }: { g: { pares: number; ganancia: number; costo: number }; fuerte?: boolean }) {
  if (!g.pares) return <span className="texto-tenue">—</span>;
  const color = g.ganancia < 0 ? "var(--critico-texto)" : undefined;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={`cifra ${fuerte ? "font-semibold" : ""}`} style={{ color }}>
        {pesos(g.ganancia)}
      </span>
      {g.costo > 0 ? (
        <span className="text-[11px] texto-tenue cifra">+{Math.round((g.ganancia / g.costo) * 100)}% sobre costo</span>
      ) : null}
    </span>
  );
}

/** Inversión con su parte del total en una barrita. */
function Inversion({ valor, parte, fuerte }: { valor: number; parte: number; fuerte?: boolean }) {
  return (
    <span className="inline-flex w-full flex-col items-end gap-1">
      <span className={`cifra ${fuerte ? "font-semibold" : ""}`}>{pesos(valor)}</span>
      <span className="flex w-full max-w-[120px] items-center gap-1.5">
        <span className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "var(--grid)" }}>
          <span className="block h-full" style={{ width: `${Math.min(100, parte * 100)}%`, background: "var(--acento)" }} />
        </span>
        <span className="cifra text-[11px] texto-tenue w-9 text-right">{pct(parte)}</span>
      </span>
    </span>
  );
}

export function CategoriasExistencias({
  inversion,
  unidad,
}: {
  inversion: InversionEnBodega;
  unidad: string;
}) {
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [porLugar, setPorLugar] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const total = inversion.total.total;
  const lugares = LUGARES.filter((l) => inversion.total[l.id] > 0);
  const categorias = useMemo(
    () => inversion.categorias.filter((c) => c.valor.total > 0 || paresDe(c) > 0),
    [inversion],
  );

  // Buscar un modelo abre su categoría y deja solo los que coinciden.
  const q = busqueda.trim().toUpperCase().replace(/[\s-]+/g, "");
  const modelosDe = (c: InversionCategoria): InversionModelo[] =>
    (c.porModelo ?? []).filter(
      (m) => (m.valor.total > 0 || paresDe(m) > 0) && (!q || m.modelo.replace(/[\s-]+/g, "").includes(q)),
    );
  const visibles = q ? categorias.filter((c) => modelosDe(c).length > 0) : categorias;
  const estaAbierta = (c: string) => Boolean(q) || abiertas.has(c);

  const alternar = (c: string) =>
    setAbiertas((prev) => {
      const s = new Set(prev);
      if (s.has(c)) s.delete(c);
      else s.add(c);
      return s;
    });
  const todasAbiertas = categorias.length > 0 && categorias.every((c) => abiertas.has(c.categoria));
  const columnas = 5 + (porLugar ? lugares.length : 1);

  if (categorias.length === 0) return <p className="texto-2 p-4 text-sm">No hay nada costeado.</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b p-3 hairline">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar modelo (GT148…)"
          className="min-w-[200px] flex-1 sm:max-w-xs"
          aria-label="Buscar modelo"
        />
        <label className="flex items-center gap-1.5 text-[13px] texto-2">
          <input type="checkbox" checked={porLugar} onChange={(e) => setPorLugar(e.target.checked)} />
          Ver valor por lugar
        </label>
        <button
          type="button"
          className="boton-borde boton-chico ml-auto"
          onClick={() => setAbiertas(todasAbiertas ? new Set() : new Set(categorias.map((c) => c.categoria)))}
        >
          {todasAbiertas ? "Cerrar todas" : "Abrir todas"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Categoría / modelo</th>
              <th className="num">{unidad[0].toUpperCase() + unidad.slice(1)}</th>
              {porLugar ? (
                lugares.map((l) => (
                  <th key={l.id} className="num">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
                      {l.nombre}
                    </span>
                  </th>
                ))
              ) : (
                <th style={{ minWidth: 140 }}>Dónde está</th>
              )}
              <th className="num" style={{ minWidth: 150 }}>
                Inversión
              </th>
              <th className="num">Depósito MELI</th>
              <th className="num">Ganancia estimada</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((c) => {
              const abierta = estaAbierta(c.categoria);
              const modelos = modelosDe(c);
              return (
                <Fragment key={c.categoria}>
                  <tr
                    onClick={() => !q && alternar(c.categoria)}
                    className="cursor-pointer"
                    style={abierta ? { background: "var(--surface-2)" } : undefined}
                  >
                    <td>
                      <button
                        type="button"
                        className="flex items-center gap-2 text-left font-semibold"
                        aria-expanded={abierta}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!q) alternar(c.categoria);
                        }}
                      >
                        <Chevron abierto={abierta} />
                        {c.categoria}
                        <span className="font-normal text-[12px] texto-tenue">
                          {n(c.porModelo ? c.porModelo.filter((m) => m.valor.total > 0 || paresDe(m) > 0).length : c.modelos)}{" "}
                          modelos
                        </span>
                      </button>
                    </td>
                    <td className="num cifra">{n(paresDe(c))}</td>
                    {porLugar ? (
                      lugares.map((l) => (
                        <td key={l.id} className="num cifra">
                          {c.valor[l.id] > 0 ? pesos(c.valor[l.id]) : <span className="texto-tenue">—</span>}
                        </td>
                      ))
                    ) : (
                      <td>
                        <BarraLugares x={c} lugares={lugares} />
                      </td>
                    )}
                    <td className="num">
                      <Inversion valor={c.valor.total} parte={total > 0 ? c.valor.total / total : 0} fuerte />
                    </td>
                    <td className="num cifra texto-2">{c.ganancia.pares ? pesos(c.ganancia.deposito) : "—"}</td>
                    <td className="num">
                      <Ganancia g={c.ganancia} fuerte />
                    </td>
                  </tr>
                  {abierta
                    ? modelos.map((m) => (
                        <tr key={`${c.categoria}:${m.modelo}`} className="text-[13px]" style={{ background: "var(--surface-2)" }}>
                          <td>
                            <span className="flex items-center gap-2 pl-6">
                              <span className="font-medium">{m.modelo}</span>
                              <span className="text-[11px] texto-tenue cifra">{pesos(m.costo)} c/u</span>
                              {m.porPromedio ? (
                                <span
                                  className="text-[11px] texto-tenue"
                                  title="Vendió menos de 10 en MELI en 30 días: su venta se estima con el promedio"
                                >
                                  · promedio
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="num cifra">{n(paresDe(m))}</td>
                          {porLugar ? (
                            lugares.map((l) => (
                              <td key={l.id} className="num cifra texto-2">
                                {m.valor[l.id] > 0 ? pesos(m.valor[l.id]) : <span className="texto-tenue">—</span>}
                              </td>
                            ))
                          ) : (
                            <td>
                              <BarraLugares x={m} lugares={lugares} alto={6} />
                            </td>
                          )}
                          <td className="num">
                            <Inversion valor={m.valor.total} parte={c.valor.total > 0 ? m.valor.total / c.valor.total : 0} />
                          </td>
                          <td className="num cifra texto-2">{m.ganancia.pares ? pesos(m.ganancia.deposito) : "—"}</td>
                          <td className="num">
                            <Ganancia g={m.ganancia} />
                          </td>
                        </tr>
                      ))
                    : null}
                  {abierta && !c.porModelo ? (
                    <tr>
                      <td colSpan={columnas} className="pl-10 text-[12px] texto-tenue">
                        El desglose por modelo sale en la siguiente actualización.
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--surface-2)" }}>
              <td className="font-semibold">Total</td>
              <td className="num cifra font-semibold">{n(categorias.reduce((a, c) => a + paresDe(c), 0))}</td>
              {porLugar ? (
                lugares.map((l) => (
                  <td key={l.id} className="num cifra font-semibold">
                    {pesos(inversion.total[l.id])}
                  </td>
                ))
              ) : (
                <td>
                  <BarraLugares x={{ pares: { enBodega: 0, enCamino: 0, enFull: 0, enFba: 0, enTikTok: 0 }, valor: inversion.total }} lugares={lugares} />
                </td>
              )}
              <td className="num cifra font-semibold">{pesos(total)}</td>
              <td className="num cifra font-semibold">{inversion.ganancia.pares ? pesos(inversion.ganancia.deposito) : "—"}</td>
              <td className="num">
                <Ganancia g={inversion.ganancia} fuerte />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
