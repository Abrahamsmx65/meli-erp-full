"use client";

import { useMemo, useState } from "react";
import { estiloInput } from "./comunes";

export interface RenglonInv {
  skuMeli: string;
  titulo: string | null;
  diseno: string;
  /** categoría del diseño en Productos y costos (Fundas / Tabletas / Micas); null = sin capturar */
  tipo?: string | null;
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

interface Totales {
  vendidas30: number;
  enFull: number;
  enTransferencia: number;
  enCamino: number;
  enBodega: number;
  enCaminoChina: number;
}

const CERO: Totales = { vendidas30: 0, enFull: 0, enTransferencia: 0, enCamino: 0, enBodega: 0, enCaminoChina: 0 };

function sumar(a: Totales, r: RenglonInv): Totales {
  return {
    vendidas30: a.vendidas30 + r.vendidas30,
    enFull: a.enFull + r.enFull,
    enTransferencia: a.enTransferencia + r.enTransferencia,
    enCamino: a.enCamino + r.enCamino,
    enBodega: a.enBodega + r.enBodega,
    enCaminoChina: a.enCaminoChina + r.enCaminoChina,
  };
}

function CeldasTotales({ t, fuerte }: { t: Totales; fuerte?: boolean }) {
  const cls = `num px-3 py-1.5 text-right${fuerte ? " font-semibold" : ""}`;
  return (
    <>
      <td className={cls}>{n(t.vendidas30)}</td>
      <td className={cls}>{n(t.enFull)}</td>
      <td className={cls}>{n(t.enTransferencia)}</td>
      <td className={cls}>{n(t.enCamino)}</td>
      <td className={cls}>{n(t.enBodega)}</td>
      <td className={cls}>{n(t.enCaminoChina)}</td>
    </>
  );
}

/**
 * La bodega en TRES niveles, como pidió el dueño: primero el TIPO (Fundas /
 * Tabletas / Micas, la categoría del diseño en Productos y costos), abajo
 * los totales POR DISEÑO, y solo al abrir un diseño salen sus SKUs con el
 * detalle. Todo viene masticado del servidor; aquí solo se agrupa y pinta.
 */
export function TablaInventarioYz({ renglones }: { renglones: RenglonInv[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [soloConExistencia, setSoloConExistencia] = useState(true);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const buscando = busqueda.trim().length > 0;

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return renglones.filter((r) => {
      if (soloConExistencia && r.enFull + r.enTransferencia + r.enCamino + r.enBodega + r.enCaminoChina === 0) return false;
      return !q || `${r.skuMeli} ${r.titulo ?? ""} ${r.diseno} ${r.tipo ?? ""} ${r.skusBodega.join(" ")}`.toUpperCase().includes(q);
    });
  }, [renglones, busqueda, soloConExistencia]);

  const arbol = useMemo(() => {
    const tipos = new Map<string, { totales: Totales; disenos: Map<string, { totales: Totales; skus: RenglonInv[] }> }>();
    for (const r of filtrados) {
      const tipo = r.tipo?.trim() || "Sin categoría";
      const diseno = r.diseno || "(sin diseño)";
      const t = tipos.get(tipo) ?? { totales: CERO, disenos: new Map() };
      t.totales = sumar(t.totales, r);
      const d = t.disenos.get(diseno) ?? { totales: CERO, skus: [] };
      d.totales = sumar(d.totales, r);
      d.skus.push(r);
      t.disenos.set(diseno, d);
      tipos.set(tipo, t);
    }
    const alfabetico = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });
    return [...tipos.entries()]
      .sort(([a], [b]) => (a === "Sin categoría" ? 1 : b === "Sin categoría" ? -1 : alfabetico(a, b)))
      .map(([tipo, t]) => ({
        tipo,
        totales: t.totales,
        disenos: [...t.disenos.entries()]
          .sort(([a], [b]) => alfabetico(a, b))
          .map(([diseno, d]) => ({
            diseno,
            totales: d.totales,
            skus: d.skus.sort((x, y) => alfabetico(x.skuMeli, y.skuMeli)),
          })),
      }));
  }, [filtrados]);

  const total = filtrados.reduce(sumar, CERO);
  const sinCategoria = arbol.find((t) => t.tipo === "Sin categoría");
  const alternar = (clave: string) =>
    setAbiertos((prev) => {
      const s = new Set(prev);
      if (s.has(clave)) s.delete(clave);
      else s.add(clave);
      return s;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="tarjeta flex flex-wrap items-center gap-3 p-3 text-sm">
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar SKU, diseño, tipo o título…" className="w-64 rounded-lg border px-2 py-1 text-xs" style={estiloInput} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={soloConExistencia} onChange={(e) => setSoloConExistencia(e.target.checked)} />
          Solo con existencia
        </label>
        <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
          {filtrados.length} SKUs · {arbol.reduce((a, t) => a + t.disenos.length, 0)} diseños
        </span>
      </div>

      {sinCategoria ? (
        <p className="text-xs" style={{ color: "var(--ink-2)" }}>
          Los diseños de «Sin categoría» no tienen tipo capturado: márcalos como Fundas, Tabletas o Micas en
          Productos y costos (Bodega) y aquí se agrupan solos.
        </p>
      ) : null}

      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
              <th className="px-3 py-2">Tipo / diseño / SKU</th>
              <th className="px-3 py-2 text-right">Vend. 30 d</th>
              <th className="px-3 py-2 text-right">En Full</th>
              <th className="px-3 py-2 text-right">Transf.</th>
              <th className="px-3 py-2 text-right">En camino</th>
              <th className="px-3 py-2 text-right">Bodega</th>
              <th className="px-3 py-2 text-right">Desde China</th>
            </tr>
          </thead>
          <tbody>
            {arbol.map((t) => (
              <TipoFilas key={t.tipo} tipo={t} abiertos={abiertos} alternar={alternar} forzarAbierto={buscando} />
            ))}
            {!arbol.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center" style={{ color: "var(--ink-muted)" }}>
                  Nada coincide con el filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold" style={{ borderColor: "var(--borde)" }}>
              <td className="px-3 py-2">Total</td>
              <CeldasTotales t={total} fuerte />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function TipoFilas({
  tipo: t,
  abiertos,
  alternar,
  forzarAbierto,
}: {
  tipo: { tipo: string; totales: Totales; disenos: { diseno: string; totales: Totales; skus: RenglonInv[] }[] };
  abiertos: Set<string>;
  alternar: (clave: string) => void;
  forzarAbierto: boolean;
}) {
  return (
    <>
      <tr className="border-t" style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}>
        <td className="px-3 py-2 font-semibold">
          {t.tipo}
          <span className="ml-2 text-xs font-normal" style={{ color: "var(--ink-muted)" }}>
            {t.disenos.length} diseños
          </span>
        </td>
        <CeldasTotales t={t.totales} fuerte />
      </tr>
      {t.disenos.map((d) => {
        const clave = `${t.tipo}|${d.diseno}`;
        const abierto = forzarAbierto || abiertos.has(clave);
        return (
          <DisenoFilas key={clave} diseno={d} abierto={abierto} onToggle={() => alternar(clave)} />
        );
      })}
    </>
  );
}

function DisenoFilas({
  diseno: d,
  abierto,
  onToggle,
}: {
  diseno: { diseno: string; totales: Totales; skus: RenglonInv[] };
  abierto: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t" style={{ borderColor: "var(--grid)" }}>
        <td className="px-3 py-1.5">
          <button type="button" onClick={onToggle} className="num inline-flex items-center gap-1.5 pl-4 font-medium" title={abierto ? "Cerrar el diseño" : "Ver los SKUs del diseño"}>
            <span aria-hidden="true" className="text-xs" style={{ color: "var(--ink-muted)" }}>
              {abierto ? "▾" : "▸"}
            </span>
            {d.diseno}
            <span className="text-xs font-normal" style={{ color: "var(--ink-muted)" }}>
              {d.skus.length} SKUs
            </span>
          </button>
        </td>
        <CeldasTotales t={d.totales} />
      </tr>
      {abierto
        ? d.skus.map((r) => (
            <tr key={r.skuMeli} className="border-t" style={{ borderColor: "var(--grid)" }}>
              <td className="px-3 py-1.5 pl-12">
                <span className="num font-medium">{r.skuMeli}</span>
                {r.titulo ? (
                  <span className="ml-2 hidden text-xs md:inline" style={{ color: "var(--ink-muted)" }} title={r.titulo}>
                    {r.titulo.length > 60 ? `${r.titulo.slice(0, 60)}…` : r.titulo}
                  </span>
                ) : null}
                {r.skusBodega.length ? (
                  <div className="num text-[11px]" style={{ color: "var(--ink-muted)" }}>
                    bodega: {r.skusBodega.join(", ")}
                  </div>
                ) : null}
              </td>
              <CeldasTotales t={sumar(CERO, r)} />
            </tr>
          ))
        : null}
    </>
  );
}
