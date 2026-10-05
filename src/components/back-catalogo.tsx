"use client";

import { useMemo, useState } from "react";
import type { ProductoCatalogo } from "@/lib/tienda/catalogo-amazon";

const n = (x: number) => Math.round(x).toLocaleString("es-MX");
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
type Filtro = "todos" | "visibles" | "ocultos";

/**
 * El back del catálogo para creadores: por modelo, si se ve en la página,
 * su categoría (Productos y costos) y los pares en bodega y en el mar.
 * Cada cambio se guarda en el momento (`POST /api/tiktok/catalogo`).
 */
export function BackCatalogo({ productos, categorias }: { productos: ProductoCatalogo[]; categorias: string[] }) {
  const [renglones, setRenglones] = useState(productos);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [categoria, setCategoria] = useState("");
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opciones, setOpciones] = useState(categorias);

  const palabras = sinAcentos(busca).split(/[\s-]+/).filter(Boolean);
  const visibles = useMemo(
    () =>
      renglones.filter((p) => {
        if (filtro === "visibles" && p.oculto) return false;
        if (filtro === "ocultos" && !p.oculto) return false;
        if (categoria && p.categoria !== categoria) return false;
        const texto = sinAcentos(`${p.modelo} ${p.titulo} ${p.categoria} ${p.colores.map((c) => c.color).join(" ")}`);
        return palabras.every((w) => texto.includes(w));
      }),
    [renglones, filtro, categoria, palabras],
  );
  const totales = visibles.reduce((t, p) => ({ bodega: t.bodega + (p.bodega ?? 0), mar: t.mar + (p.mar ?? 0) }), { bodega: 0, mar: 0 });
  const ocultos = renglones.filter((p) => p.oculto).length;

  async function guardar(modelo: string, cambio: { oculto?: boolean; categoria?: string }) {
    setGuardando(modelo);
    setError(null);
    const antes = renglones;
    setRenglones((rs) =>
      rs.map((p) => (p.modelo === modelo ? { ...p, ...(cambio.oculto != null ? { oculto: cambio.oculto } : {}), ...(cambio.categoria != null ? { categoria: cambio.categoria.trim() || "Otros" } : {}) } : p)),
    );
    try {
      const r = await fetch("/api/tiktok/catalogo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelo, ...cambio }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? `Error ${r.status}`);
      if (cambio.categoria?.trim() && !opciones.includes(cambio.categoria.trim())) setOpciones((o) => [...o, cambio.categoria!.trim()].sort((a, b) => a.localeCompare(b, "es")));
    } catch (e) {
      setRenglones(antes);
      setError(`${modelo}: ${(e as Error).message}`);
    } finally {
      setGuardando(null);
    }
  }

  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 px-4 pt-4">
        <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
          <span>Buscar</span>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="gt135, corcho, negro…" className="mt-1 w-56 rounded-lg border px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
          <span>Categoría</span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="mt-1 rounded-lg border px-2 py-1.5 text-sm">
            <option value="">Todas</option>
            {[...new Set(renglones.map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, "es")).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-1 text-sm">
          {(["todos", "visibles", "ocultos"] as Filtro[]).map((f) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} className={`rounded-lg border px-3 py-1.5 ${filtro === f ? "font-semibold" : ""}`} style={filtro === f ? { background: "var(--ink-1)", color: "var(--surface-1)" } : undefined}>
              {f === "todos" ? `Todos (${renglones.length})` : f === "visibles" ? `Visibles (${renglones.length - ocultos})` : `Ocultos (${ocultos})`}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 px-4 text-xs" style={{ color: "var(--ink-muted)" }}>
        {n(visibles.length)} modelos · {n(totales.bodega)} pares en bodega · {n(totales.mar)} en el mar · {n(totales.bodega + totales.mar)} en total
      </p>
      {error ? (
        <p className="mx-4 mt-2 rounded-lg px-3 py-2 text-sm" style={{ color: "var(--estado-alerta)" }}>
          No se guardó {error}
        </p>
      ) : null}
      <datalist id="categorias-catalogo">
        {opciones.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
              <th className="px-4 py-2 font-semibold">Visible</th>
              <th className="px-4 py-2 font-semibold">Modelo</th>
              <th className="px-4 py-2 font-semibold">Categoría</th>
              <th className="px-4 py-2 text-right font-semibold" title="De Precios para TikTok: relámpago normal (el que sale en la página); abajo live y campaña">
                Precio TikTok
              </th>
              <th className="px-4 py-2 text-right font-semibold">Bodega</th>
              <th className="px-4 py-2 text-right font-semibold">En el mar</th>
              <th className="px-4 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <tr key={p.modelo} className="hairline align-middle" style={p.oculto ? { opacity: 0.55 } : undefined}>
                <td className="px-4 py-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!p.oculto} disabled={guardando === p.modelo} onChange={(e) => guardar(p.modelo, { oculto: !e.target.checked })} />
                    <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {p.oculto ? "Oculto" : "Se ve"}
                    </span>
                  </label>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.colores[0]?.fotos[0] ? <img src={p.colores[0].fotos[0]} alt="" loading="lazy" className="h-12 w-12 rounded border bg-white object-contain" /> : null}
                    <div className="min-w-0">
                      <div className="font-medium">
                        {p.modelo}
                        {!p.activo ? (
                          <span className="ml-2 text-xs font-normal" style={{ color: "var(--ink-muted)" }}>
                            inactivo en Amazon
                          </span>
                        ) : null}
                      </div>
                      <div className="max-w-md truncate text-xs" style={{ color: "var(--ink-2)" }} title={p.titulo}>
                        {p.titulo}
                      </div>
                      <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                        {p.colores.map((c) => c.color).join(", ")}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2">
                  <input
                    key={`${p.modelo}-${p.categoria}`}
                    list="categorias-catalogo"
                    defaultValue={p.categoria}
                    disabled={guardando === p.modelo}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== p.categoria) guardar(p.modelo, { categoria: v });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="w-48 rounded-lg border px-2 py-1 text-sm"
                  />
                </td>
                <td className="num px-4 py-2 text-right">
                  {p.precios ? (
                    <>
                      <span className="font-semibold">${n(p.precios.normal)}</span>
                      <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                        live ${n(p.precios.live)} · campaña ${n(p.precios.campana)}
                      </div>
                    </>
                  ) : (
                    <span className="text-xs" style={{ color: "var(--ink-muted)" }} title="Sin relámpago de MELI en 30 días ni «Mi precio» en Precios para TikTok">
                      sin precio
                    </span>
                  )}
                </td>
                <td className="num px-4 py-2 text-right">{n(p.bodega ?? 0)}</td>
                <td className="num px-4 py-2 text-right">{n(p.mar ?? 0)}</td>
                <td className="num px-4 py-2 text-right font-semibold">{n((p.bodega ?? 0) + (p.mar ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
