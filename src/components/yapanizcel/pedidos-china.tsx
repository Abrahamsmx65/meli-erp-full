"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DisenoCompra, VarianteCompra } from "@/lib/yapanizcel/compras";
import { CargarPedido } from "./pedidos";
import { Ficha } from "@/components/tiles";
import { estiloInput } from "./comunes";

export interface FilaDiseno {
  diseno: string;
  variantes: number;
  descontinuadas: number;
  vendidas30: number;
  posicionTotal: number;
  sugerido: number;
  cobertura: number;
}

type VarianteJson = Omit<VarianteCompra, "cobertura"> & { cobertura: number | null };
type DetalleJson = Omit<DisenoCompra, "variantes"> & { variantes: VarianteJson[] };

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}
function dias(x: number | null): string {
  return x != null && Number.isFinite(x) ? `${Math.round(x)} d` : "∞";
}

const CLAVE_LOCAL = "yz-pedidos-disenos";
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold";

/**
 * Pedidos a China, todo en el navegador sobre el resumen ya calculado.
 *
 *   · La lista de diseños se filtra aquí: se eligen diseños (clic o
 *     escribiendo "499, 514"), se ven solo esos, y el Excel baja SOLO eso.
 *     La elección se recuerda en el navegador y viaja en la URL.
 *   · Abrir un diseño pide UN renglón chico al servidor (el detalle
 *     masticado) y lo pinta debajo, sin volver a construir la página
 *     entera: eso era lo que hacía lento cada clic. Lo ya abierto se
 *     queda en memoria: volver a abrirlo es inmediato.
 */
