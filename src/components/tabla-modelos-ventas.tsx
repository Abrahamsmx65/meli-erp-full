"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  expandirFilaModelo,
  prepararFilasTabla,
  totalizarFilasTabla,
  type ClaveTablaVentas,
  type FilaModeloCompacta,
} from "@/lib/servicios/ventas-tabla";

/**
 * La tabla "Por modelo" del monitor de ventas, con buscador, filtro por
 * categoría y columnas ordenables. Las filas llegan calculadas y compactas;
 * el trabajo derivado se difiere y el DOM se pagina para no frenar el
 * navegador aunque aumente el catálogo.
 */

type Clave = ClaveTablaVentas;
const FILAS_POR_PAGINA = 100;

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
  { clave: "publicidad7", titulo: "Publicidad", num: true },
  { clave: "ganancia7", titulo: "Ganancia", num: true },
];

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

export function TablaModelosVentas({ filas }: { filas: FilaModeloCompacta[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [orden, setOrden] = useState<{ clave: Clave; desc: boolean }>({ clave: "unidades7", desc: true });
  const [pagina, setPagina] = useState(1);
  const busquedaDiferida = useDeferredValue(busqueda);

  const categorias = useMemo(
    () => [...new Set(filas.map((f) => expandirFilaModelo(f).categoria ?? "Sin categoría"))].sort((a, b) => a.localeCompare(b, "es")),
    [filas],
  );

  const visibles = useMemo(
    () => prepararFilasTabla(filas, busquedaDiferida, categoria, orden),
    [filas, busquedaDiferida, categoria, orden],
  );
  const paginas = Math.max(1, Math.ceil(visibles.length / FILAS_POR_PAGINA));
  const paginaSegura = Math.min(pagina, paginas);
  const renderizadas = visibles.slice(
    (paginaSegura - 1) * FILAS_POR_PAGINA,
    paginaSegura * FILAS_POR_PAGINA,
  );

  const totales = useMemo(() => totalizarFilasTabla(visibles), [visibles]);

  const ordenarPor = (clave: Clave) => {
    setPagina(1);
    setOrden((o) => (o.clave === clave ? { clave, desc: !o.desc } : { clave, desc: clave !== "modelo" && clave !== "categoria" }));
  };

  const colorDelta = (d: number) => (d > 0 ? "var(--exito-texto)" : d < 0 ? "var(--estado-critico)" : "var(--ink-muted)");

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b p-3 hairline text-sm">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setPagina(1);
          }}
          placeholder="Modelo o SKU (GT114, GT114-NEGRO-25…)"
          className="min-w-[16rem] rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          aria-label="Buscar modelo"
        />
        <select
          value={categoria}
          onChange={(e) => {
            setCategoria(e.target.value);
            setPagina(1);
          }}
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
          {busqueda !== busquedaDiferida ? "Actualizando… · " : ""}
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
            {renderizadas.map((f) => {
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
                  <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                    {f.publicidad7 == null ? "—" : pesos(f.publicidad7)}
                  </td>
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
                <td className="num cifra font-semibold">{totales.conAds ? pesos(totales.publicidad7) : "—"}</td>
                <td className="num cifra font-semibold">{totales.conCosto ? pesos(totales.ganancia7) : "—"}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {paginas > 1 ? (
        <nav
          aria-label="Páginas de modelos"
          className="flex items-center justify-between gap-3 border-t p-3 hairline text-sm"
        >
          <span style={{ color: "var(--ink-2)" }}>
            Mostrando {(paginaSegura - 1) * FILAS_POR_PAGINA + 1}–
            {Math.min(paginaSegura * FILAS_POR_PAGINA, visibles.length)} de {visibles.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={paginaSegura === 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              className="rounded-lg border px-3 py-1 disabled:opacity-40"
              style={{ borderColor: "var(--borde)" }}
            >
              Anterior
            </button>
            <span className="cifra">
              {paginaSegura} / {paginas}
            </span>
            <button
              type="button"
              disabled={paginaSegura === paginas}
              onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
              className="rounded-lg border px-3 py-1 disabled:opacity-40"
              style={{ borderColor: "var(--borde)" }}
            >
              Siguiente
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
