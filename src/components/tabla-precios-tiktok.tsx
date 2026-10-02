"use client";

import { useState } from "react";
import { filtrarPrecios, NOMBRES_NIVEL, type RenglonPrecio } from "@/lib/tiktok/precios";
import { MiPrecioTikTok, QuitarRetencionTikTok } from "./mi-precio-tiktok";

/**
 * La tabla de Precios para TikTok: ordenada por modelo (orden natural, la
 * trae así el motor) y con buscador por pedazos («gt148», «botas»);
 * arriba dice cuántos modelos se están viendo. Pedido del dueño,
 * 2-oct-2026: «me lo puedes ordenar por SKU y poner un buscador».
 */
export function TablaPreciosTikTok({
  renglones,
  escalonPct,
  diasPrecioReal,
  retencionPct,
}: {
  renglones: RenglonPrecio[];
  escalonPct: number;
  diasPrecioReal: number;
  /** IVA + ISR retenidos (10.5 %), para la casilla «quitar» por modelo */
  retencionPct: number;
}) {
  const [busqueda, setBusqueda] = useState("");
  const visibles = filtrarPrecios(renglones, busqueda);

  return (
    <section className="tarjeta overflow-hidden">
      <div className="px-4 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Precio por modelo</h2>
            <p className="text-xs" style={{ color: "var(--ink-2)" }}>
              «Relámpago MELI» es el precio más bajo al que el modelo vendió con volumen en el periodo (al menos el 10 % de sus pares) y
              «Neto relámpago/par» lo que Mercado Pago depositó por par a ESE precio: el objetivo. En reventa MELI ya no retiene el{" "}
              {retencionPct} % (IVA + ISR sobre la base sin IVA) y muchos precios de MELI se pusieron contando con eso: la casilla «quitar{" "}
              {retencionPct} %» calcula ese modelo como si MELI sí lo retuviera (objetivo y precio de TikTok más bajos). «Mi precio» manda si lo
              capturas (vacío = volver al calculado). «TikTok hoy» es el precio REAL que pagaron los clientes en los pedidos de los últimos{" "}
              {diasPrecioReal} días (ofertas y relámpagos incluidos) y lo que deja; si el modelo no vendió, el de lista del catálogo.{" "}
              {NOMBRES_NIVEL.normal} es el precio que deja lo mismo que el relámpago de MELI (o tu precio); {NOMBRES_NIVEL.live} va{" "}
              {escalonPct} % abajo (deja menos, a propósito) y {NOMBRES_NIVEL.campana} {escalonPct} % arriba.
            </p>
          </div>
          <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
            <span>Buscar modelo o categoría</span>
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="gt148, botas…"
              autoComplete="off"
              className="mt-1 w-56 rounded-lg border px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--ink-muted)" }}>
          {busqueda.trim() ? `${n(visibles.length)} de ${n(renglones.length)} modelos` : `${n(renglones.length)} modelos, en orden alfabético`}
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
              <th className="px-4 py-2 font-semibold">Modelo</th>
              <th className="px-4 py-2 text-right font-semibold">Pares MELI</th>
              <th className="px-4 py-2 text-right font-semibold">Relámpago MELI</th>
              <th className="px-4 py-2 text-right font-semibold">Neto relámpago/par</th>
              <th className="px-4 py-2 text-right font-semibold">Mi precio</th>
              <th className="px-4 py-2 text-right font-semibold">Costo</th>
              <th className="px-4 py-2 text-right font-semibold">TikTok hoy</th>
              <th className="px-4 py-2 text-right font-semibold">{NOMBRES_NIVEL.live}</th>
              <th className="px-4 py-2 text-right font-semibold">{NOMBRES_NIVEL.normal}</th>
              <th className="px-4 py-2 text-right font-semibold">{NOMBRES_NIVEL.campana}</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((r) => {
              const bajo = r.niveles && r.precioTikTok != null && r.precioTikTok < r.niveles[1].precio;
              return (
                <tr key={r.modelo} className="hairline align-top">
                  <td className="px-4 py-2">
                    <div className="font-medium">{r.modelo}</div>
                    {r.categoria ? (
                      <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                        {r.categoria}
                      </div>
                    ) : null}
                  </td>
                  <td className="num px-4 py-2 text-right" title={r.paresMeli ? `${pesos(r.netoMeli)} netos en ${n(r.paresMeli)} pares (todo el periodo)` : "sin venta en MELI en el periodo"}>
                    {r.paresMeli ? n(r.paresMeli) : "—"}
                  </td>
                  <td className="num px-4 py-2 text-right" title={r.precioRelampagoMeli != null ? `${n(r.paresRelampago)} pares a este precio` : "sin un escalón con volumen"}>
                    {r.precioRelampagoMeli != null ? (
                      <>
                        {pesosC(r.precioRelampagoMeli)}
                        <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                          {n(r.paresRelampago)} pares
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num px-4 py-2 text-right font-medium" style={{ color: r.origenNivel === "mi-precio" ? "var(--ink-2)" : undefined }}>
                    {r.netoPorPar != null ? pesosC(r.netoPorPar) : "—"}
                    {r.quitarRetencion && r.netoRelampagoReal != null ? (
                      <div className="text-xs font-normal" style={{ color: "var(--ink-muted)" }} title={`neto real ${pesosC(r.netoRelampagoReal)}`}>
                        −{pesosC(r.retencionQuitada)} de retención
                      </div>
                    ) : null}
                    <div className="mt-1 text-right">
                      <QuitarRetencionTikTok modelo={r.modelo} inicial={r.quitarRetencion} pct={retencionPct} />
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <MiPrecioTikTok modelo={r.modelo} inicial={r.miPrecio} />
                  </td>
                  <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }}>
                    {r.costo != null ? pesos(r.costo) : "sin costo"}
                  </td>
                  <td
                    className="num px-4 py-2 text-right"
                    style={{ color: bajo ? "var(--estado-alerta)" : undefined }}
                    title={
                      r.netoTikTokActual != null
                        ? `deja ${pesosC(r.netoTikTokActual)} por par · ${r.origenPrecio === "pedidos" ? `precio pagado en los pedidos de ${diasPrecioReal} días` : "precio de lista del catálogo (sin pedidos recientes)"}`
                        : "no está en TikTok"
                    }
                  >
                    {r.precioTikTok != null ? (
                      <>
                        {pesos(r.precioTikTok)}
                        <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                          deja {pesosC(r.netoTikTokActual ?? 0)}
                          {r.origenPrecio === "lista" ? " · lista" : ""}
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  {(r.niveles ?? [null, null, null]).map((nivel, i) => (
                    <td key={i} className="num px-4 py-2 text-right">
                      {nivel ? (
                        <>
                          <span className={i === 1 ? "font-semibold" : "font-medium"}>{pesos(nivel.precio)}</span>
                          <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                            deja {pesosC(nivel.neto)}
                            {r.costo != null ? ` · gano ${pesos(nivel.neto - r.costo)}` : ""}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!visibles.length ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm" colSpan={10} style={{ color: "var(--ink-2)" }}>
                  {renglones.length ? `Ningún modelo coincide con «${busqueda.trim()}».` : "Sin ventas en MELI ni productos en TikTok."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}
function pesosC(x: number): string {
  return "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
