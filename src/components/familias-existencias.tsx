"use client";

import { Fragment, useDeferredValue, useMemo, useState } from "react";
import {
  compararFamilias,
  filtrarFamilias,
  type FamiliaExistencias,
  type OrdenFamilias,
  type VentasPorCanal,
} from "@/lib/servicios/familias-existencias";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

const ORDENES: { valor: OrdenFamilias; texto: string }[] = [
  { valor: "total-desc", texto: "Más stock primero" },
  { valor: "total-asc", texto: "Menos stock primero" },
  { valor: "ventas30-desc", texto: "Más vendido en 30 días" },
  { valor: "hist-desc", texto: "Más vendido desde siempre" },
  { valor: "alcanza-asc", texto: "Se acaba primero" },
  { valor: "modelo-asc", texto: "Modelo A → Z" },
];

/** «422» arriba y «MELI 191 · Amazon 10 · TikTok 221» abajo, chiquito. */
function Ventas({ v, fuerte }: { v: VentasPorCanal; fuerte?: boolean }) {
  if (!v.total) return <span className="texto-tenue">—</span>;
  const partes = [
    v.meli ? `MELI ${n(v.meli)}` : null,
    v.amazon ? `Amazon ${n(v.amazon)}` : null,
    v.tiktok ? `TikTok ${n(v.tiktok)}` : null,
  ].filter(Boolean);
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={`cifra ${fuerte ? "font-semibold" : ""}`}>{n(v.total)}</span>
      <span className="texto-tenue text-[11px] whitespace-nowrap">{partes.join(" · ")}</span>
    </span>
  );
}

function Dias({ dias }: { dias: number | null }) {
  if (dias == null) return <span className="texto-tenue">—</span>;
  const tono = dias < 15 ? "var(--estado-critico)" : dias < 30 ? "var(--estado-alerta)" : undefined;
  return (
    <span className="cifra" style={tono ? { color: tono, fontWeight: 600 } : undefined}>
      {n(dias)} d
    </span>
  );
}

const celda = (x: number, fuerte = false) =>
  x ? <span className={`cifra ${fuerte ? "font-semibold" : ""}`}>{n(x)}</span> : <span className="texto-tenue">—</span>;

/**
 * Existencias por FAMILIA: un renglón por modelo con todo lo que hay de él
 * en cada lugar y lo que ha vendido; abrir el renglón lo parte por color.
 */
