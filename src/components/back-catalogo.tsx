"use client";

import { useMemo, useState } from "react";
import { Aviso } from "@/components/ui/pagina";
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
  const totales = visibles.reduce(
    (t, p) => ({ bodega: t.bodega + (p.bodega ?? 0), mar: t.mar + (p.mar ?? 0), tiktok: t.tiktok + (p.tiktok ?? 0) }),
    { bodega: 0, mar: 0, tiktok: 0 },
  );
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
        <label className="flex flex-col text-xs texto-2">
          <span>Buscar</span>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="gt135, corcho, negro…" className="mt-1 w-56 rounded-lg border px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col text-xs texto-2">
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
      <p className="mt-2 px-4 text-xs texto-tenue">
        {n(visibles.length)} modelos · {n(totales.bodega)} pares en bodega · {n(totales.mar)} en camino de China (mar y pedidos) ·{" "}
        {n(totales.tiktok)} en la bodega de TikTok · {n(totales.bodega + totales.mar + totales.tiktok)} en total
      </p>
      {error ? (
        <Aviso tono="alerta" className="mx-4 mt-2">
          No se guardó {error}
        </Aviso>
      ) : null}
      <datalist id="categorias-catalogo">
        {opciones.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="tabla-caja mt-3">
        <table className="datos">
          <thead>
            <tr>
              <th>Visible</th>
              <th>Modelo</th>
              <th>Categoría</th>
              <th className="num" title="De Precios para TikTok: relámpago normal (el que sale en la página); abajo live y campaña">
                Precio TikTok
              </th>
              <th className="num">Bodega</th>
              <th className="num" title="En el mar y pedidos de China que la bodega aún no ve">
                China
              </th>
              <th className="num">TikTok</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <tr key={p.modelo} className="align-middle" style={p.oculto ? { opacity: 0.55 } : undefined}>
                <td>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!p.oculto} disabled={guardando === p.modelo} onChange={(e) => guardar(p.modelo, { oculto: !e.target.checked })} />
                    <span className="text-xs texto-tenue">
                      {p.oculto ? "Oculto" : "Se ve"}
                    </span>
                  </label>
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.colores[0]?.fotos[0] ? <img src={p.colores[0].fotos[0]} alt="" loading="lazy" className="h-12 w-12 rounded border bg-white object-contain" /> : null}
                    <div className="min-w-0">
                      <div className="font-medium">
                        {p.modelo}
                        {!p.activo ? (
                          <span className="ml-2 text-xs font-normal texto-tenue">
                            inactivo en Amazon
                          </span>
                        ) : null}
                      </div>
                      <div className="max-w-md truncate text-xs texto-2" title={p.titulo}>
                        {p.titulo}
                      </div>
                      <div className="text-xs texto-tenue">
                        {p.colores.map((c) => c.color).join(", ")}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
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
                <td className="num cifra">
                  {p.precios ? (
                    <>
                      <span className="font-semibold">${n(p.precios.normal)}</span>
                      <div className="text-xs texto-tenue">
                        live ${n(p.precios.live)} · campaña ${n(p.precios.campana)}
                      </div>
                    </>
                  ) : (
                    <span className="text-xs texto-tenue" title="Sin relámpago de MELI en 30 días ni «Mi precio» en Precios para TikTok">
                      sin precio
                    </span>
                  )}
                </td>
                <td className="num cifra">{n(p.bodega ?? 0)}</td>
                <td className="num cifra">{n(p.mar ?? 0)}</td>
                <td className="num cifra">{n(p.tiktok ?? 0)}</td>
                <td className="num cifra font-semibold">{n(p.total ?? (p.bodega ?? 0) + (p.mar ?? 0) + (p.tiktok ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
