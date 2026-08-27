"use client";

import { useMemo, useState } from "react";
import { coincide, terminosDeBusqueda } from "@/lib/reporte/filtro";
import type { TotalMexicoSku } from "@/lib/servicios/inventario";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

type Orden = "pares-desc" | "pares-asc" | "cajas-desc" | "cajas-asc" | "sku-asc" | "sku-desc";

const ORDENES: { valor: Orden; texto: string }[] = [
  { valor: "pares-desc", texto: "Más pares primero" },
  { valor: "pares-asc", texto: "Menos pares primero" },
  { valor: "cajas-desc", texto: "Más cajas primero" },
  { valor: "cajas-asc", texto: "Menos cajas primero" },
  { valor: "sku-asc", texto: "SKU A → Z" },
  { valor: "sku-desc", texto: "SKU Z → A" },
];

function comparar(orden: Orden) {
  return (a: TotalMexicoSku, b: TotalMexicoSku): number => {
    switch (orden) {
      case "pares-desc":
        return b.pares - a.pares || a.sku.localeCompare(b.sku, "es");
      case "pares-asc":
        return a.pares - b.pares || a.sku.localeCompare(b.sku, "es");
      case "cajas-desc":
        return b.cajas - a.cajas || b.pares - a.pares;
      case "cajas-asc":
        return a.cajas - b.cajas || a.pares - b.pares;
      case "sku-desc":
        return b.sku.localeCompare(a.sku, "es");
      default:
        return a.sku.localeCompare(b.sku, "es");
    }
  };
}

/**
 * Total de lo que ya está en México, por SKU.
 *
 * La tabla grande de abajo separa bodega de China y desglosa por pedido, que
 * es lo correcto para decidir; esta es la pregunta simple de todos los días:
 * "de este SKU, ¿cuánto tengo aquí?". Todas las bodegas van sumadas en un
 * solo número y lo que viene de China no entra: todavía no se puede mandar.
 */
export function TotalMexico({ renglones }: { renglones: TotalMexicoSku[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<Orden>("pares-desc");

  const terminos = useMemo(() => terminosDeBusqueda(busqueda), [busqueda]);

  const filtrados = useMemo(
    () =>
      renglones
        .filter((r) => coincide(`${r.sku} ${r.modelo} ${r.color} ${r.talla}`, terminos))
        .sort(comparar(orden)),
    [renglones, terminos, orden],
  );

  const pares = useMemo(() => filtrados.reduce((a, r) => a + r.pares, 0), [filtrados]);

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-col gap-3 border-b p-4 hairline">
        <div>
          <h2 className="text-sm font-semibold">Total en México por SKU</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
            Todas las bodegas sumadas en un solo número. No incluye lo que viene de China.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por SKU, modelo, color o talla…"
            className="min-w-[18rem] flex-1"
            aria-label="Buscar SKU en el total de México"
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
          <strong className="cifra">{n(filtrados.length)}</strong> SKUs ·{" "}
          <strong className="cifra">{n(pares)}</strong> pares en México
        </p>
      </header>

      <div className="max-h-[32rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Modelo</th>
              <th>Color</th>
              <th className="num">Talla</th>
              <th className="num">Cajas</th>
              <th className="num">Pares</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.slice(0, 500).map((r) => (
              <tr key={r.sku}>
                <td className="text-sm font-medium">{r.sku}</td>
                <td className="text-sm">{r.modelo}</td>
                <td className="text-sm">{r.color}</td>
                <td className="num cifra text-sm">{r.talla}</td>
                <td className="num cifra">{r.cajas ? n(r.cajas) : "—"}</td>
                <td className="num cifra font-semibold">{n(r.pares)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="border-t p-3 text-xs hairline" style={{ color: "var(--ink-muted)" }}>
        {filtrados.length > 500 ? (
          <>Se muestran los primeros 500 de {n(filtrados.length)}. Afina la búsqueda para ver el resto. · </>
        ) : null}
        Las cajas de corrida traen varias tallas, así que una misma caja cuenta en cada
        talla que contiene: la columna dice en cuántas cajas aparece el SKU. Los pares no
        se repiten.
      </footer>
    </section>
  );
}
