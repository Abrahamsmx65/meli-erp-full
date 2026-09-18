"use client";

import { useMemo, useState } from "react";
import { LigarTikTok } from "@/components/ligar-tiktok";
import type { RenglonTikTok } from "@/lib/servicios/tiktok-panel";
import { filtrarInventario, ordenarPorSku, totalesDeInventario } from "@/lib/tiktok/inventario-vista";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * La tabla del inventario del Almacén TikTok: ordenada por SKU, con
 * buscador y el total de lo que se está viendo arriba (pedido del dueño,
 * 18-sep-2026). Es solo vista: los renglones ya vienen masticados del
 * servidor (`cargarPanelTikTok`).
 */
export function InventarioTikTok({ renglones, diasVenta }: { renglones: RenglonTikTok[]; diasVenta: number }) {
  const [busqueda, setBusqueda] = useState("");
  const ordenados = useMemo(() => ordenarPorSku(renglones), [renglones]);
  const vistos = useMemo(() => filtrarInventario(ordenados, busqueda), [ordenados, busqueda]);
  const totales = useMemo(() => totalesDeInventario(vistos), [vistos]);
  const filtrando = busqueda.trim().length > 0;

  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <h2 className="text-sm font-semibold">Inventario por SKU</h2>
        <span className="text-xs" style={{ color: "var(--ink-2)" }}>
          Orden alfabético · venta de los últimos {diasVenta} días
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 px-4">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar SKU (GT134 BLK 24, navy…)"
          aria-label="Buscar en el inventario de TikTok"
          className="min-w-[16rem] flex-1 rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--ink-2)" }}>
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>{n(totales.skus)}</b> SKU
            {filtrando ? ` de ${n(renglones.length)}` : ""}
          </span>
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>{n(totales.saldo)}</b> en almacén
          </span>
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>{n(totales.apartado)}</b> apartados
          </span>
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>{n(totales.disponible)}</b> disponibles
          </span>
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>{n(totales.ventas30)}</b> vendidos {diasVenta}d
          </span>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
              <th className="px-4 py-2 font-semibold">SKU</th>
              <th className="px-4 py-2 text-right font-semibold">En almacén</th>
              <th className="px-4 py-2 text-right font-semibold">Apartado</th>
              <th className="px-4 py-2 text-right font-semibold">Disponible</th>
              <th className="px-4 py-2 text-right font-semibold">En TikTok</th>
              <th className="px-4 py-2 text-right font-semibold">Venta {diasVenta}d</th>
              <th className="px-4 py-2 text-right font-semibold">Cobertura</th>
            </tr>
          </thead>
          <tbody>
            {vistos.map((r) => (
              <tr key={r.sku} className="hairline">
                <td className="px-4 py-2">
                  <span className="font-medium">{r.sku}</span>
                  {r.titulo ? (
                    <span className="block text-xs" style={{ color: "var(--ink-2)" }}>
                      {r.titulo}
                    </span>
                  ) : null}
                  {!r.contado ? (
                    <span className="block text-xs" style={{ color: "var(--estado-alerta)" }}>
                      sin conteo inicial: a TikTok no se le escribe hasta capturar una entrada o un
                      ajuste
                    </span>
                  ) : !r.publicable ? (
                    <>
                      <span className="block text-xs" style={{ color: "var(--estado-alerta)" }}>
                        sin publicación ligada en TikTok
                      </span>
                      <LigarTikTok sku={r.sku} sugerencias={r.sugerencias} />
                    </>
                  ) : null}
                </td>
                <td className="num px-4 py-2 text-right" style={{ color: r.enRojo ? "var(--estado-critico)" : undefined }}>
                  {n(r.saldo)}
                </td>
                <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }}>
                  {r.apartado ? n(r.apartado) : "—"}
                </td>
                <td className="num px-4 py-2 text-right font-semibold">{n(r.disponible)}</td>
                <td
                  className="num px-4 py-2 text-right"
                  style={{ color: r.desfasado ? "var(--estado-critico)" : "var(--ink-2)" }}
                >
                  {r.publicado == null ? "—" : n(r.publicado)}
                </td>
                <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }}>
                  {r.ventas30 ? n(r.ventas30) : "—"}
                </td>
                <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }}>
                  {r.diasCobertura == null ? "—" : `${Math.round(r.diasCobertura)} d`}
                </td>
              </tr>
            ))}
            {!renglones.length ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm" colSpan={7} style={{ color: "var(--ink-2)" }}>
                  Todavía no hay nada en el almacén de TikTok. Captura la primera entrada arriba.
                </td>
              </tr>
            ) : !vistos.length ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm" colSpan={7} style={{ color: "var(--ink-2)" }}>
                  Ningún SKU coincide con «{busqueda.trim()}».
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
