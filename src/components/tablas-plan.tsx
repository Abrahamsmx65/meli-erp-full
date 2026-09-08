"use client";

import { useMemo, useState } from "react";
import type { EstadoSku } from "@/lib/engine/types";
import { Estado, colorEstado, etiquetaEstado } from "./estado";
import { BarraCobertura } from "./tiles";
import { coincide, terminosDeBusqueda } from "@/lib/reporte/filtro";
import { BotonDescarga } from "@/components/ui/boton-descarga";

export interface FilaSkuPlan {
  sku: string;
  modelo: string;
  color: string;
  talla: string;
  estado: EstadoSku;
  demandaDiaria: number;
  factorCorreccion: number;
  diasSinStock: number;
  disponible: number;
  enTransferencia: number;
  /** null = sin venta medible, la cobertura es infinita */
  coberturaDias: number | null;
  sugerido: number;
  enviado: number;
}

export interface FilaCajaPlan {
  codigo: string;
  skuCaja: string;
  pedido: string;
  modelo: string;
  color: string;
  almacen: string;
  esCorrida: boolean;
  talla: string;
  cantidad: number;
  cajasDisponibles: number;
  paresPorCaja: number;
  paresTotales: number;
  /** cuántas de estas cajas son OPCIONALES (rescate de tallas faltantes) */
  cantidadOpcional: number;
  /** sobrante por talla si se suben las opcionales, ya como texto */
  deMas: string;
  aporta: { sku: string; talla: string; paresPorCaja: number; paresTotales: number }[];
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

const ESTADOS: EstadoSku[] = ["critico", "urgente", "ok", "sobrestock", "sin_demanda"];

export function TablasPlan({
  lineas,
  cajas,
  horizonteDias,
  totalAnalizados,
  cajasDisponiblesBodega,
}: {
  lineas: FilaSkuPlan[];
  cajas: FilaCajaPlan[];
  horizonteDias: number;
  totalAnalizados: number;
  cajasDisponiblesBodega: number;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [estados, setEstados] = useState<Set<EstadoSku>>(new Set());
  const [soloConEnvio, setSoloConEnvio] = useState(false);

  const terminos = useMemo(() => terminosDeBusqueda(busqueda), [busqueda]);

  const lineasFiltradas = useMemo(
    () =>
      lineas.filter((l) => {
        if (!coincide(`${l.sku} ${l.modelo} ${l.color} ${l.talla}`, terminos)) return false;
        if (estados.size && !estados.has(l.estado)) return false;
        if (soloConEnvio && l.enviado <= 0) return false;
        return true;
      }),
    [lineas, terminos, estados, soloConEnvio],
  );

  const cajasFiltradas = useMemo(
    () =>
      cajas.filter((c) =>
        coincide(
          `${c.skuCaja} ${c.modelo} ${c.color} ${c.almacen} ${c.aporta.map((a) => a.sku).join(" ")}`,
          terminos,
        ),
      ),
    [cajas, terminos],
  );

  // Totales del filtro: al buscar un modelo, esto responde "¿cuánto de ESTE
  // modelo estoy mandando?", que es justo lo que uno quiere saber.
  const totales = useMemo(
    () => ({
      cajas: cajasFiltradas.reduce((a, c) => a + c.cantidad, 0),
      pares: cajasFiltradas.reduce((a, c) => a + c.paresTotales, 0),
      sugerido: lineasFiltradas.reduce((a, l) => a + l.sugerido, 0),
      enviado: lineasFiltradas.reduce((a, l) => a + l.enviado, 0),
    }),
    [cajasFiltradas, lineasFiltradas],
  );

  const hayFiltro = terminos.length > 0 || estados.size > 0 || soloConEnvio;

  // El Excel lleva LOS MISMOS filtros que la pantalla (contrato de
  // reporte/filtro.ts): búsqueda, chips de estado y «solo lo que sí se
  // manda». Antes solo viajaba la búsqueda y el archivo traía de más.
  const urlExcel = useMemo(() => {
    const p = new URLSearchParams();
    if (busqueda.trim()) p.set("q", busqueda.trim());
    if (estados.size) p.set("estados", [...estados].join(","));
    if (soloConEnvio) p.set("soloEnvio", "1");
    const qs = p.toString();
    return `/api/plan/excel${qs ? `?${qs}` : ""}`;
  }, [busqueda, estados, soloConEnvio]);

  function alternarEstado(e: EstadoSku) {
    setEstados((prev) => {
      const s = new Set(prev);
      if (s.has(e)) s.delete(e);
      else s.add(e);
      return s;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Controles --------------------------------------------------- */}
      <div className="tarjeta flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por SKU, modelo o color…  ej. GT110  ·  GT110 NAVY  ·  MY2307"
            className="min-w-[18rem] flex-1"
            aria-label="Buscar por SKU, modelo o color"
          />
          <BotonDescarga href={urlExcel} variante="primario" title="Baja exactamente lo que ves: misma búsqueda y mismos filtros">
            Descargar Excel
          </BotonDescarga>
          <BotonDescarga
            href="/api/plan/excel-simple"
            title="Un renglón por SKU: ventas, stock, en camino y faltante a cubrir"
          >
            Excel simple
          </BotonDescarga>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {ESTADOS.map((e) => {
            const activo = estados.has(e);
            return (
              <button
                key={e}
                onClick={() => alternarEstado(e)}
                aria-pressed={activo}
                className="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
                style={{
                  borderColor: activo ? colorEstado(e) : "var(--borde)",
                  background: activo
                    ? `color-mix(in oklab, ${colorEstado(e)} 15%, transparent)`
                    : "transparent",
                  color: activo ? colorEstado(e) : "var(--ink-2)",
                }}
              >
                {etiquetaEstado(e)}
              </button>
            );
          })}

          <button
            onClick={() => setSoloConEnvio((v) => !v)}
            aria-pressed={soloConEnvio}
            className="rounded-full border px-2.5 py-1 text-xs font-medium"
            style={{
              borderColor: soloConEnvio ? "var(--acento)" : "var(--borde)",
              background: soloConEnvio ? "var(--acento-suave)" : "transparent",
            }}
          >
            Solo lo que sí se manda
          </button>

          {hayFiltro ? (
            <button
              onClick={() => {
                setBusqueda("");
                setEstados(new Set());
                setSoloConEnvio(false);
              }}
              className="ml-1 text-xs underline"
              style={{ color: "var(--ink-2)" }}
            >
              Limpiar
            </button>
          ) : null}
        </div>

        {hayFiltro ? (
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            <strong className="cifra">{lineasFiltradas.length}</strong> SKUs ·{" "}
            <strong className="cifra">{totales.cajas}</strong> cajas ·{" "}
            <strong className="cifra">{n(totales.pares)}</strong> pares en el envío ·{" "}
            sugerido <span className="cifra">{n(totales.sugerido)}</span>, se manda{" "}
            <span className="cifra">{n(totales.enviado)}</span>
          </p>
        ) : null}
      </div>

      {/* ---- Cajas -------------------------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b p-4 hairline">
          <h2 className="font-semibold">Cajas a mandar</h2>
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            {totales.cajas} cajas · {n(totales.pares)} pares
            {!hayFiltro && ` · de ${n(cajasDisponiblesBodega)} cajas disponibles en bodega`}
          </p>
        </header>

        {cajasFiltradas.length === 0 ? (
          <p className="p-6 text-sm" style={{ color: "var(--ink-2)" }}>
            {cajas.length === 0
              ? "No hace falta mandar nada: todo tiene cobertura suficiente para el horizonte."
              : "Ninguna caja coincide con la búsqueda."}
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Caja</th>
                  <th>Almacén</th>
                  <th>Tipo</th>
                  <th className="num">Mandar</th>
                  <th className="num">Pares</th>
                  <th>Contenido por talla</th>
                </tr>
              </thead>
              <tbody>
                {cajasFiltradas.slice(0, 500).map((c) => (
                  <tr key={c.codigo}>
                    <td>
                      <div
                        className="font-medium"
                        style={c.cantidadOpcional > 0 ? { color: "var(--estado-alerta)" } : undefined}
                      >
                        {c.skuCaja}
                      </div>
                      <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                        {c.modelo} · {c.color}
                      </div>
                      {c.cantidadOpcional > 0 ? (
                        <div className="text-[11px]" style={{ color: "var(--estado-alerta)" }}>
                          {c.cantidadOpcional === c.cantidad
                            ? "Opcional"
                            : `${c.cantidadOpcional} de ${c.cantidad} opcionales`}
                          {c.deMas ? ` · sobra ${c.deMas}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-sm">{c.almacen}</td>
                    <td className="text-sm">{c.esCorrida ? "Corrida" : `Talla ${c.talla}`}</td>
                    <td
                      className="num cifra font-semibold"
                      style={c.cantidadOpcional > 0 ? { color: "var(--estado-alerta)" } : undefined}
                    >
                      {c.cantidad}
                      <span className="text-xs font-normal" style={{ color: "var(--ink-muted)" }}>
                        {" "}
                        / {c.cajasDisponibles}
                      </span>
                    </td>
                    <td className="num cifra">{n(c.paresTotales)}</td>
                    <td className="text-xs" style={{ color: "var(--ink-2)" }}>
                      {c.aporta.map((a) => `${a.talla}:${a.paresTotales}`).join("  ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cajasFiltradas.length > 500 ? (
              <p className="border-t p-3 text-xs hairline" style={{ color: "var(--ink-muted)" }}>
                Se muestran las primeras 500 de {cajasFiltradas.length} cajas; el Excel las trae todas.
              </p>
            ) : null}
          </div>
        )}
      </section>

      {/* ---- SKUs --------------------------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b p-4 hairline">
          <h2 className="font-semibold">Detalle por SKU</h2>
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            {lineasFiltradas.length} de {totalAnalizados} analizados
          </p>
        </header>

        {lineasFiltradas.length === 0 ? (
          <p className="p-6 text-sm" style={{ color: "var(--ink-2)" }}>
            Ningún SKU coincide con la búsqueda.
          </p>
        ) : (
          <div className="max-h-[36rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Estado</th>
                  <th className="num">Venta/día</th>
                  <th className="num">En Full</th>
                  <th className="num">En camino</th>
                  <th>Cobertura</th>
                  <th className="num">Sugerido</th>
                  <th className="num">Se manda</th>
                </tr>
              </thead>
              <tbody>
                {lineasFiltradas.slice(0, 500).map((l) => (
                  <tr key={l.sku}>
                    <td>
                      <a
                        href={`/sku/${encodeURIComponent(l.sku)}`}
                        className="font-medium underline decoration-dotted underline-offset-2"
                        style={{ color: "var(--acento)" }}
                      >
                        {l.sku}
                      </a>
                      {l.factorCorreccion > 1.15 ? (
                        <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                          demanda ×{l.factorCorreccion.toFixed(2)} por {l.diasSinStock} días agotado
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Estado estado={l.estado} />
                    </td>
                    <td className="num cifra">{l.demandaDiaria.toFixed(1)}</td>
                    <td className="num cifra">{n(l.disponible)}</td>
                    <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                      {l.enTransferencia ? n(l.enTransferencia) : "—"}
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <div className="flex items-center gap-2">
                        <BarraCobertura
                          dias={l.coberturaDias ?? Number.POSITIVE_INFINITY}
                          horizonte={horizonteDias}
                          color={colorEstado(l.estado)}
                          maximo={Math.max(horizonteDias * 2, 60)}
                        />
                        <span
                          className="cifra w-14 shrink-0 text-right text-xs"
                          style={{ color: "var(--ink-2)" }}
                        >
                          {l.coberturaDias == null ? "—" : `${l.coberturaDias.toFixed(0)} d`}
                        </span>
                      </div>
                    </td>
                    <td className="num cifra">{n(l.sugerido)}</td>
                    <td
                      className="num cifra font-semibold"
                      style={{
                        color:
                          l.enviado === 0 && l.sugerido > 0
                            ? "var(--estado-critico)"
                            : "var(--ink-1)",
                      }}
                    >
                      {n(l.enviado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer className="border-t p-3 text-xs hairline" style={{ color: "var(--ink-muted)" }}>
          La marca fina en cada barra es el horizonte objetivo de {horizonteDias} días.
          «Se manda» puede quedar por debajo de «Sugerido» porque las cajas no se abren: el
          sistema elige la combinación que menos daño hace.
          {lineasFiltradas.length > 500 &&
            ` Se muestran los primeros 500 de ${lineasFiltradas.length}; el Excel los trae todos.`}
        </footer>
      </section>
    </div>
  );
}