export function PedidosChina({ disenos, diasObjetivo, abrirInicial, disenosIniciales }: { disenos: FilaDiseno[]; diasObjetivo: number; abrirInicial?: string; disenosIniciales?: string[] }) {
  const existentes = useMemo(() => new Set(disenos.map((d) => d.diseno)), [disenos]);

  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set((disenosIniciales ?? []).filter((d) => existentes.has(d))));
  const [soloSeleccion, setSoloSeleccion] = useState(Boolean(disenosIniciales?.length));
  const [texto, setTexto] = useState("");

  const [abierto, setAbierto] = useState<string | null>(abrirInicial ?? null);
  const [detalles, setDetalles] = useState<Record<string, DetalleJson>>({});
  const [cargando, setCargando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detalleRef = useRef<HTMLDivElement | null>(null);

  // Sin nada en la URL, se recupera lo último elegido en este navegador.
  useEffect(() => {
    if (disenosIniciales?.length) return;
    try {
      const guardado = JSON.parse(localStorage.getItem(CLAVE_LOCAL) ?? "[]") as string[];
      const validos = Array.isArray(guardado) ? guardado.filter((d) => existentes.has(d)) : [];
      if (validos.length) {
        setSeleccion(new Set(validos));
        setSoloSeleccion(true);
      }
    } catch {
      // sin memoria local: no pasa nada
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La URL refleja elección y diseño abierto sin recargar (replaceState).
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_LOCAL, JSON.stringify([...seleccion]));
    } catch {
      // idem
    }
    const url = new URL(window.location.href);
    if (seleccion.size) url.searchParams.set("disenos", [...seleccion].join(","));
    else url.searchParams.delete("disenos");
    if (abierto) url.searchParams.set("diseno", abierto);
    else url.searchParams.delete("diseno");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [seleccion, abierto]);

  const cargarDetalle = useCallback(
    async (diseno: string) => {
      if (detalles[diseno]) return;
      setCargando(diseno);
      setError(null);
      try {
        const r = await fetch(`/api/yapanizcel/pedidos/detalle?diseno=${encodeURIComponent(diseno)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? "No se pudo leer el diseño.");
        setDetalles((d) => ({ ...d, [diseno]: j.detalle as DetalleJson }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setCargando(null);
      }
    },
    [detalles],
  );

  useEffect(() => {
    if (abierto) void cargarDetalle(abierto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const abrir = (diseno: string) => {
    setAbierto(diseno);
    setTimeout(() => detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const visibles = useMemo(() => {
    const q = texto.trim().toUpperCase();
    return disenos.filter((d) => {
      if (soloSeleccion && seleccion.size && !seleccion.has(d.diseno)) return false;
      if (q && !d.diseno.includes(q)) return false;
      return true;
    });
  }, [disenos, texto, soloSeleccion, seleccion]);

  const alternar = (diseno: string) =>
    setSeleccion((s) => {
      const nuevo = new Set(s);
      if (nuevo.has(diseno)) nuevo.delete(diseno);
      else nuevo.add(diseno);
      return nuevo;
    });

  /** "499, 514 601" escrito a mano: se agregan los que existen. */
  const agregarEscritos = () => {
    const pedidos = texto
      .split(/[\s,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s && existentes.has(s));
    if (!pedidos.length) return;
    setSeleccion((s) => new Set([...s, ...pedidos]));
    setSoloSeleccion(true);
    setTexto("");
  };

  const elegidos = [...seleccion].filter((d) => existentes.has(d)).sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  const urlExcel = elegidos.length ? `/api/yapanizcel/pedidos/excel?disenos=${encodeURIComponent(elegidos.join(","))}` : "/api/yapanizcel/pedidos/excel";

  const totales = visibles.reduce(
    (a, d) => ({ vendidas: a.vendidas + d.vendidas30, posicion: a.posicion + d.posicionTotal, pedir: a.pedir + d.sugerido }),
    { vendidas: 0, posicion: 0, pedir: 0 },
  );

  const detalle = abierto ? detalles[abierto] : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="tarjeta flex flex-wrap items-center gap-3 p-3 text-sm">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            agregarEscritos();
          }}
        >
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar o escribir diseños: 499, 514…" className="w-64 rounded-lg border px-2 py-1 text-xs" style={estiloInput} />
          <button type="submit" className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--borde)" }} title="Agrega los diseños escritos a la selección">
            Elegir
          </button>
        </form>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={soloSeleccion} onChange={(e) => setSoloSeleccion(e.target.checked)} disabled={!seleccion.size} />
          Ver solo los elegidos ({elegidos.length})
        </label>
        {seleccion.size ? (
          <button onClick={() => setSeleccion(new Set())} className="text-xs underline" style={{ color: "var(--ink-muted)" }}>
            Quitar selección
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {visibles.length} diseños · pedir {n(totales.pedir)}
          </span>
          <a href={urlExcel} className={btn} style={{ background: "var(--acento)", color: "#fff" }}>
            {elegidos.length ? `Excel de los ${elegidos.length} elegidos` : "Excel de todos"}
          </a>
        </div>
      </div>

      {elegidos.length ? (
        <div className="flex flex-wrap gap-1.5">
          {elegidos.map((d) => (
            <button key={d} onClick={() => alternar(d)} className="num rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: "var(--acento)", color: "var(--acento)" }} title="Quitar de la selección">
              {d} ×
            </button>
          ))}
        </div>
      ) : null}

      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
              <th className="px-2 py-2"></th>
              <th className="px-3 py-2">Diseño</th>
              <th className="px-3 py-2 text-right">Variantes</th>
              <th className="px-3 py-2 text-right">Descont.</th>
              <th className="px-3 py-2 text-right">Vend. 30 d</th>
              <th className="px-3 py-2 text-right">Existencia total</th>
              <th className="px-3 py-2 text-right">Cobertura</th>
              <th className="px-3 py-2 text-right">Pedir ({diasObjetivo} d)</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center" style={{ color: "var(--ink-muted)" }}>
                  {disenos.length === 0 ? "Sin catálogo todavía: sincroniza en Ajustes de fundas." : "Ningún diseño coincide."}
                </td>
              </tr>
            ) : null}
            {visibles.map((d) => (
              <tr key={d.diseno} className="border-t" style={{ borderColor: "var(--grid)", background: abierto === d.diseno ? "var(--acento-suave)" : undefined }}>
                <td className="px-2 py-1.5">
                  <input type="checkbox" checked={seleccion.has(d.diseno)} onChange={() => alternar(d.diseno)} aria-label={`Elegir ${d.diseno}`} />
                </td>
                <td className="num px-3 py-1.5 font-semibold">
                  <button onClick={() => abrir(d.diseno)} className="underline" style={{ color: "var(--acento)" }}>
                    {d.diseno}
                  </button>
                </td>
                <td className="num px-3 py-1.5 text-right">{d.variantes}</td>
                <td className="num px-3 py-1.5 text-right" style={{ color: "var(--ink-muted)" }}>{d.descontinuadas || ""}</td>
                <td className="num px-3 py-1.5 text-right">{n(d.vendidas30)}</td>
                <td className="num px-3 py-1.5 text-right">{n(d.posicionTotal)}</td>
                <td className="num px-3 py-1.5 text-right" style={{ color: Number.isFinite(d.cobertura) && d.cobertura < 45 ? "var(--estado-critico)" : undefined }}>
                  {dias(d.cobertura)}
                </td>
                <td className="num px-3 py-1.5 text-right font-semibold">{d.sugerido ? n(d.sugerido) : "—"}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap text-xs">
                  <button onClick={() => abrir(d.diseno)} className="underline" style={{ color: "var(--acento)" }}>
                    {cargando === d.diseno ? "Abriendo…" : "Abrir"}
                  </button>
                  <a href={`/api/yapanizcel/pedidos/excel?diseno=${encodeURIComponent(d.diseno)}`} className="ml-3 underline">
                    Excel
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
          {visibles.length ? (
            <tfoot>
              <tr className="border-t font-semibold" style={{ borderColor: "var(--borde)" }}>
                <td className="px-3 py-2" colSpan={4}>
                  Total de lo visible
                </td>
                <td className="num px-3 py-2 text-right">{n(totales.vendidas)}</td>
                <td className="num px-3 py-2 text-right">{n(totales.posicion)}</td>
                <td></td>
                <td className="num px-3 py-2 text-right">{n(totales.pedir)}</td>
                <td></td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {error ? (
        <p className="text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}

      <div ref={detalleRef}>
        {abierto && !detalle && cargando === abierto ? (
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            Abriendo el diseño {abierto}…
          </p>
        ) : null}
        {detalle ? (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">
                Diseño {detalle.diseno}{" "}
                <button onClick={() => setAbierto(null)} className="ml-2 text-sm font-normal underline" style={{ color: "var(--ink-muted)" }}>
                  cerrar
                </button>
              </h2>
              <a href={`/api/yapanizcel/pedidos/excel?diseno=${encodeURIComponent(detalle.diseno)}`} className={btn} style={{ background: "var(--acento)", color: "#fff" }}>
                Excel del diseño {detalle.diseno}
              </a>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Ficha titulo="Variantes" valor={detalle.variantes.length} />
              <Ficha titulo="Vendidas 30 d" valor={n(detalle.vendidas30)} />
              <Ficha titulo="Existencia total" valor={n(detalle.posicionTotal)} nota="Full + camino + bodega + China" />
              <Ficha titulo={`Pedir (${diasObjetivo} días)`} valor={n(detalle.sugerido)} nota={detalle.costoEstimado ? `≈ ${pesos(detalle.costoEstimado)} a costo` : "sin costo cargado"} tono={detalle.sugerido ? "alerta" : "bien"} />
            </div>
            <div className="tarjeta overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Modelo</th>
                    <th className="px-3 py-2">Color</th>
                    <th className="px-3 py-2 text-right">Vend. 30 d</th>
                    <th className="px-3 py-2 text-right">En Full</th>
                    <th className="px-3 py-2 text-right">Transf.</th>
                    <th className="px-3 py-2 text-right">Camino a Full</th>
                    <th className="px-3 py-2 text-right">Bodega</th>
                    <th className="px-3 py-2 text-right">Desde China</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Cobertura</th>
                    <th className="px-3 py-2 text-right">Pedir</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.variantes.map((v) => (
                    <tr key={v.skuMeli} className="border-t" style={{ borderColor: "var(--grid)" }}>
                      <td className="num px-3 py-1.5 font-medium" title={v.titulo ?? ""}>
                        {v.skuMeli}
                      </td>
                      <td className="px-3 py-1.5">{v.modelo}</td>
                      <td className="px-3 py-1.5">{v.color}</td>
                      <td className="num px-3 py-1.5 text-right">{n(v.vendidas30)}</td>
                      <td className="num px-3 py-1.5 text-right">{n(v.enFull)}</td>
                      <td className="num px-3 py-1.5 text-right">{n(v.enTransferencia)}</td>
                      <td className="num px-3 py-1.5 text-right">{n(v.enCaminoFull)}</td>
                      <td className="num px-3 py-1.5 text-right">{n(v.enBodega)}</td>
                      <td className="num px-3 py-1.5 text-right">{n(v.enCaminoChina)}</td>
                      <td className="num px-3 py-1.5 text-right">{n(v.posicionTotal)}</td>
                      <td className="num px-3 py-1.5 text-right" style={{ color: v.cobertura != null && v.cobertura < 45 ? "var(--estado-critico)" : undefined }}>
                        {dias(v.cobertura)}
                      </td>
                      <td className="num px-3 py-1.5 text-right font-semibold">{v.sugerido ? n(v.sugerido) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detalle.descontinuadas.length ? (
              <details className="text-sm" style={{ color: "var(--ink-2)" }}>
                <summary>{detalle.descontinuadas.length} SKUs descontinuados (sin venta en 180 días), fuera del pedido</summary>
                <p className="num mt-1 text-xs">{detalle.descontinuadas.join(", ")}</p>
              </details>
            ) : null}
            <h3 className="mt-2 font-semibold">Cargar pedido del diseño {detalle.diseno}</h3>
            <CargarPedido
              key={detalle.diseno}
              sugerencia={{
                diseno: detalle.diseno,
                lineas: detalle.variantes
                  .filter((v) => v.sugerido > 0)
                  .map((v) => ({ skuBodega: v.skuMeli, diseno: detalle.diseno, modelo: v.modelo, color: v.color, cantidad: v.sugerido, costoUnitario: v.costoUnitario })),
              }}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
