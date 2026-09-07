"use client";

import { useMemo, useState } from "react";
import type { FilaVentas } from "@/lib/yapanizcel/ventas";
import { n, pesos } from "./comunes";

/**
 * Las tablas "Por diseño" y "Por SKU" de Ventas de fundas, con buscador y
 * columnas ordenables, igual que la de modelos del calzado. Todo en el
 * navegador: los renglones ya vienen sumados del servidor.
 */

type Clave = "clave" | "titulo" | "unidades" | "ordenes" | "precioPromedio" | "importe" | "comision" | "neto" | "costo" | "ganancia" | "margen";

function pct(x: number | null): string {
  return x == null ? "—" : `${Math.round(x * 100)}%`;
}

export function TablaVentasYz({ titulo, filas, conTitulo }: { titulo: string; filas: FilaVentas[]; conTitulo?: boolean }) {
  const [busqueda, setBusqueda] = useState("");
  const [soloSinCosto, setSoloSinCosto] = useState(false);
  const [orden, setOrden] = useState<{ clave: Clave; desc: boolean }>({ clave: "unidades", desc: true });

  const columnas: { clave: Clave; titulo: string; num: boolean }[] = [
    { clave: "clave", titulo: conTitulo ? "SKU" : "Diseño", num: false },
    ...(conTitulo ? [{ clave: "titulo" as Clave, titulo: "Título", num: false }] : []),
    { clave: "unidades", titulo: "Unidades", num: true },
    { clave: "ordenes", titulo: "Órdenes", num: true },
    { clave: "precioPromedio", titulo: "Precio prom.", num: true },
    { clave: "importe", titulo: "Ventas", num: true },
    { clave: "comision", titulo: "Comisión", num: true },
    { clave: "neto", titulo: "Neto", num: true },
    { clave: "costo", titulo: "Costo", num: true },
    { clave: "ganancia", titulo: "Ganancia", num: true },
    { clave: "margen", titulo: "Margen", num: true },
  ];

  const valor = (f: FilaVentas, clave: Clave): string | number | null => {
    if (clave === "titulo") return f.titulo ?? null;
    if (clave === "costo") return f.unidadesSinCosto ? null : f.costo;
    if (clave === "ganancia") return f.unidadesSinCosto ? null : f.ganancia;
    return f[clave];
  };

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    const lista = filas.filter((f) => {
      if (soloSinCosto && !f.unidadesSinCosto) return false;
      if (!q) return true;
      return f.clave.toUpperCase().includes(q) || f.diseno.toUpperCase() === q || (f.titulo ?? "").toUpperCase().includes(q);
    });
    const dir = orden.desc ? -1 : 1;
    lista.sort((a, b) => {
      const va = valor(a, orden.clave);
      const vb = valor(b, orden.clave);
      if (va == null && vb == null) return a.clave.localeCompare(b.clave, "es", { numeric: true });
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" || typeof vb === "string") return dir * String(va).localeCompare(String(vb), "es", { numeric: true });
      return dir * (va - vb) || a.clave.localeCompare(b.clave, "es", { numeric: true });
    });
    return lista;
  }, [filas, busqueda, soloSinCosto, orden]);

  const totales = useMemo(() => {
    const t = { unidades: 0, ordenes: 0, importe: 0, comision: 0, neto: 0, costo: 0, ganancia: 0, sinCosto: 0 };
    for (const f of visibles) {
      t.unidades += f.unidades;
      t.ordenes += f.ordenes;
      t.importe += f.importe;
      t.comision += f.comision;
      t.neto += f.neto;
      t.costo += f.costo;
      t.ganancia += f.ganancia;
      t.sinCosto += f.unidadesSinCosto;
    }
    return t;
  }, [visibles]);

  const ordenarPor = (clave: Clave) =>
    setOrden((o) => (o.clave === clave ? { clave, desc: !o.desc } : { clave, desc: clave !== "clave" && clave !== "titulo" }));
  const sinCosto = filas.filter((f) => f.unidadesSinCosto > 0).length;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">{titulo}</h2>
      <div className="tarjeta overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-3 text-sm hairline">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={conTitulo ? "SKU, diseño o título…" : "Diseño (499, 380…)"}
            className="min-w-[16rem] rounded-lg border px-2 py-1 text-sm"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            aria-label="Buscar"
          />
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink-2)" }}>
            <input type="checkbox" checked={soloSinCosto} onChange={(e) => setSoloSinCosto(e.target.checked)} />
            Solo sin costo ({sinCosto})
          </label>
          <span className="ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
            {visibles.length} de {filas.length} · ordenado por {columnas.find((c) => c.clave === orden.clave)?.titulo.toLowerCase()} {orden.desc ? "↓" : "↑"}
          </span>
        </div>
        <div className="max-h-[36rem] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
                {columnas.map((c) => (
                  <th key={c.clave} className={`px-3 py-2 ${c.num ? "text-right" : ""}`}>
                    <button
                      type="button"
                      onClick={() => ordenarPor(c.clave)}
                      className="inline-flex items-center gap-1 uppercase"
                      style={{ color: orden.clave === c.clave ? "var(--acento)" : undefined }}
                      title={`Ordenar por ${c.titulo.toLowerCase()}`}
                    >
                      {c.titulo}
                      {orden.clave === c.clave ? <span aria-hidden="true">{orden.desc ? "↓" : "↑"}</span> : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr>
                  <td colSpan={columnas.length} className="px-3 py-6 text-center" style={{ color: "var(--ink-muted)" }}>
                    {filas.length ? "Nada coincide con el filtro." : "Sin ventas en el periodo."}
                  </td>
                </tr>
              ) : null}
              {visibles.map((f) => (
                <tr key={f.clave} className="border-t" style={{ borderColor: "var(--grid)" }}>
                  <td className="num px-3 py-1.5 font-medium">{f.clave}</td>
                  {conTitulo ? (
                    <td className="max-w-[280px] truncate px-3 py-1.5" style={{ color: "var(--ink-2)" }} title={f.titulo ?? ""}>
                      {f.titulo ?? ""}
                    </td>
                  ) : null}
                  <td className="num px-3 py-1.5 text-right">{n(f.unidades)}</td>
                  <td className="num px-3 py-1.5 text-right">{n(f.ordenes)}</td>
                  <td className="num px-3 py-1.5 text-right">{pesos(f.precioPromedio)}</td>
                  <td className="num px-3 py-1.5 text-right">{pesos(f.importe)}</td>
                  <td className="num px-3 py-1.5 text-right">{pesos(f.comision)}</td>
                  <td className="num px-3 py-1.5 text-right" title={f.unidadesEstimadas ? `${f.unidadesEstimadas} unidades con neto estimado` : undefined}>
                    {pesos(f.neto)}
                    {f.unidadesEstimadas ? "*" : ""}
                  </td>
                  <td className="num px-3 py-1.5 text-right" style={{ color: f.unidadesSinCosto ? "var(--estado-serio)" : undefined }} title={f.unidadesSinCosto ? `${f.unidadesSinCosto} unidades sin costo` : undefined}>
                    {f.unidadesSinCosto ? `${pesos(f.costo)} ?` : pesos(f.costo)}
                  </td>
                  <td className="num px-3 py-1.5 text-right font-medium" style={{ color: f.unidadesSinCosto ? "var(--ink-muted)" : f.ganancia >= 0 ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                    {pesos(f.ganancia)}
                  </td>
                  <td className="num px-3 py-1.5 text-right">{pct(f.margen)}</td>
                </tr>
              ))}
            </tbody>
            {visibles.length > 1 ? (
              <tfoot>
                <tr className="border-t font-medium" style={{ borderColor: "var(--grid)", background: "var(--surface-2)" }}>
                  <td className="px-3 py-1.5" colSpan={conTitulo ? 2 : 1}>
                    Total de lo filtrado
                  </td>
                  <td className="num px-3 py-1.5 text-right">{n(totales.unidades)}</td>
                  <td className="num px-3 py-1.5 text-right">{n(totales.ordenes)}</td>
                  <td className="num px-3 py-1.5 text-right">{totales.unidades ? pesos(totales.importe / totales.unidades) : "—"}</td>
                  <td className="num px-3 py-1.5 text-right">{pesos(totales.importe)}</td>
                  <td className="num px-3 py-1.5 text-right">{pesos(totales.comision)}</td>
                  <td className="num px-3 py-1.5 text-right">{pesos(totales.neto)}</td>
                  <td className="num px-3 py-1.5 text-right" style={{ color: totales.sinCosto ? "var(--estado-serio)" : undefined }}>
                    {totales.sinCosto ? `${pesos(totales.costo)} ?` : pesos(totales.costo)}
                  </td>
                  <td className="num px-3 py-1.5 text-right" style={{ color: totales.sinCosto ? "var(--ink-muted)" : totales.ganancia >= 0 ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                    {pesos(totales.ganancia)}
                  </td>
                  <td className="num px-3 py-1.5 text-right">{pct(totales.neto > 0 && !totales.sinCosto ? totales.ganancia / totales.neto : null)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </section>
  );
}
