"use client";

import { useState } from "react";
import type { GrupoDiseno } from "@/lib/yapanizcel/listados";
import type { ResultadoUnificacion } from "@/lib/servicios/listados";
import { estiloInput } from "./comunes";

const ESTADOS: Record<string, { texto: string; color: string }> = {
  active: { texto: "activa", color: "var(--estado-bien)" },
  paused: { texto: "pausada", color: "var(--estado-alerta)" },
  closed: { texto: "cerrada", color: "var(--estado-serio)" },
  under_review: { texto: "en revisión", color: "var(--estado-alerta)" },
};

function ChipEstado({ estado }: { estado: string | null }) {
  const e = (estado && ESTADOS[estado]) || { texto: estado ?? "—", color: "var(--ink-muted)" };
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: "color-mix(in oklab, currentColor 12%, transparent)", color: e.color }}>
      {e.texto}
    </span>
  );
}

const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60";

/**
 * Listados por diseño: todas las publicaciones de un diseño, en vivo, con
 * sus atributos. Dos formas de cambiar: un atributo en TODAS las
 * publicaciones seleccionadas (el caso "Transparente" del 499), o un valor
 * suelto en una variante. Todo escribe directo en MELI y se muestra la
 * respuesta real de MELI cuando rechaza algo.
 */
