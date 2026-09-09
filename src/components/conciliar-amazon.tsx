"use client";

import { useRef, useState } from "react";
import { leerReporteTransacciones, type InformeConciliacion } from "@/lib/amazon/conciliar";
import { enviarJsonGzip } from "@/lib/cliente/comprimir";

const pesos = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("es-MX", { style: "currency", currency: "MXN" }));
const n = (x: number) => x.toLocaleString("es-MX");
const fecha = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/**
 * Sube el CSV del reporte de transacciones de Seller Central y enseña el
 * cruce contra los eventos de la Finances API: totales, tipo por tipo y
 * orden por orden. Lo que no cuadra sale con su monto.
 */
export function ConciliarAmazon() {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [informe, setInforme] = useState<InformeConciliacion | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const subir = async (archivo: File) => {
    setSubiendo(true);
    setError(null);
    setInforme(null);
    try {
      // El CSV del mes pesa más de lo que una función de Vercel acepta:
      // se lee aquí y se manda solo lo compacto, comprimido.
      const renglones = leerReporteTransacciones(await archivo.text());
      if (!renglones.length) throw new Error("El archivo no trae renglones del reporte de transacciones.");
      const j = await enviarJsonGzip<InformeConciliacion>("/api/amazon/conciliar", { renglones });
      setInforme(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ background: "var(--acento)", opacity: subiendo ? 0.6 : 1 }}>
          {subiendo ? "Cruzando…" : "Subir reporte de transacciones (CSV)"}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            disabled={subiendo}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) subir(f);
            }}
          />
        </label>
        <span className="text-xs" style={{ color: "var(--ink-2)" }}>
          Seller Central → Pagos → Reportes → Transacciones → un mes → Descargar CSV.
        </span>
        {error ? (
          <span className="text-sm" style={{ color: "var(--estado-critico)" }}>
            {error}
          </span>
        ) : null}
      </div>

      {informe ? <Informe i={informe} /> : null}
    </div>
  );
}

