"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { desgloseIva } from "@/lib/finanzas/calculadora-precios";
import type { CalculadoraCargada, ContenedorFactura } from "@/lib/servicios/calculadora-precios";

const din = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const estiloEntrada = { borderColor: "var(--borde)", background: "var(--surface-2)" };

const FUENTE: Record<string, { texto: string; color: string; ayuda: string }> = {
  real: { texto: "real", color: "var(--exito-texto)", ayuda: "Promedio real de MELI en los meses base" },
  relampago: { texto: "nuevo · relámpago", color: "var(--alerta-texto)", ayuda: "Producto nuevo: depósito al precio relámpago de Números" },
  sin_dato: { texto: "sin dato", color: "var(--ink-3)", ayuda: "Sin ventas en MELI ni precio relámpago en Números" },
};

export function CalculadoraFiscal({
  calc,
  contenedores,
}: {
  calc: CalculadoraCargada;
  contenedores: ContenedorFactura[];
}) {
  const router = useRouter();
  const p = calc.parametros;
  const [meses, setMeses] = useState(String(p.meses));
  const [gasto, setGasto] = useState(String(p.gastoMensualIndusther));
  const [unidades, setUnidades] = useState(p.unidadesMes == null ? "" : String(p.unidadesMes));
  const [ganancia, setGanancia] = useState(String(Math.round(p.gananciaIndusther * 1000) / 10));
  const [margen, setMargen] = useState(String(Math.round(p.margenKomerline * 1000) / 10));
  const [estado, setEstado] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [soloConPrecio, setSoloConPrecio] = useState(true);
  const [contenedor, setContenedor] = useState(contenedores[0]?.numero ?? "");

  async function guardar() {
    setEstado("Guardando…");
    try {
      const r = await fetch("/api/finanzas/calculadora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meses: Number(meses),
          gastoMensualIndusther: Number(gasto.replace(/[$,\s]/g, "")),
          unidadesMes: unidades.trim() === "" ? null : Number(unidades.replace(/[,\s]/g, "")),
          gananciaIndusther: Number(ganancia) / 100,
          margenKomerline: Number(margen) / 100,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      setEstado(null);
      router.refresh();
    } catch (err) {
      setEstado((err as Error).message);
    }
  }

  const visibles = useMemo(() => {
    const q = busca.trim().toUpperCase().replace(/\s/g, "");
    return calc.renglones.filter(
      (r) => (!q || r.modelo.toUpperCase().includes(q) || (r.categoria ?? "").toUpperCase().includes(q)) && (!soloConPrecio || r.precioKomerline != null),
    );
  }, [calc.renglones, busca, soloConPrecio]);

  const campo = (etiqueta: string, valor: string, set: (v: string) => void, opts: { placeholder?: string; ancho?: string } = {}) => (
    <label className="texto-2 flex flex-col gap-1 text-[12px]">
      {etiqueta}
      <input
        className={`${opts.ancho ?? "w-28"} rounded border px-2 py-1 text-right text-[13px]`}
        style={estiloEntrada}
        inputMode="decimal"
        placeholder={opts.placeholder}
        value={valor}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="texto-2 flex flex-col gap-1 text-[12px]">
          Meses base
          <select className="rounded border px-2 py-1 text-[13px]" style={estiloEntrada} value={meses} onChange={(e) => setMeses(e.target.value)}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "mes cerrado" : "meses cerrados"}
              </option>
            ))}
          </select>
        </label>
        {campo("Gasto Industher al mes", gasto, setGasto, { ancho: "w-32" })}
        {campo("Unidades al mes", unidades, setUnidades, { placeholder: calc.unidadesMesUsadas?.toLocaleString("es-MX") ?? "real" })}
        {campo("Ganancia Industher %", ganancia, setGanancia, { ancho: "w-20" })}
        {campo("Margen Komerline %", margen, setMargen, { ancho: "w-20" })}
        <button className="boton-primario boton-chico" onClick={guardar}>
          Calcular
        </button>
        {estado ? <span className="texto-2 text-[12px]">{estado}</span> : null}
      </div>

      <div className="texto-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
        <span>
          Gasto operativo por pieza: <b>{din(calc.gastoOperativoPar)}</b>
          <span className="texto-tenue"> ({calc.unidadesMesUsadas?.toLocaleString("es-MX") ?? "—"} unidades al mes{p.unidadesMes == null ? ", promedio real" : ""})</span>
        </span>
        <span>
          Full por par: <b>{din(calc.fullPar)}</b>
        </span>
        <span>
          Publicidad promedio por par: <b>{din(calc.publicidadPromedioPar)}</b>
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3" style={{ borderColor: "var(--borde)" }}>
        <label className="texto-2 flex flex-col gap-1 text-[12px]">
          Contenedor
          <select className="rounded border px-2 py-1 text-[13px]" style={estiloEntrada} value={contenedor} onChange={(e) => setContenedor(e.target.value)}>
            {contenedores.map((c) => (
              <option key={c.numero} value={c.numero}>
                {c.numero}
                {c.fuente === "costeo" ? " · del Excel de costeo" : c.estado ? ` · ${c.estado.replace("_", " ")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <a
          className="boton-secundario boton-chico"
          aria-disabled={!contenedor}
          href={contenedor ? `/api/finanzas/calculadora/contenedor?numero=${encodeURIComponent(contenedor)}` : undefined}
        >
          Excel para la factura
        </a>
        <span className="texto-tenue text-[12px]">Modelo, código SAT, pares y precio con y sin IVA, para las dos compras.</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input className="rounded-lg border px-2 py-1.5 text-sm" style={estiloEntrada} placeholder="Buscar modelo o categoría" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="texto-2 flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={soloConPrecio} onChange={(e) => setSoloConPrecio(e.target.checked)} />
          Solo con precio
        </label>
        <span className="texto-tenue text-[13px]">{visibles.length} modelos</span>
      </div>

      <div className="tabla-caja alta">
        <table className="datos">
          <thead>
            <tr>
              <th colSpan={3} />
              <th colSpan={5} className="text-center">
                Komerline compra a Industher
              </th>
              <th colSpan={4} className="text-center">
                Industher compra
              </th>
              <th colSpan={2} />
            </tr>
            <tr>
              <th>Modelo</th>
              <th>Fuente</th>
              <th className="num">Pares MELI</th>
              <th className="num">Recibe por par</th>
              <th className="num">− Full</th>
              <th className="num">− Publicidad</th>
              <th className="num">Precio con IVA</th>
              <th className="num">Sin IVA</th>
              <th className="num">− Gasto op.</th>
              <th className="num">− Ganancia</th>
              <th className="num">Precio con IVA</th>
              <th className="num">Sin IVA</th>
              <th className="num">Costo</th>
              <th className="num" title="Precio Industher − costo del par">Al proveedor</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((r) => {
              const f = FUENTE[r.fuente];
              return (
                <tr key={r.modelo}>
                  <td className="font-medium">
                    {r.modelo}
                    <div className="texto-tenue text-[11px]">{r.categoria ?? ""}</div>
                  </td>
                  <td className="text-[12px]" style={{ color: f.color }} title={f.ayuda}>
                    {f.texto}
                    {r.fuente === "relampago" && r.precioRelampago != null ? <div className="texto-tenue text-[11px]">a {din(r.precioRelampago)}</div> : null}
                  </td>
                  <td className="num cifra">{r.unidades.toLocaleString("es-MX")}</td>
                  <td className="num cifra">{din(r.recibidoPar)}</td>
                  <td className="num cifra texto-2">{r.precioKomerline != null ? din(r.fullPar) : "—"}</td>
                  <td className="num cifra texto-2">{r.precioKomerline != null ? din(r.publicidadPar) : "—"}</td>
                  <td className="num cifra font-medium">{din(r.precioKomerline)}</td>
                  <td className="num cifra texto-2">{r.precioKomerline != null ? din(desgloseIva(r.precioKomerline).base) : "—"}</td>
                  <td className="num cifra texto-2">{r.precioIndusther != null ? din(r.gastoOperativoPar) : "—"}</td>
                  <td className="num cifra texto-2">{din(r.gananciaIndustherPar)}</td>
                  <td className="num cifra font-medium">{din(r.precioIndusther)}</td>
                  <td className="num cifra texto-2">{r.precioIndusther != null ? din(desgloseIva(r.precioIndusther).base) : "—"}</td>
                  <td className="num cifra texto-2">{din(r.costo)}</td>
                  <td className="num cifra" style={{ color: r.margenProveedor != null && r.margenProveedor < 0 ? "var(--estado-critico)" : undefined }}>
                    {din(r.margenProveedor)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