export function ListadosYz({ disenos }: { disenos: { diseno: string; publicaciones: number; activas: number }[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<GrupoDiseno | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [atributo, setAtributo] = useState("");
  const [valor, setValor] = useState("");
  const [aplicando, setAplicando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoUnificacion[] | null>(null);
  const [edicion, setEdicion] = useState<{ itemId: string; variationId?: string; atributoId?: string; titulo?: boolean; valor: string } | null>(null);

  const leer = async (diseno: string) => {
    const q = diseno.trim();
    if (!q) return;
    setCargando(true);
    setError(null);
    setResultados(null);
    try {
      const r = await fetch(`/api/yapanizcel/listados?diseno=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo leer el diseño.");
      const g = j.grupo as GrupoDiseno;
      setGrupo(g);
      setSeleccion(new Set(g.items.filter((i) => i.estado === "active").map((i) => i.itemId)));
      setBusqueda(g.diseno);
    } catch (err) {
      setGrupo(null);
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  };

  const escribir = async (cuerpo: Record<string, unknown>, aviso: string) => {
    if (!confirm(`${aviso}\n\nEsto escribe directo en Mercado Libre. ¿Continuar?`)) return;
    setAplicando(true);
    setError(null);
    try {
      const r = await fetch("/api/yapanizcel/listados", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await r.json();
      if (!r.ok && !j?.resultados) throw new Error(j?.error ?? "No se pudo escribir.");
      setResultados(j.resultados as ResultadoUnificacion[]);
      setEdicion(null);
      if (grupo) await leer(grupo.diseno);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAplicando(false);
    }
  };

  const unificar = () => {
    if (!grupo || !atributo || !valor.trim()) return;
    const [nivel, id] = atributo.split(":");
    const def = grupo.atributos.find((a) => a.nivel === nivel && a.id === id);
    const ids = [...seleccion];
    void escribir(
      { itemIds: ids, atributoId: id, valor: valor.trim() },
      `Se va a poner "${def?.nombre ?? id}" = "${valor.trim()}" en ${ids.length} publicaciones del diseño ${grupo.diseno}.`,
    );
  };

  const alternar = (id: string) =>
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="flex flex-col gap-5">
      <section className="tarjeta p-4">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void leer(busqueda);
          }}
        >
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Diseño (499, 601…)" className="w-40 rounded-lg border px-3 py-1.5 text-sm" style={estiloInput} list="yz-disenos" />
          <datalist id="yz-disenos">
            {disenos.map((d) => (
              <option key={d.diseno} value={d.diseno}>{`${d.diseno} · ${d.publicaciones} publicaciones`}</option>
            ))}
          </datalist>
          <button type="submit" disabled={cargando} className={btn} style={{ background: "var(--acento)", color: "#fff" }}>
            {cargando ? "Leyendo de MELI…" : "Ver publicaciones"}
          </button>
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            Se leen en vivo: tarda unos segundos.
          </span>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {disenos.slice(0, 120).map((d) => (
            <button key={d.diseno} onClick={() => void leer(d.diseno)} className="num rounded-md border px-2 py-0.5 text-xs" style={{ borderColor: "var(--borde)", background: grupo?.diseno === d.diseno ? "var(--acento-suave)" : "var(--surface-1)" }} title={`${d.activas} activas de ${d.publicaciones}`}>
              {d.diseno}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <p className="text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}

      {resultados ? (
        <section className="tarjeta p-4 text-sm">
          <h3 className="font-semibold">Respuesta de Mercado Libre</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {resultados.map((r, i) => (
              <li key={i} className="num" style={{ color: r.estado === "error" ? "var(--estado-critico)" : r.estado === "actualizado" ? "var(--exito-texto)" : "var(--ink-2)" }}>
                {r.itemId}: {r.estado}
                {r.detalle ? ` — ${r.detalle}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {grupo ? (
        <>
          <section className="tarjeta flex flex-col gap-3 p-4">
            <h2 className="font-semibold">
              Cambiar un atributo en las publicaciones seleccionadas ({seleccion.size} de {grupo.items.length})
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select value={atributo} onChange={(e) => setAtributo(e.target.value)} className="rounded-lg border px-2 py-1.5" style={estiloInput}>
                <option value="">Atributo…</option>
                {grupo.atributos.map((a) => (
                  <option key={`${a.nivel}:${a.id}`} value={`${a.nivel}:${a.id}`}>
                    {a.nombre} ({a.nivel === "variante" ? "por variante" : "publicación"}) — hoy: {a.valores.slice(0, 3).join(", ")}
                    {a.valores.length > 3 ? "…" : ""}
                  </option>
                ))}
              </select>
              <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor nuevo" className="w-56 rounded-lg border px-2 py-1.5" style={estiloInput} />
              <button onClick={unificar} disabled={aplicando || !atributo || !valor.trim() || !seleccion.size} className={btn} style={{ background: "var(--acento)", color: "#fff" }}>
                {aplicando ? "Escribiendo…" : "Aplicar en MELI"}
              </button>
              <button onClick={() => setSeleccion(new Set(grupo.items.map((i) => i.itemId)))} className="text-xs underline">
                Seleccionar todas
              </button>
              <button onClick={() => setSeleccion(new Set())} className="text-xs underline">
                Ninguna
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              El valor se pone tal cual en todas las variantes de cada publicación seleccionada. Si MELI rechaza el cambio (por ejemplo, un eje del selector con ventas), lo dice aquí abajo con su mensaje.
            </p>
          </section>

          {grupo.items.map((it) => (
            <section key={it.itemId} className="tarjeta p-4">
              <div className="flex flex-wrap items-start gap-3">
                <input type="checkbox" checked={seleccion.has(it.itemId)} onChange={() => alternar(it.itemId)} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ChipEstado estado={it.estado} />
                    <span className="num text-xs" style={{ color: "var(--ink-muted)" }}>
                      {it.itemId}
                    </span>
                    {it.permalink ? (
                      <a href={it.permalink} target="_blank" rel="noreferrer" className="text-xs underline" style={{ color: "var(--acento)" }}>
                        ver en MELI
                      </a>
                    ) : null}
                  </div>
                  {edicion?.itemId === it.itemId && edicion.titulo ? (
                    <form
                      className="mt-1 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void escribir({ itemId: it.itemId, titulo: edicion.valor }, `Se va a cambiar el título de ${it.itemId}.`);
                      }}
                    >
                      <input value={edicion.valor} onChange={(e) => setEdicion({ ...edicion, valor: e.target.value })} maxLength={60} className="w-full rounded-lg border px-2 py-1 text-sm" style={estiloInput} />
                      <button type="submit" disabled={aplicando} className={btn} style={{ background: "var(--acento)", color: "#fff" }}>
                        Guardar
                      </button>
                      <button type="button" onClick={() => setEdicion(null)} className="text-xs underline">
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <h3 className="mt-1 font-semibold">
                      {it.titulo}{" "}
                      <button onClick={() => setEdicion({ itemId: it.itemId, titulo: true, valor: it.titulo })} className="ml-1 text-xs font-normal underline" style={{ color: "var(--ink-muted)" }}>
                        editar título
                      </button>
                    </h3>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {it.atributos.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setEdicion({ itemId: it.itemId, atributoId: a.id, valor: a.valor })}
                        className="rounded-md border px-2 py-0.5 text-xs"
                        style={{ borderColor: "var(--borde)" }}
                        title="Cambiar en toda la publicación"
                      >
                        <span style={{ color: "var(--ink-muted)" }}>{a.nombre}:</span> {a.valor}
                      </button>
                    ))}
                  </div>
                  {edicion?.itemId === it.itemId && edicion.atributoId && !edicion.variationId ? (
                    <form
                      className="mt-2 flex flex-wrap items-center gap-2 text-sm"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void escribir({ itemIds: [it.itemId], atributoId: edicion.atributoId, valor: edicion.valor }, `Se va a poner ${edicion.atributoId} = "${edicion.valor}" en toda la publicación ${it.itemId}.`);
                      }}
                    >
                      <span className="num text-xs">{edicion.atributoId}</span>
                      <input value={edicion.valor} onChange={(e) => setEdicion({ ...edicion, valor: e.target.value })} className="w-56 rounded-lg border px-2 py-1" style={estiloInput} autoFocus />
                      <button type="submit" disabled={aplicando} className={btn} style={{ background: "var(--acento)", color: "#fff" }}>
                        Guardar en MELI
                      </button>
                      <button type="button" onClick={() => setEdicion(null)} className="text-xs underline">
                        Cancelar
                      </button>
                    </form>
                  ) : null}

                  {it.variantes.length ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
                            <th className="px-2 py-1">SKU</th>
                            <th className="px-2 py-1">Selector</th>
                            <th className="px-2 py-1 text-right">Stock</th>
                            <th className="px-2 py-1">Atributos de la variante (clic para cambiar)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {it.variantes.map((v) => (
                            <tr key={v.variationId} className="border-t align-top" style={{ borderColor: "var(--grid)" }}>
                              <td className="num px-2 py-1">{v.sku ?? <span style={{ color: "var(--ink-muted)" }}>sin SKU</span>}</td>
                              <td className="px-2 py-1">{v.combinacion}</td>
                              <td className="num px-2 py-1 text-right">{v.stock ?? "—"}</td>
                              <td className="px-2 py-1">
                                <div className="flex flex-wrap gap-1">
                                  {v.atributos.map((a) => (
                                    <button key={a.id} onClick={() => setEdicion({ itemId: it.itemId, variationId: v.variationId, atributoId: a.id, valor: a.valor })} className="rounded-md border px-1.5 py-0.5 text-xs" style={{ borderColor: "var(--borde)" }}>
                                      <span style={{ color: "var(--ink-muted)" }}>{a.nombre}:</span> {a.valor}
                                    </button>
                                  ))}
                                </div>
                                {edicion?.itemId === it.itemId && edicion.variationId === v.variationId ? (
                                  <form
                                    className="mt-1 flex flex-wrap items-center gap-2"
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      void escribir({ itemId: it.itemId, variationId: v.variationId, atributoId: edicion.atributoId, valor: edicion.valor }, `Se va a poner ${edicion.atributoId} = "${edicion.valor}" solo en la variante ${v.combinacion || v.variationId} de ${it.itemId}.`);
                                    }}
                                  >
                                    <span className="num text-xs">{edicion.atributoId}</span>
                                    <input value={edicion.valor} onChange={(e) => setEdicion({ ...edicion, valor: e.target.value })} className="w-48 rounded-lg border px-2 py-0.5 text-xs" style={estiloInput} autoFocus />
                                    <button type="submit" disabled={aplicando} className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: "var(--acento)", color: "#fff" }}>
                                      Guardar
                                    </button>
                                    <button type="button" onClick={() => setEdicion(null)} className="text-xs underline">
                                      Cancelar
                                    </button>
                                  </form>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ))}
        </>
      ) : null}
    </div>
  );
}
