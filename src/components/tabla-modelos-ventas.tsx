"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  expandirFilaModelo,
  type ClaveTablaVentas,
  type PaginaTablaVentas,
} from "@/lib/servicios/ventas-tabla";

/**
 * La tabla "Por modelo" del monitor de ventas, con buscador, filtro por
 * categoría y columnas ordenables. Las filas llegan calculadas y compactas;
 * el trabajo derivado se difiere y el DOM se pagina para no frenar el
 * navegador aunque aumente el catálogo.
 */

type Clave = ClaveTablaVentas;

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

export function TablaModelosVentas({
  desde,
  hasta,
  inicial,
}: {
  desde: string;
  hasta: string;
  inicial: PaginaTablaVentas;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [orden, setOrden] = useState<{ clave: Clave; desc: boolean }>({ clave: "unidades7", desc: true });
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const primeraCarga = useRef(true);
  const busquedaDiferida = useDeferredValue(busqueda);

  useEffect(() => {
    if (primeraCarga.current) {
      primeraCarga.current = false;
      return;
    }
    const controlador = new AbortController();
    const parametros = new URLSearchParams({
      desde,
      hasta,
      busqueda: busquedaDiferida,
      categoria,
      orden: orden.clave,
      desc: String(orden.desc),
      pagina: String(pagina),
    });
    setCargando(true);
    setError(null);
    fetch(`/api/ventas/modelos?${parametros}`, { signal: controlador.signal })
      .then(async (respuesta) => {
        const cuerpo = await respuesta.json();
        if (!respuesta.ok) throw new Error(cuerpo.error ?? "No se pudo cargar la tabla.");
        return cuerpo as PaginaTablaVentas;
      })
      .then(setDatos)
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCargando(false);
      });
    return () => controlador.abort();
  }, [desde, hasta, busquedaDiferida, categoria, orden, pagina]);

  const renderizadas = useMemo(() => datos.filas.map(expandirFilaModelo), [datos.filas]);
  const { paginas, totales } = datos;
  const paginaSegura = datos.pagina;

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
          {datos.categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
          {busqueda !== busquedaDiferida || cargando ? "Actualizando… · " : ""}
          {datos.totalFiltrado} de {datos.totalCatalogo} modelos · ordenado por {COLUMNAS.find((c) => c.clave === orden.clave)?.titulo.toLowerCase()}{" "}
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
            {datos.totalFiltrado === 0 ? (
              <tr>
                <td colSpan={COLUMNAS.length} className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
                  Ningún modelo coincide con el filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
          {datos.totalFiltrado > 1 ? (
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
      {error ? (
        <p className="border-t p-3 text-sm hairline" role="alert" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
      {paginas > 1 ? (
        <nav
          aria-label="Páginas de modelos"
          className="flex items-center justify-between gap-3 border-t p-3 hairline text-sm"
        >
          <span style={{ color: "var(--ink-2)" }}>
            Mostrando {(paginaSegura - 1) * datos.filasPorPagina + 1}–
            {Math.min(paginaSegura * datos.filasPorPagina, datos.totalFiltrado)} de {datos.totalFiltrado}
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
