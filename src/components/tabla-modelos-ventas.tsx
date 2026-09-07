"use client";

import { useMemo, useState } from "react";
import type { FilaModelo } from "@/lib/servicios/ventas-monitor";

/**
 * La tabla "Por modelo" del monitor de ventas, con buscador, filtro por
 * categoría y columnas ordenables. Todo en el navegador: los renglones ya
 * vienen calculados del servidor y son unos cientos, no hace falta ir por
 * ellos otra vez para reordenarlos.
 */

type Clave = "modelo" | "categoria" | "colores" | "unidadesHoy" | "unidades7" | "unidades7Prev" | "cambio" | "importe7" | "neto7" | "ganancia7";

const COLUMNAS: { clave: Clave; titulo: string; num: boolean }[] = [
  { clave: "modelo", titulo: "Modelo", num: false },
  { clave: "categoria", titulo: "Categoría", num: false },
  { clave: "colores", titulo: "Colores", num: true },
  { clave: "unidadesHoy", titulo: "Hoy", num: true },
  { clave: "unidades7", titulo: "Periodo", num: true },
  { clave: "unidades7Prev", titulo: "Previo", num: true },
  { clave: "cambio", titulo: "Cambio", num: true },
  { clave: "importe7", titulo: "Importe", num: true },
  { clave: "neto7", titulo: "Neto", num: true },
  { clave: "ganancia7", titulo: "Ganancia", num: true },
];

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

function valor(f: FilaModelo, clave: Clave): string | number | null {
  if (clave === "cambio") return f.unidades7 - f.unidades7Prev;
  return f[clave];
}

export function TablaModelosVentas({ filas }: { filas: FilaModelo[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [orden, setOrden] = useState<{ clave: Clave; desc: boolean }>({ clave: "unidades7", desc: true });

  const categorias = useMemo(
    () => [...new Set(filas.map((f) => f.categoria ?? "Sin categoría"))].sort((a, b) => a.localeCompare(b, "es")),
    [filas],
  );

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    const lista = filas.filter((f) => {
      if (categoria && (f.categoria ?? "Sin categoría") !== categoria) return false;
      // Busca por modelo o por el inicio de un SKU (GT114-NEGRO-25 → GT114).
      if (q && !f.modelo.toUpperCase().includes(q) && !q.startsWith(f.modelo.toUpperCase() + "-")) return false;
      return true;
    });
    const dir = orden.desc ? -1 : 1;
    lista.sort((a, b) => {
      const va = valor(a, orden.clave);
      const vb = valor(b, orden.clave);
      // Lo que no tiene dato (sin costo, sin categoría) siempre va al final.
      if (va == null && vb == null) return a.modelo.localeCompare(b.modelo, "es");
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" || typeof vb === "string") return dir * String(va).localeCompare(String(vb), "es");
      return dir * (va - vb) || a.modelo.localeCompare(b.modelo, "es");
    });
    return lista;
  }, [filas, busqueda, categoria, orden]);

  const totales = useMemo(() => {
    const t = { unidades7: 0, unidades7Prev: 0, importe7: 0, neto7: 0, ganancia7: 0, conCosto: false };
    for (const f of visibles) {
      t.unidades7 += f.unidades7;
      t.unidades7Prev += f.unidades7Prev;
      t.importe7 += f.importe7;
      t.neto7 += f.neto7;
      if (f.ganancia7 != null) {
        t.ganancia7 += f.ganancia7;
        t.conCosto = true;
      }
    }
    return t;
  }, [visibles]);

  const ordenarPor = (clave: Clave) =>
    setOrden((o) => (o.clave === clave ? { clave, desc: !o.desc } : { clave, desc: clave !== "modelo" && clave !== "categoria" }));

  const colorDelta = (d: number) => (d > 0 ? "var(--exito-texto)" : d < 0 ? "var(--estado-critico)" : "var(--ink-muted)");

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b p-3 hairline text-sm">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Modelo o SKU (GT114, GT114-NEGRO-25…)"
          className="min-w-[16rem] rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          aria-label="Buscar modelo"
        />
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className="rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          aria-label="Categoría"
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
          {visibles.length} de {filas.length} modelos · ordenado por {COLUMNAS.find((c) => c.clave === orden.clave)?.titulo.toLowerCase()}{" "}
          {orden.desc ? "↓" : "↑"}
        </span>
      </div>
      <div className="max-h-[36rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              {COLUMNAS.map((c) => (
                <th key={c.clave} className={c.num ? "num" : ""}>
                  <button
                    type="button"
                    onClick={() => ordenarPor(c.clave)}
                    className="inline-flex items-center gap-1 font-semibold"
                    style={{ color: orden.clave === c.clave ? "var(--acento)" : undefined }}
                    title={`Ordenar por ${c.titulo.toLowerCase()}`}
                  >
                    {c.titulo}
                    {orden.clave === c.clave ? <span aria-hidden="true">{orden.desc ? "↓" : "↑"}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const delta = f.unidades7 - f.unidades7Prev;
              return (
                <tr key={f.modelo}>
                  <td className="font-medium">{f.modelo}</td>
                  <td style={{ color: f.categoria ? "var(--ink-2)" : "var(--ink-muted)" }}>{f.categoria ?? "Sin categoría"}</td>
                  <td className="num cifra">{f.colores}</td>
                  <td className="num cifra">{n(f.unidadesHoy)}</td>
                  <td className="num cifra font-semibold">{n(f.unidades7)}</td>
                  <td className="num cifra" style={{ color: "var(--ink-muted)" }}>
                    {n(f.unidades7Prev)}
                  </td>
                  <td className="num cifra" style={{ color: colorDelta(delta) }}>
                    {delta > 0 ? `+${n(delta)}` : n(delta)}
                  </td>
                  <td className="num cifra">{pesos(f.importe7)}</td>
                  <td className="num cifra">{pesos(f.neto7)}</td>
                  <td className="num cifra" style={{ color: f.ganancia7 != null && f.ganancia7 < 0 ? "var(--estado-critico)" : f.ganancia7 == null ? "var(--ink-muted)" : "var(--ink-1)" }}>
                    {f.ganancia7 == null ? "sin costo" : pesos(f.ganancia7)}
                  </td>
                </tr>
              );
            })}
            {visibles.length === 0 ? (
              <tr>
                <td colSpan={COLUMNAS.length} className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
                  Ningún modelo coincide con el filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
          {visibles.length > 1 ? (
            <tfoot>
              <tr style={{ background: "var(--surface-2)" }}>
                <td className="font-semibold" colSpan={4}>
                  Total de lo filtrado
                </td>
                <td className="num cifra font-semibold">{n(totales.unidades7)}</td>
                <td className="num cifra" style={{ color: "var(--ink-muted)" }}>
                  {n(totales.unidades7Prev)}
                </td>
                <td className="num cifra" style={{ color: colorDelta(totales.unidades7 - totales.unidades7Prev) }}>
                  {totales.unidades7 - totales.unidades7Prev > 0 ? "+" : ""}
                  {n(totales.unidades7 - totales.unidades7Prev)}
                </td>
                <td className="num cifra font-semibold">{pesos(totales.importe7)}</td>
                <td className="num cifra font-semibold">{pesos(totales.neto7)}</td>
                <td className="num cifra font-semibold">{totales.conCosto ? pesos(totales.ganancia7) : "—"}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
