"use client";

import { useMemo, useState } from "react";
import { estiloInput } from "./comunes";

export interface RenglonInv {
  skuMeli: string;
  titulo: string | null;
  diseno: string;
  enFull: number;
  enTransferencia: number;
  enCamino: number;
  enBodega: number;
  enCaminoChina: number;
  vendidas30: number;
  skusBodega: string[];
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Cada SKU con sus lugares: en Full, viajando a Full, en bodega (del sheet)
 * y en camino desde China. Cuatro tiempos de disponibilidad distintos.
 */
export function TablaInventarioYz({ renglones }: { renglones: RenglonInv[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [soloConExistencia, setSoloConExistencia] = useState(true);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return renglones.filter((r) => {
      if (soloConExistencia && r.enFull + r.enTransferencia + r.enCamino + r.enBodega + r.enCaminoChina === 0) return false;
      return !q || `${r.skuMeli} ${r.titulo ?? ""} ${r.diseno} ${r.skusBodega.join(" ")}`.toUpperCase().includes(q);
    });
  }, [renglones, busqueda, soloConExistencia]);

  const tot = filtrados.reduce(
    (a, r) => ({
      enFull: a.enFull + r.enFull,
      enTransferencia: a.enTransferencia + r.enTransferencia,
      enCamino: a.enCamino + r.enCamino,
      enBodega: a.enBodega + r.enBodega,
      enCaminoChina: a.enCaminoChina + r.enCaminoChina,
    }),
    { enFull: 0, enTransferencia: 0, enCamino: 0, enBodega: 0, enCaminoChina: 0 },
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="tarjeta flex flex-wrap items-center gap-3 p-3 text-sm">
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar SKU, diseño o título…" className="w-64 rounded-lg border px-2 py-1 text-xs" style={estiloInput} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={soloConExistencia} onChange={(e) => setSoloConExistencia(e.target.checked)} />
          Solo con existencia
        </label>
        <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
          {filtrados.length} SKUs
        </span>
      </div>
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Título</th>
              <th className="px-3 py-2 text-right">Vend. 30 d</th>
              <th className="px-3 py-2 text-right">En Full</th>
              <th className="px-3 py-2 text-right">Transf.</th>
              <th className="px-3 py-2 text-right">En camino</th>
              <th className="px-3 py-2 text-right">Bodega</th>
              <th className="px-3 py-2 text-right">Desde China</th>
              <th className="px-3 py-2">SKU bodega</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((r) => (
              <tr key={r.skuMeli} className="border-t" style={{ borderColor: "var(--grid)" }}>
                <td className="num px-3 py-1.5 font-medium">{r.skuMeli}</td>
                <td className="max-w-[320px] truncate px-3 py-1.5" style={{ color: "var(--ink-2)" }} title={r.titulo ?? ""}>
                  {r.titulo ?? ""}
                </td>
                <td className="num px-3 py-1.5 text-right">{n(r.vendidas30)}</td>
                <td className="num px-3 py-1.5 text-right">{n(r.enFull)}</td>
                <td className="num px-3 py-1.5 text-right">{n(r.enTransferencia)}</td>
                <td className="num px-3 py-1.5 text-right">{n(r.enCamino)}</td>
                <td className="num px-3 py-1.5 text-right font-medium">{n(r.enBodega)}</td>
                <td className="num px-3 py-1.5 text-right">{n(r.enCaminoChina)}</td>
                <td className="num px-3 py-1.5 text-xs" style={{ color: "var(--ink-muted)" }}>
                  {r.skusBodega.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold" style={{ borderColor: "var(--borde)" }}>
              <td className="px-3 py-2" colSpan={3}>
                Total
              </td>
              <td className="num px-3 py-2 text-right">{n(tot.enFull)}</td>
              <td className="num px-3 py-2 text-right">{n(tot.enTransferencia)}</td>
              <td className="num px-3 py-2 text-right">{n(tot.enCamino)}</td>
              <td className="num px-3 py-2 text-right">{n(tot.enBodega)}</td>
              <td className="num px-3 py-2 text-right">{n(tot.enCaminoChina)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
