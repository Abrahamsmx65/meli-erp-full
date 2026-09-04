"use client";

import { Fragment, useMemo, useState } from "react";

interface Renglon {
  modelo: string;
  color: string;
  cajasSugeridas: number;
  paresSugeridos: number;
  paresPorCaja: number | null;
  cajasCorrida: number;
  unitallas: { talla: string; cajas: number }[];
  corridaPropuesta: Record<string, number> | null;
  faltantePorTalla: Record<string, number>;
  coberturaDias: number | null;
  tieneCorrida: boolean;
  faltante: number;
  motivo: string;
  enBodega: number;
  enFull: number;
  enTransferencia: number;
  enFba: number;
  enCamino: number;
  ventaMes: number;
  ventaMesReal: number;
  ventaMesAmazon: number;
  ventaMesRealAmazon?: number;
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * El pedido a China visto como se negocia con la fábrica: POR MODELO.
 *
 * Picas el modelo y aparece cada color con sus cajas de corrida (y la
 * corrida CALCULADA según lo que falta de cada talla, no la histórica),
 * más las cajas unitalla cuando el volumen las justifica. El Excel del
 * modelo sale de aquí, listo para mandar.
 *
 * El stock y la venta del renglón del modelo suman TODOS sus colores, no
 * solo los que piden caja: antes el GT114 enseñaba "bodega 10 mil" cuando
 * en /inventario había 51 mil, porque el DK BROWN, el BEIGE y los demás
 * colores con inventario de sobra no pedían nada y se quedaban fuera de la
 * suma. El cálculo por color siempre descontó su stock completo; lo que
 * engañaba era el número del renglón. Las cajas y los pares a pedir sí son
 * solo de los colores que piden.
 */
export function PedidoPorModelo({ renglones }: { renglones: Renglon[] }) {
  const [abierto, setAbierto] = useState<string | null>(null);

  const modelos = useMemo(() => {
    const porModelo = new Map<
      string,
      {
        /** colores que piden caja */
        colores: Renglon[];
        /** colores del mismo modelo que NO piden: su stock sí cuenta arriba */
        sinPedido: Renglon[];
        cajas: number;
        pares: number;
        bodega: number;
        meli: number;
        amazon: number;
        china: number;
        vMeli: number;
        vAmz: number;
        vReal: number;
        vAmzReal: number;
      }
    >();
    for (const r of renglones) {
      const m =
        porModelo.get(r.modelo) ??
        { colores: [], sinPedido: [], cajas: 0, pares: 0, bodega: 0, meli: 0, amazon: 0, china: 0, vMeli: 0, vAmz: 0, vReal: 0, vAmzReal: 0 };
      // Todo color del modelo cuenta en stock y venta, pida o no pida.
      m.bodega += r.enBodega;
      m.meli += r.enFull + r.enTransferencia;
      m.amazon += r.enFba;
      m.china += r.enCamino;
      m.vMeli += r.ventaMes;
      m.vAmz += r.ventaMesAmazon;
      m.vReal += r.ventaMesReal ?? r.ventaMes;
      m.vAmzReal += r.ventaMesRealAmazon ?? r.ventaMesAmazon;
      if (r.cajasSugeridas > 0) {
        m.colores.push(r);
        m.cajas += r.cajasSugeridas;
        m.pares += r.paresSugeridos;
      } else {
        m.sinPedido.push(r);
      }
      porModelo.set(r.modelo, m);
    }
    // Solo se listan los modelos que piden algo: la sección es el pedido.
    return [...porModelo.entries()]
      .filter(([, m]) => m.cajas > 0)
      .map(([modelo, m]) => ({ modelo, ...m }))
      .sort((a, b) => b.cajas - a.cajas);
  }, [renglones]);

  if (!modelos.length) return null;

  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b p-4 hairline">
        <h2 className="text-base font-semibold">Pedido por modelo</h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Cada modelo con todos sus colores, listo para negociar con la fábrica. La
          corrida propuesta se calcula con lo que falta de cada talla — venta menos
          stock completo — no con la corrida vieja. Una talla se separa como
          unitalla cuando ella sola justifica 5+ cajas.
        </p>
      </header>

      <div className="max-h-[36rem] overflow-auto">
      <table className="datos">
        <thead>
          <tr>
            <th>Modelo</th>
            <th className="num" title="Colores que piden caja / colores del modelo">
              Colores
            </th>
            <th className="num" title="Pares en cajas cerradas de TODOS los colores del modelo">
              Bodega
            </th>
            <th className="num">MELI</th>
            <th className="num">Amazon</th>
            <th className="num">De China</th>
            <th className="num" title="Unidades realmente vendidas en MELI, sin corrección">
              Vendido MELI real
            </th>
            <th className="num" title="Demanda corregida por agotamiento y tendencia (la que usa el cálculo)">
              Vta MELI/mes
            </th>
            <th className="num" title="Unidades realmente vendidas en Amazon, sin corrección">
              Vendido AMZ real
            </th>
            <th
              className="num"
              title="Venta de Amazon corregida por agotamiento con las fotos diarias del inventario FBA (la que usa el cálculo)"
            >
              Vta AMZ/mes
            </th>
            <th className="num">Cajas a pedir</th>
            <th className="num">Pares</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {modelos.map((m) => (
            <Fragment key={m.modelo}>
              <tr
                onClick={() => setAbierto(abierto === m.modelo ? null : m.modelo)}
                style={{ cursor: "pointer" }}
              >
                <td className="font-semibold">
                  <span aria-hidden="true" style={{ color: "var(--ink-muted)" }}>
                    {abierto === m.modelo ? "▾ " : "▸ "}
                  </span>
                  {m.modelo}
                </td>
                <td className="num cifra">
                  {m.sinPedido.length
                    ? `${m.colores.length} de ${m.colores.length + m.sinPedido.length}`
                    : m.colores.length}
                </td>
                <td className="num cifra">{n(m.bodega)}</td>
                <td className="num cifra">{n(m.meli)}</td>
                <td className="num cifra">{n(m.amazon)}</td>
                <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                  {m.china ? n(m.china) : "—"}
                </td>
                <td className="num cifra">{n(m.vReal)}</td>
                <td
                  className="num cifra"
                  style={
                    m.vReal > 0 && m.vMeli > m.vReal * 2
                      ? { color: "var(--estado-critico)" }
                      : undefined
                  }
                  title={
                    m.vReal > 0
                      ? `${(m.vMeli / m.vReal).toFixed(1)}× lo realmente vendido`
                      : undefined
                  }
                >
                  {n(m.vMeli)}
                </td>
                <td className="num cifra">{n(m.vAmzReal)}</td>
                <td
                  className="num cifra"
                  style={
                    m.vAmzReal > 0 && m.vAmz > m.vAmzReal * 2
                      ? { color: "var(--estado-critico)" }
                      : undefined
                  }
                  title={
                    m.vAmzReal > 0
                      ? `${(m.vAmz / m.vAmzReal).toFixed(1)}× lo realmente vendido`
                      : undefined
                  }
                >
                  {n(m.vAmz)}
                </td>
                <td className="num cifra font-semibold">{n(m.cajas)}</td>
                <td className="num cifra">{n(m.pares)}</td>
                <td className="text-right">
                  <a
                    href={`/api/pedidos/excel?modelo=${encodeURIComponent(m.modelo)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-white"
                    style={{ background: "var(--acento)" }}
                  >
                    Excel del pedido
                  </a>
                </td>
              </tr>

              {abierto === m.modelo ? (
                <>
                  {m.colores.map((c) => (
                    <DetalleColor key={c.color} r={c} />
                  ))}
                  {m.sinPedido.length ? <ColoresSinPedido colores={m.sinPedido} /> : null}
                </>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}

function DetalleColor({ r }: { r: Renglon }) {
  const tallas = Object.keys({ ...(r.corridaPropuesta ?? {}), ...r.faltantePorTalla }).sort(
    (a, b) => Number(a) - Number(b),
  );

  return (
    <tr style={{ background: "var(--surface-2)" }}>
      <td colSpan={13} className="p-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold">{r.color || "(sin color)"}</span>
            <span className="cifra text-sm">
              {n(r.cajasSugeridas)} cajas · {n(r.paresSugeridos)} pares
            </span>
            <span className="text-xs" style={{ color: "var(--ink-2)" }}>
              bodega {n(r.enBodega)} · MELI {n(r.enFull + r.enTransferencia)} · Amazon{" "}
              {n(r.enFba)} · de China {n(r.enCamino)} · vendió {n(r.ventaMesReal ?? r.ventaMes)}{" "}
              MELI + {n(r.ventaMesRealAmazon ?? r.ventaMesAmazon)} AMZ real / usa{" "}
              {n(r.ventaMes)} + {n(r.ventaMesAmazon)} al mes
            </span>
            {r.unitallas.length ? (
              <span className="text-sm" style={{ color: "var(--acento)" }}>
                {r.cajasCorrida > 0 ? `${n(r.cajasCorrida)} de corrida + ` : ""}
                {r.unitallas.map((u) => `${n(u.cajas)} unitalla T${u.talla}`).join(" + ")}
              </span>
            ) : null}
          </div>

          {r.corridaPropuesta && r.cajasCorrida > 0 ? (
            <div className="overflow-x-auto">
              <table className="datos" style={{ width: "auto" }}>
                <thead>
                  <tr>
                    <th>Corrida propuesta</th>
                    {tallas
                      .filter((t) => (r.corridaPropuesta?.[t] ?? 0) > 0)
                      .map((t) => (
                        <th key={t} className="num">
                          {t}
                        </th>
                      ))}
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ color: "var(--ink-2)" }}>pares por caja</td>
                    {tallas
                      .filter((t) => (r.corridaPropuesta?.[t] ?? 0) > 0)
                      .map((t) => (
                        <td key={t} className="num cifra">
                          {r.corridaPropuesta?.[t]}
                        </td>
                      ))}
                    <td className="num cifra font-medium">{r.paresPorCaja ?? "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            {r.motivo}
          </p>
        </div>
      </td>
    </tr>
  );
}

/**
 * Los colores del modelo que NO piden caja. Su stock ya está sumado en el
 * renglón del modelo; aquí se ve dónde está para que el total cuadre con
 * /inventario a simple vista.
 */
function ColoresSinPedido({ colores }: { colores: Renglon[] }) {
  const ordenados = [...colores].sort((a, b) => b.enBodega - a.enBodega);
  return (
    <tr style={{ background: "var(--surface-2)" }}>
      <td colSpan={13} className="p-4">
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">
            Sin pedido: {ordenados.length} {ordenados.length === 1 ? "color" : "colores"} con
            stock de sobra
          </span>
          <ul className="flex flex-col gap-0.5" style={{ color: "var(--ink-2)" }}>
            {ordenados.map((r) => (
              <li key={r.color} className="text-xs">
                <span className="font-medium" style={{ color: "var(--ink)" }}>
                  {r.color || "(sin color)"}
                </span>{" "}
                · bodega {n(r.enBodega)} · MELI {n(r.enFull + r.enTransferencia)} · Amazon{" "}
                {n(r.enFba)} · de China {n(r.enCamino)}
                {r.coberturaDias != null ? ` · aguanta ${n(r.coberturaDias)} días` : ""}
              </li>
            ))}
          </ul>
        </div>
      </td>
    </tr>
  );
}
