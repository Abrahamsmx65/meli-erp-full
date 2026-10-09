"use client";

import { useMemo, useState } from "react";
import { Seccion } from "@/components/ui/pagina";
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
  // Lo que tiene stock y NO está en línea: sin publicación activa en TikTok
  // (ninguna, en borrador o desactivada). Dueño, 2-oct-2026: «me haces una
  // lista de todo lo que hay stock TikTok que no está en línea».
  const [soloSinLinea, setSoloSinLinea] = useState(false);
  const ordenados = useMemo(() => ordenarPorSku(renglones), [renglones]);
  const vistos = useMemo(() => {
    const base = filtrarInventario(ordenados, busqueda);
    return soloSinLinea ? base.filter((r) => !r.publicable && r.disponible > 0) : base;
  }, [ordenados, busqueda, soloSinLinea]);
  const totales = useMemo(() => totalesDeInventario(vistos), [vistos]);
  const filtrando = busqueda.trim().length > 0 || soloSinLinea;
  const sinLinea = useMemo(() => renglones.filter((r) => !r.publicable && r.disponible > 0).length, [renglones]);

  return (
    <Seccion
      titulo="Inventario por SKU"
      sinRelleno
      acciones={
          <a
            href="/api/tiktok/resumen-modelos"
            className="boton boton-borde boton-chico"
            title="Un renglón por modelo: foto, categoría, ID y estado en TikTok, stock en la bodega TikTok, stock por bodega de cajas y ventas de MELI de toda la historia"
          >
            Excel por modelo
          </a>
      }
    >
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar SKU (GT134 BLK 24, navy…)"
          aria-label="Buscar en el inventario de TikTok"
          className="min-w-[16rem] flex-1 rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
        />
        <label className="flex items-center gap-1.5 text-xs" style={{ color: sinLinea ? "var(--alerta-texto)" : "var(--ink-2)" }}>
          <input type="checkbox" checked={soloSinLinea} onChange={(e) => setSoloSinLinea(e.target.checked)} />
          Solo con stock sin publicación activa ({n(sinLinea)})
        </label>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs texto-2">
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

      <div className="tabla-caja mt-3">
        <table className="datos">
          <thead>
            <tr>
              <th>SKU</th>
              <th className="num">En almacén</th>
              <th className="num">Apartado</th>
              <th className="num">Disponible</th>
              <th className="num">En TikTok</th>
              <th className="num">Venta {diasVenta}d</th>
              <th className="num">Cobertura</th>
            </tr>
          </thead>
          <tbody>
            {vistos.map((r) => (
              <tr key={r.sku}>
                <td>
                  <span className="font-medium">{r.sku}</span>
                  {r.titulo ? (
                    <span className="block text-xs texto-2">
                      {r.titulo}
                    </span>
                  ) : null}
                  {!r.contado ? (
                    <span className="block text-xs" style={{ color: "var(--estado-alerta)" }}>
                      sin conteo inicial: no se publica a TikTok hasta una entrada o un ajuste
                    </span>
                  ) : !r.publicable ? (
                    <>
                      <span className="block text-xs" style={{ color: "var(--estado-alerta)" }}>
                        {r.estadoPublicacion === "DRAFT"
                          ? "publicación en BORRADOR en TikTok: no vende"
                          : r.estadoPublicacion === "SELLER_DEACTIVATED"
                            ? "publicación DESACTIVADA en TikTok: no vende"
                            : r.estadoPublicacion
                              ? `publicación en TikTok en estado ${r.estadoPublicacion}: no vende`
                              : "sin publicación ligada en TikTok"}
                      </span>
                      {r.estadoPublicacion ? null : <LigarTikTok sku={r.sku} sugerencias={r.sugerencias} />}
                    </>
                  ) : null}
                </td>
                <td className="num cifra" style={{ color: r.enRojo ? "var(--estado-critico)" : undefined }}>
                  {n(r.saldo)}
                </td>
                <td className="num cifra texto-2">
                  {r.apartado ? n(r.apartado) : "—"}
                </td>
                <td className="num cifra font-semibold">{n(r.disponible)}</td>
                <td
                  className="num cifra"
                  style={{ color: r.desfasado ? "var(--estado-critico)" : "var(--ink-2)" }}
                >
                  {r.publicado == null ? "—" : n(r.publicado)}
                </td>
                <td className="num cifra texto-2">
                  {r.ventas30 ? n(r.ventas30) : "—"}
                </td>
                <td className="num cifra texto-2">
                  {r.diasCobertura == null ? "—" : `${Math.round(r.diasCobertura)} d`}
                </td>
              </tr>
            ))}
            {!renglones.length ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm texto-2" colSpan={7}>
                  Todavía no hay nada en el almacén de TikTok.
                </td>
              </tr>
            ) : !vistos.length ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm texto-2" colSpan={7}>
                  Ningún SKU coincide con «{busqueda.trim()}».
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Seccion>
  );
}