function Informe({ i }: { i: InformeConciliacion }) {
  const totalOk = Math.abs(i.totales.diferencia) <= 0.005;
  return (
    <div className="flex flex-col gap-4">
      <section className="tarjeta p-4">
        <h2 className="text-sm font-semibold">
          Rango del reporte: {fecha(i.rango.desde)} → {fecha(i.rango.hasta)} · {n(i.renglones)} renglones
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Cifra titulo="Total del reporte" valor={pesos(i.totales.reporte)} nota="Lanzado, sin transferencias" />
          <Cifra titulo="Total en el ERP" valor={pesos(i.totales.erp)} nota="Eventos del mismo rango" />
          <Cifra titulo="Diferencia" valor={pesos(i.totales.diferencia)} nota={totalOk ? "Cuadra al centavo" : "Reporte − ERP"} tono={totalOk ? "bien" : "critico"} />
          <Cifra titulo="Órdenes que cuadran" valor={`${n(i.ordenes.cuadran)} de ${n(i.ordenes.enReporte)}`} nota={`${n(i.ordenes.distintas)} distintas · ${n(i.ordenes.soloReporte)} solo en reporte · ${n(i.ordenes.soloErp)} solo en ERP`} tono={i.ordenes.cuadran === i.ordenes.enReporte && !i.ordenes.soloErp ? "bien" : "alerta"} />
        </div>
        {i.avisos.length ? (
          <ul className="mt-3 flex flex-col gap-1 text-sm" style={{ color: "var(--estado-alerta)" }}>
            {i.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}
        {i.transferencias.length ? (
          <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>
            Transferencias en el reporte (depósitos de liquidaciones anteriores, no cuentan): {i.transferencias.map((t) => `${t.liquidacion} ${pesos(t.monto)}`).join(" · ")}
          </p>
        ) : null}
      </section>

      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Tipo por tipo</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Cómo llama Seller Central a cada cosa y qué tiene el ERP con ese nombre.
          </p>
        </header>
        <table className="datos">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="num">Renglones</th>
              <th className="num">Reporte</th>
              <th className="num">Eventos</th>
              <th className="num">ERP</th>
              <th className="num">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {i.equivalencias.map((e) => (
              <tr key={e.nombre}>
                <td>{e.nombre}</td>
                <td className="num cifra">{n(e.renglones)}</td>
                <td className="num cifra">{pesos(e.reporte)}</td>
                <td className="num cifra">{n(e.eventos)}</td>
                <td className="num cifra">{pesos(e.erp)}</td>
                <td className="num cifra" style={{ color: Math.abs(e.diferencia) > 0.005 ? "var(--estado-critico)" : "var(--exito-texto)" }}>
                  {pesos(e.diferencia)}
                </td>
              </tr>
            ))}
            {i.tiposSinEquivalente.map((t) => (
              <tr key={`t-${t.tipo}`}>
                <td>Reporte · {t.tipo} (sin equivalente en el ERP)</td>
                <td className="num cifra">{n(t.renglones)}</td>
                <td className="num cifra">{pesos(t.total)}</td>
                <td className="num cifra">—</td>
                <td className="num cifra">—</td>
                <td className="num cifra" style={{ color: "var(--estado-critico)" }}>{pesos(t.total)}</td>
              </tr>
            ))}
            {i.listasSinEquivalente.map((l) => (
              <tr key={`l-${l.lista}`}>
                <td>ERP · {l.lista} (sin equivalente en el reporte)</td>
                <td className="num cifra">—</td>
                <td className="num cifra">—</td>
                <td className="num cifra">{n(l.eventos)}</td>
                <td className="num cifra">{pesos(l.total)}</td>
                <td className="num cifra" style={{ color: "var(--estado-critico)" }}>{pesos(-l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Liquidaciones del rango en el ERP</h2>
        </header>
        <table className="datos">
          <thead>
            <tr>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Estado</th>
              <th className="num">Total Amazon</th>
              <th className="num">Suma de eventos</th>
              <th>Lectura</th>
            </tr>
          </thead>
          <tbody>
            {i.liquidaciones.map((g) => (
              <tr key={g.grupo}>
                <td className="cifra">{fecha(g.inicio)}</td>
                <td className="cifra">{fecha(g.fin)}</td>
                <td>{g.estado === "Closed" ? "Cerrada" : "En curso"}</td>
                <td className="num cifra">{pesos(g.total)}</td>
                <td className="num cifra">{pesos(g.suma)}</td>
                <td style={{ color: g.cuadra === false ? "var(--estado-critico)" : g.completo ? "var(--exito-texto)" : "var(--estado-alerta)" }}>
                  {g.cuadra === true ? "Completa y cuadra" : g.cuadra === false ? "Completa, NO cuadra" : g.completo ? "Completa (sin total aún)" : "A medio leer"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {i.ordenes.ejemplos.length ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Órdenes que no cuadran (las {n(i.ordenes.ejemplos.length)} más grandes)</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Suma de los renglones de la orden en el reporte contra la suma de sus eventos en el ERP, dentro del rango. Ábrela en Seller Central para ver qué pasó.
            </p>
          </header>
          <div className="max-h-[32rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th className="num">Reporte</th>
                  <th className="num">ERP</th>
                  <th className="num">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {i.ordenes.ejemplos.map((o) => (
                  <tr key={o.orden}>
                    <td className="cifra">{o.orden}</td>
                    <td className="num cifra">{pesos(o.reporte)}</td>
                    <td className="num cifra">{pesos(o.erp)}</td>
                    <td className="num cifra" style={{ color: "var(--estado-critico)" }}>{pesos(o.diferencia)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <p className="text-sm font-medium" style={{ color: "var(--exito-texto)" }}>
          Todas las órdenes del reporte cuadran al centavo con el ERP.
        </p>
      )}
    </div>
  );
}

function Cifra({ titulo, valor, nota, tono }: { titulo: string; valor: string; nota?: string; tono?: "bien" | "alerta" | "critico" }) {
  const color = tono === "bien" ? "var(--exito-texto)" : tono === "alerta" ? "var(--estado-alerta)" : tono === "critico" ? "var(--estado-critico)" : "var(--ink-1)";
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: "var(--borde)" }}>
      <div className="text-xs" style={{ color: "var(--ink-2)" }}>
        {titulo}
      </div>
      <div className="cifra text-lg font-semibold" style={{ color }}>
        {valor}
      </div>
      {nota ? (
        <div className="text-xs" style={{ color: "var(--ink-2)" }}>
          {nota}
        </div>
      ) : null}
    </div>
  );
}
