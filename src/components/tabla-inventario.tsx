"use client";

import { Fragment, useDeferredValue, useEffect, useMemo, useState } from "react";
import { coincide, terminosDeBusqueda } from "@/lib/reporte/filtro";
import { BotonDescarga } from "@/components/ui/boton-descarga";

/**
 * El renglón que la vista de Bodega de verdad pinta. Antes viajaba
 * `RenglonInventario` completo (13 campos, con título, inventoryId y las
 * columnas de MELI que esta vista nunca muestra): ~40 % del payload era
 * carga muerta. La página proyecta a esto en el servidor.
 */
export interface RenglonBodega {
  sku: string;
  modelo: string;
  color: string;
  talla: string;
  enBodega: number;
  enCamino: number;
  pedidos: { pedido: string; almacen: string; cajas: number; pares: number }[];
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Tabla de Bodega por SKU: dónde está el producto (cajas cerradas en bodega
 * o todavía en camino de China) y de qué pedidos sale.
 *
 * La búsqueda corre sobre un texto precalculado por renglón y con valor
 * DIFERIDO: teclear responde al instante aunque haya miles de filas. El
 * Excel de la vista serializa LOS MISMOS filtros: pantalla y archivo nunca
 * difieren (contrato de reporte/filtro.ts).
 */
export function TablaInventario({
  renglones,
  almacenes,
  busquedaInicial = "",
}: {
  renglones: RenglonBodega[];
  /** texto con el que arranca el buscador (viene de la barra superior) */
  busquedaInicial?: string;
  /** los almacenes que existen, para poder filtrar por bodega */
  almacenes?: string[];
}) {
  const [busqueda, setBusqueda] = useState(busquedaInicial);
  const [soloConExistencia, setSoloConExistencia] = useState(true);
  const [almacen, setAlmacen] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);

  // El buscador de la barra superior navega a /inventario?q=…; sin esto, el
  // input se quedaba con la búsqueda anterior y la nueva no hacía nada.
  useEffect(() => {
    setBusqueda(busquedaInicial);
  }, [busquedaInicial]);

  // El input pinta cada tecla al instante; el filtrado usa el valor diferido.
  const busquedaDiferida = useDeferredValue(busqueda);
  const terminos = useMemo(() => terminosDeBusqueda(busquedaDiferida), [busquedaDiferida]);

  // El texto de búsqueda de cada renglón se arma UNA vez, no en cada tecla.
  const conTexto = useMemo(
    () =>
      renglones.map((r) => ({
        r,
        texto: `${r.sku} ${r.modelo} ${r.color} ${r.talla} ${r.pedidos.map((p) => p.pedido).join(" ")}`,
      })),
    [renglones],
  );

  const filtrados = useMemo(
    () =>
      conTexto
        .filter(({ r, texto }) => {
          if (soloConExistencia && r.enBodega + r.enCamino === 0) return false;
          if (almacen && !r.pedidos.some((p) => p.almacen === almacen)) return false;
          return coincide(texto, terminos);
        })
        .map(({ r }) => r),
    [conTexto, terminos, soloConExistencia, almacen],
  );

  const totales = useMemo(
    () => ({
      enBodega: filtrados.reduce((a, r) => a + r.enBodega, 0),
      enCamino: filtrados.reduce((a, r) => a + r.enCamino, 0),
    }),
    [filtrados],
  );

  const urlExcel = useMemo(() => {
    const p = new URLSearchParams();
    if (busqueda.trim()) p.set("q", busqueda.trim());
    if (almacen) p.set("almacen", almacen);
    if (!soloConExistencia) p.set("conCeros", "1");
    const qs = p.toString();
    return `/api/inventario/excel${qs ? `?${qs}` : ""}`;
  }, [busqueda, almacen, soloConExistencia]);

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
          {almacenes?.length ? (
            <select
              value={almacen}
              onChange={(e) => setAlmacen(e.target.value)}
              aria-label="Filtrar por bodega"
              className="rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
            >
              <option value="">Todas las bodegas</option>
              {almacenes.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          ) : null}
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
          <BotonDescarga href={urlExcel} chico title="Baja exactamente lo que ves: misma búsqueda y mismos filtros">
            Excel de esta vista
          </BotonDescarga>
        </div>

        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          <strong className="cifra">{filtrados.length}</strong> SKUs · bodega{" "}
          <span className="cifra">{n(totales.enBodega)}</span> · en camino de China{" "}
          <span className="cifra">{n(totales.enCamino)}</span>
        </p>
      </header>

      <div className="max-h-[40rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              {/* En Bodega el SKU de MELI/Full sobra como columna propia: aquí
                  se piensa en modelo + color + talla; lo de MELI vive en su
                  sección. */}
              <th>Modelo</th>
              <th>Color</th>
              <th className="num">Talla</th>
              <th className="num">Bodega</th>
              <th className="num">En camino de China</th>
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
                    <td className="text-sm font-medium">{r.modelo}</td>
                    <td className="text-sm">{r.color}</td>
                    <td className="num cifra text-sm">{r.talla}</td>
                    <td className="num cifra">{r.enBodega ? n(r.enBodega) : "—"}</td>
                    <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                      {r.enCamino ? n(r.enCamino) : "—"}
                    </td>
                    <td className="num cifra font-semibold">{n(r.enBodega + r.enCamino)}</td>
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
                          aria-expanded={abierto}
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
                          <td colSpan={3} className="pl-8 text-xs" style={{ color: "var(--ink-2)" }}>
                            Pedido <strong>{p.pedido}</strong> · {p.almacen}
                          </td>
                          <td colSpan={3} className="text-xs" style={{ color: "var(--ink-2)" }}>
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
          Se muestran los primeros 500 de {filtrados.length}. Afina la búsqueda para ver el resto;
          el Excel de esta vista los trae todos.
        </footer>
      ) : null}
    </section>
  );
}
