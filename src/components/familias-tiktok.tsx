"use client";

import { Fragment, useDeferredValue, useMemo, useState } from "react";
import {
  compararFamiliasTikTok,
  filtrarFamiliasTikTok,
  type FamiliaTikTok,
  type OrdenFamiliasTikTok,
} from "@/lib/tiktok/familias";
import { Seccion } from "@/components/ui/pagina";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

const ORDENES: { valor: OrdenFamiliasTikTok; texto: string }[] = [
  { valor: "disponible-desc", texto: "Más disponible primero" },
  { valor: "disponible-asc", texto: "Menos disponible primero" },
  { valor: "ventas30-desc", texto: "Más vendido en 30 días" },
  { valor: "hist-desc", texto: "Más vendido desde siempre" },
  { valor: "alcanza-asc", texto: "Se acaba primero" },
  { valor: "modelo-asc", texto: "Modelo A → Z" },
];

const celda = (x: number, fuerte = false) =>
  x ? <span className={`cifra ${fuerte ? "font-semibold" : ""}`}>{n(x)}</span> : <span className="texto-tenue">—</span>;

function Dias({ dias }: { dias: number | null }) {
  if (dias == null) return <span className="texto-tenue">—</span>;
  const tono = dias < 7 ? "var(--estado-critico)" : dias < 15 ? "var(--estado-alerta)" : undefined;
  return (
    <span className="cifra" style={tono ? { color: tono, fontWeight: 600 } : undefined}>
      {n(dias)} d
    </span>
  );
}

const fecha = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

/**
 * Almacén TikTok por FAMILIA: un renglón por modelo con lo que hay en la
 * bodega de TikTok y lo que vendió; abrir el renglón lo parte por color.
 */
export function FamiliasTikTok({
  familias,
  diasVenta,
  ventasDesde,
}: {
  familias: FamiliaTikTok[];
  diasVenta: number;
  ventasDesde: string | null;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<OrdenFamiliasTikTok>("disponible-desc");
  const [soloConStock, setSoloConStock] = useState(true);
  const [abierta, setAbierta] = useState<string | null>(null);

  const busquedaDiferida = useDeferredValue(busqueda);
  const filtradas = useMemo(
    () =>
      filtrarFamiliasTikTok(familias, busquedaDiferida)
        .filter((f) => !soloConStock || f.saldo > 0 || f.apartado > 0)
        .sort(compararFamiliasTikTok(orden)),
    [familias, busquedaDiferida, soloConStock, orden],
  );
  const totales = useMemo(() => {
    const t = { skus: 0, saldo: 0, apartado: 0, disponible: 0, sinLinea: 0, v30: 0, hist: 0 };
    for (const f of filtradas) {
      t.skus += f.skus;
      t.saldo += f.saldo;
      t.apartado += f.apartado;
      t.disponible += f.disponible;
      t.sinLinea += f.sinLinea;
      t.v30 += f.ventas30;
      t.hist += f.ventasHist;
    }
    return t;
  }, [filtradas]);

  return (
    <Seccion titulo="Almacén TikTok por familia" sinRelleno>
      <div className="flex flex-col gap-3 border-b p-4 hairline">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar familia o color…"
            className="min-w-[18rem] flex-1"
            aria-label="Buscar familia"
          />
          <select
            value={orden}
            onChange={(e) => setOrden(e.target.value as OrdenFamiliasTikTok)}
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
          <label className="flex items-center gap-1.5 text-sm texto-2">
            <input type="checkbox" checked={soloConStock} onChange={(e) => setSoloConStock(e.target.checked)} />
            Solo con stock
          </label>
        </div>
        <p className="text-sm texto-2">
          <strong className="cifra">{n(filtradas.length)}</strong> familias · <strong className="cifra">{n(totales.skus)}</strong> SKU ·{" "}
          <strong className="cifra">{n(totales.saldo)}</strong> en almacén · <strong className="cifra">{n(totales.apartado)}</strong> apartados ·{" "}
          <strong className="cifra">{n(totales.disponible)}</strong> disponibles
          {totales.sinLinea ? ` (${n(totales.sinLinea)} sin publicación activa)` : ""} ·{" "}
          <strong className="cifra">{n(totales.v30)}</strong> vendidos en {diasVenta} días ·{" "}
          <strong className="cifra">{n(totales.hist)}</strong> desde que el ERP registra{ventasDesde ? ` (${fecha(ventasDesde)})` : ""}
        </p>
      </div>

      <div className="max-h-[36rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Familia</th>
              <th className="num">Colores</th>
              <th className="num">SKU</th>
              <th className="num">En almacén</th>
              <th className="num">Apartado</th>
              <th className="num">Disponible</th>
              <th className="num">Sin línea</th>
              <th className="num">Vendidos {diasVenta} d</th>
              <th className="num">Vendidos total</th>
              <th className="num">Alcanza</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 ? (
              <tr>
                <td colSpan={10} className="texto-2 p-4 text-sm">
                  Ninguna familia coincide.
                </td>
              </tr>
            ) : null}
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
                    <td className="num cifra text-sm">{f.colores.length ? n(f.colores.length) : "—"}</td>
                    <td className="num cifra text-sm">{n(f.skus)}</td>
                    <td className="num">{celda(f.saldo)}</td>
                    <td className="num" style={f.apartado ? { color: "var(--estado-alerta)" } : undefined}>
                      {celda(f.apartado)}
                    </td>
                    <td className="num">{celda(f.disponible, true)}</td>
                    <td className="num" style={f.sinLinea ? { color: "var(--estado-critico)" } : undefined}>
                      {celda(f.sinLinea)}
                    </td>
                    <td className="num">{celda(f.ventas30, true)}</td>
                    <td className="num texto-2">{celda(f.ventasHist)}</td>
                    <td className="num">
                      <Dias dias={f.diasQueAlcanza} />
                    </td>
                  </tr>
                  {abierto
                    ? f.colores.map((c) => (
                        <tr key={c.color} style={{ background: "var(--surface-2)" }}>
                          <td className="pl-8 text-xs texto-2">{c.color}</td>
                          <td />
                          <td className="num cifra text-xs">{n(c.skus)}</td>
                          <td className="num text-xs">{celda(c.saldo)}</td>
                          <td className="num text-xs">{celda(c.apartado)}</td>
                          <td className="num text-xs">{celda(c.disponible, true)}</td>
                          <td className="num text-xs">{celda(c.sinLinea)}</td>
                          <td className="num text-xs">{celda(c.ventas30, true)}</td>
                          <td className="num text-xs texto-2">{celda(c.ventasHist)}</td>
                          <td className="num text-xs">
                            <Dias dias={c.diasQueAlcanza} />
                          </td>
                        </tr>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Seccion>
  );
}