export function FamiliasExistencias({
  familias,
  desde30,
  hasta,
  desdeCanal,
}: {
  familias: FamiliaExistencias[];
  desde30: string;
  hasta: string;
  desdeCanal: { meli: string | null; amazon: string | null; tiktok: string | null };
}) {
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<OrdenFamilias>("total-desc");
  const [soloConStock, setSoloConStock] = useState(true);
  const [abierta, setAbierta] = useState<string | null>(null);

  const busquedaDiferida = useDeferredValue(busqueda);
  const filtradas = useMemo(
    () =>
      filtrarFamilias(familias, busquedaDiferida)
        .filter((f) => !soloConStock || f.total > 0)
        .sort(compararFamilias(orden)),
    [familias, busquedaDiferida, soloConStock, orden],
  );

  const totales = useMemo(() => {
    const t = { enBodega: 0, enBarco: 0, enFabrica: 0, enFull: 0, enFba: 0, enTikTok: 0, total: 0, v30: 0, hist: 0 };
    for (const f of filtradas) {
      t.enBodega += f.enBodega;
      t.enBarco += f.enBarco;
      t.enFabrica += f.enFabrica;
      t.enFull += f.enFull;
      t.enFba += f.enFba;
      t.enTikTok += f.enTikTok;
      t.total += f.total;
      t.v30 += f.ventas30.total;
      t.hist += f.ventasHist.total;
    }
    return t;
  }, [filtradas]);

  const fecha = (iso: string | null) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : null);
  const desdeTexto = [
    desdeCanal.meli ? `MELI desde ${fecha(desdeCanal.meli)}` : null,
    desdeCanal.amazon ? `Amazon desde ${fecha(desdeCanal.amazon)}` : null,
    desdeCanal.tiktok ? `TikTok desde ${fecha(desdeCanal.tiktok)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-col gap-3 border-b p-4 hairline">
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
            onChange={(e) => setOrden(e.target.value as OrdenFamilias)}
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
          <strong className="cifra">{n(filtradas.length)}</strong> familias ·{" "}
          <strong className="cifra">{n(totales.total)}</strong> pares en total (bodega {n(totales.enBodega)} · barco{" "}
          {n(totales.enBarco)} · Full {n(totales.enFull)} · FBA {n(totales.enFba)} · TikTok {n(totales.enTikTok)}
          {totales.enFabrica ? ` · ${n(totales.enFabrica)} más en la fábrica, fuera del total` : ""}) ·{" "}
          <strong className="cifra">{n(totales.v30)}</strong> vendidos del {fecha(desde30)} al {fecha(hasta)} ·{" "}
          <strong className="cifra">{n(totales.hist)}</strong> desde que el ERP registra
          {desdeTexto ? ` (${desdeTexto})` : ""}
        </p>
      </header>

      <div className="max-h-[36rem] overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Familia</th>
              <th className="num">Colores</th>
              <th className="num">Cajas</th>
              <th className="num">Bodega</th>
              <th className="num">Barco</th>
              <th className="num">Fábrica</th>
              <th className="num">Full</th>
              <th className="num">FBA</th>
              <th className="num">TikTok</th>
              <th className="num">Total</th>
              <th className="num">Vendidos 30 d</th>
              <th className="num">Vendidos total</th>
              <th className="num">Alcanza</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 ? (
              <tr>
                <td colSpan={13} className="texto-2 p-4 text-sm">
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
                    <td className="num">{celda(f.cajas)}</td>
                    <td className="num">{celda(f.enBodega)}</td>
                    <td className="num">{celda(f.enBarco)}</td>
                    <td className="num texto-2">{celda(f.enFabrica)}</td>
                    <td className="num">{celda(f.enFull)}</td>
                    <td className="num">{celda(f.enFba)}</td>
                    <td className="num">{celda(f.enTikTok)}</td>
                    <td className="num">{celda(f.total, true)}</td>
                    <td className="num">
                      <Ventas v={f.ventas30} fuerte />
                    </td>
                    <td className="num">
                      <Ventas v={f.ventasHist} />
                    </td>
                    <td className="num">
                      <Dias dias={f.diasQueAlcanza} />
                    </td>
                  </tr>
                  {abierto
                    ? f.colores.map((c) => {
                        const ritmo = c.ventas30.total / 30;
                        const dias = c.total > 0 && ritmo > 0 ? Math.round(c.total / ritmo) : null;
                        return (
                          <tr key={c.color} style={{ background: "var(--surface-2)" }}>
                            <td className="pl-8 text-xs texto-2">{c.color}</td>
                            <td />
                            <td />
                            <td className="num text-xs">{celda(c.enBodega)}</td>
                            <td className="num text-xs">{celda(c.enBarco)}</td>
                            <td className="num text-xs texto-2">{celda(c.enFabrica)}</td>
                            <td className="num text-xs">{celda(c.enFull)}</td>
                            <td className="num text-xs">{celda(c.enFba)}</td>
                            <td className="num text-xs">{celda(c.enTikTok)}</td>
                            <td className="num text-xs">{celda(c.total, true)}</td>
                            <td className="num text-xs">
                              <Ventas v={c.ventas30} />
                            </td>
                            <td className="num text-xs">
                              <Ventas v={c.ventasHist} />
                            </td>
                            <td className="num text-xs">
                              <Dias dias={dias} />
                            </td>
                          </tr>
                        );
                      })
                    : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
