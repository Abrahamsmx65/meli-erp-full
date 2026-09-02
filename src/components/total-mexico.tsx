"use client";

import { Fragment, useMemo, useState } from "react";
import { coincide, terminosDeBusqueda } from "@/lib/reporte/filtro";
import type { FamiliaMexico } from "@/lib/servicios/inventario";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

type Orden = "pares-desc" | "pares-asc" | "cajas-desc" | "cajas-asc" | "modelo-asc" | "modelo-desc";

const ORDENES: { valor: Orden; texto: string }[] = [
  { valor: "pares-desc", texto: "Más pares primero" },
  { valor: "pares-asc", texto: "Menos pares primero" },
  { valor: "cajas-desc", texto: "Más cajas primero" },
  { valor: "cajas-asc", texto: "Menos cajas primero" },
  { valor: "modelo-asc", texto: "Modelo A → Z" },
  { valor: "modelo-desc", texto: "Modelo Z → A" },
];

function comparar(orden: Orden) {
  return (a: FamiliaMexico, b: FamiliaMexico): number => {
    switch (orden) {
      case "pares-desc":
        return b.pares - a.pares || a.modelo.localeCompare(b.modelo, "es");
      case "pares-asc":
        return a.pares - b.pares || a.modelo.localeCompare(b.modelo, "es");
      case "cajas-desc":
        return b.cajas - a.cajas || b.pares - a.pares;
      case "cajas-asc":
        return a.cajas - b.cajas || a.pares - b.pares;
      case "modelo-desc":
        return b.modelo.localeCompare(a.modelo, "es");
      default:
        return a.modelo.localeCompare(b.modelo, "es");
    }
  };
}

/**
 * Cuánto hay de cada familia aquí en México.
 *
 * La tabla de abajo desglosa talla por talla, que es lo que se necesita para
 * decidir un envío. Esta contesta la pregunta de todos los días — "de GT114,
 * ¿cuánto tengo?" — con la familia entera junta: todos sus colores y todas
 * sus tallas en un solo renglón, todas las bodegas sumadas, y sin lo que
 * viene de China porque todavía no se puede mandar. El desglose sigue ahí,
 * abriendo el renglón.
 */
export function TotalMexico({ familias }: { familias: FamiliaMexico[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<Orden>("pares-desc");
  const [abierta, setAbierta] = useState<string | null>(null);

  const terminos = useMemo(() => terminosDeBusqueda(busqueda), [busqueda]);

  const filtradas = useMemo(
    () =>
      familias
        .filter(
          (f) =>
            coincide(f.modelo, terminos) ||
            f.detalle.some((d) => coincide(`${d.sku} ${f.modelo} ${d.color} ${d.talla}`, terminos)),
        )
        .sort(comparar(orden)),
    [familias, terminos, orden],
  );

  const totales = useMemo(
    () => ({
      cajas: filtradas.reduce((a, f) => a + f.cajas, 0),
      pares: filtradas.reduce((a, f) => a + f.pares, 0),
    }),
    [filtradas],
  );

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-col gap-3 border-b p-4 hairline">
        <div>
          <h2 className="text-sm font-semibold">Total en México por familia</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
            Cada modelo con todos sus colores y tallas juntos, todas las bodegas sumadas.
            No incluye lo que viene de China. Abre un renglón para ver el desglose.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar familia, color, talla o SKU…"
            className="min-w-[18rem] flex-1"
            aria-label="Buscar familia en el total de México"
          />
          <select
            value={orden}
            onChange={(e) => setOrden(e.target.value as Orden)}
            aria-label="Ordenar"
            className="rounded-lg border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
          >
            {ORDENES.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </select>
        </div>

        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          <strong className="cifra">{n(filtradas.length)}</strong> familias ·{" "}
          <strong className="cifra">{n(totales.cajas)}</strong> cajas ·{" "}
          <strong className="cifra">{n(totales.pares)}</strong> pares en México
        </p>
      </header>

      <div className="max-h-[32rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Familia</th>
              <th className="num">Colores</th>
              <th className="num">Tallas</th>
              <th className="num">Cajas</th>
              <th className="num">Pares</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((f) => {
              const abierto = abierta === f.modelo;
              return (
                <Fragment key={f.modelo}>
                  <tr>
                    <td>
                      <button
                        onClick={() => setAbierta(abierto ? null : f.modelo)}
                        className="font-semibold"
                        style={{ color: "var(--acento)" }}
                        aria-expanded={abierto}
                      >
                        {f.modelo} {abierto ? "▴" : "▾"}
                      </button>
                    </td>
                    <td className="num cifra text-sm">{n(f.colores)}</td>
                    <td className="num cifra text-sm">{n(f.detalle.length)}</td>
                    <td className="num cifra">{f.cajas ? n(f.cajas) : "—"}</td>
                    <td className="num cifra font-semibold">{n(f.pares)}</td>
                  </tr>

                  {abierto
                    ? f.detalle.map((d) => (
                        <tr key={d.sku}>
                          <td className="pl-8 text-xs" style={{ color: "var(--ink-2)" }}>
                            {d.sku}
                          </td>
                          <td className="text-xs" colSpan={2} style={{ color: "var(--ink-2)" }}>
                            {d.color} · talla {d.talla}
                          </td>
                          <td />
                          <td className="num cifra text-xs">{n(d.pares)}</td>
                        </tr>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="border-t p-3 text-xs hairline" style={{ color: "var(--ink-muted)" }}>
        Las cajas se cuentan una sola vez: una caja de corrida trae varias tallas, pero
        todas del mismo modelo, así que por familia el número es exacto. Por eso el
        desglose de adentro solo muestra pares.
      </footer>
    </section>
  );
}
