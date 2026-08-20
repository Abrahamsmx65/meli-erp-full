"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { coincide, terminosDeBusqueda } from "@/lib/reporte/filtro";
import type { RenglonInventario } from "@/lib/servicios/inventario";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Tabla de inventario por SKU.
 *
 * Cada renglón dice dónde está el producto, no solo cuánto hay: en Full, en
 * camino a Full, en cajas en bodega, o todavía en China. Son cuatro lugares
 * distintos con cuatro tiempos de disponibilidad distintos, y confundirlos es
 * lo que hace que uno crea que tiene producto cuando en realidad está a seis
 * semanas de tenerlo.
 */
export function TablaInventario({
  renglones,
  soloBodega,
}: {
  renglones: RenglonInventario[];
  /** true = la vista de Bodega: sin columnas de MELI, solo bodega y China */
  soloBodega?: boolean;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [soloConExistencia, setSoloConExistencia] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);

  const terminos = useMemo(() => terminosDeBusqueda(busqueda), [busqueda]);

  const filtrados = useMemo(
    () =>
      renglones.filter((r) => {
        const relevante = soloBodega ? r.enBodega + r.enCamino : r.total;
        if (soloConExistencia && relevante === 0) return false;
        return coincide(
          `${r.sku} ${r.modelo} ${r.color} ${r.talla} ${r.pedidos.map((p) => p.pedido).join(" ")}`,
          terminos,
        );
      }),
    [renglones, terminos, soloConExistencia, soloBodega],
  );

  const totales = useMemo(
    () => ({
      enFull: filtrados.reduce((a, r) => a + r.enFull, 0),
      enTransferencia: filtrados.reduce((a, r) => a + r.enTransferencia, 0),
      enBodega: filtrados.reduce((a, r) => a + r.enBodega, 0),
      enCamino: filtrados.reduce((a, r) => a + r.enCamino, 0),
    }),
    [filtrados],
  );

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-col gap-3 border-b p-4 hairline">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por SKU, modelo, color o número de pedido…"
            className="min-w-[18rem] flex-1"
            aria-label="Buscar en el inventario"
          />
          <button
            onClick={() => setSoloConExistencia((v) => !v)}
            aria-pressed={soloConExistencia}
            className="rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap"
            style={{
              borderColor: soloConExistencia ? "var(--acento)" : "var(--borde)",
              background: soloConExistencia ? "var(--acento-suave)" : "transparent",
            }}
          >
            Solo con existencia
          </button>
        </div>

        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          <strong className="cifra">{filtrados.length}</strong> SKUs
          {!soloBodega ? (
            <>
              {" "}· Full <span className="cifra">{n(totales.enFull)}</span> · hacia Full{" "}
              <span className="cifra">{n(totales.enTransferencia)}</span>
            </>
          ) : null}{" "}
          · bodega <span className="cifra">{n(totales.enBodega)}</span> · China{" "}
          <span className="cifra">{n(totales.enCamino)}</span>
        </p>
      </header>

      <div className="max-h-[40rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              {/* En Bodega el SKU de MELI/Full sobra: aquí se piensa en
                  modelo + color + talla, lo de MELI vive en su sección. */}
              {!soloBodega ? <th>SKU</th> : null}
              <th>Modelo</th>
              <th>Color</th>
              <th className="num">Talla</th>
              {!soloBodega ? (
                <>
                  <th className="num">En Full</th>
                  <th className="num">Hacia Full</th>
                </>
              ) : null}
              <th className="num">Bodega</th>
              <th className="num">China</th>
              <th className="num">Total</th>
              <th>Pedidos</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.slice(0, 500).map((r) => {
              const abierto = expandido === r.sku;
              return (
                <Fragment key={r.sku}>
                  <tr>
                    {!soloBodega ? (
                      <td>
                        <Link
                          href={`/sku/${encodeURIComponent(r.sku)}`}
                          className="font-medium underline decoration-dotted underline-offset-2"
                          style={{ color: "var(--acento)" }}
                        >
                          {r.sku}
                        </Link>
                        {r.inventoryId ? (
                          <div className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                            Full: {r.inventoryId}
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                    <td className="text-sm font-medium">{r.modelo}</td>
                    <td className="text-sm">{r.color}</td>
                    <td className="num cifra text-sm">{r.talla}</td>
                    {!soloBodega ? (
                      <>
                        <td
                          className="num cifra font-medium"
                          style={{
                            color: r.enFull === 0 ? "var(--estado-critico)" : "var(--ink-1)",
                          }}
                        >
                          {n(r.enFull)}
                        </td>
                        <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                          {r.enTransferencia ? n(r.enTransferencia) : "—"}
                        </td>
                      </>
                    ) : null}
                    <td className="num cifra">{r.enBodega ? n(r.enBodega) : "—"}</td>
                    <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                      {r.enCamino ? n(r.enCamino) : "—"}
                    </td>
                    <td className="num cifra font-semibold">
                      {n(soloBodega ? r.enBodega + r.enCamino : r.total)}
                    </td>
                    <td className="text-xs">
                      {r.pedidos.length === 0 ? (
                        <span style={{ color: "var(--ink-muted)" }}>—</span>
                      ) : r.pedidos.length === 1 ? (
                        <span style={{ color: "var(--ink-2)" }}>
                          {r.pedidos[0].pedido} · {r.pedidos[0].almacen}
                        </span>
                      ) : (
                        <button
                          onClick={() => setExpandido(abierto ? null : r.sku)}
                          className="underline"
                          style={{ color: "var(--acento)" }}
                        >
                          {r.pedidos.length} pedidos {abierto ? "▴" : "▾"}
                        </button>
                      )}
                    </td>
                  </tr>

                  {abierto
                    ? r.pedidos.map((p) => (
                        <tr key={`${r.sku}-${p.pedido}-${p.almacen}`}>
                          <td
                            colSpan={soloBodega ? 3 : 4}
                            className="pl-8 text-xs"
                            style={{ color: "var(--ink-2)" }}
                          >
                            Pedido <strong>{p.pedido}</strong> · {p.almacen}
                          </td>
                          <td colSpan={soloBodega ? 3 : 5} className="text-xs" style={{ color: "var(--ink-2)" }}>
                            {n(p.cajas)} cajas
                          </td>
                          <td className="num cifra text-xs">{n(p.pares)} pares</td>
                        </tr>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtrados.length > 500 ? (
        <footer className="border-t p-3 text-xs hairline" style={{ color: "var(--ink-muted)" }}>
          Se muestran los primeros 500 de {filtrados.length}. Afina la búsqueda para ver el resto.
        </footer>
      ) : null}
    </section>
  );
}
