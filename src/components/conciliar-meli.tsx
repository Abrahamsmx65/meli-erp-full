"use client";

import { useRef, useState } from "react";
import { leerReporteVentas, type InformeVentasMeli } from "@/lib/meli/conciliar-ventas";
import { enviarJsonGzip } from "@/lib/cliente/comprimir";

const pesos = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("es-MX", { style: "currency", currency: "MXN" }));
const n = (x: number) => x.toLocaleString("es-MX");

/** Celda de ExcelJS → texto, sin construir objetos con llaves del archivo. */
function textoDeCelda(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return textoDeCelda(o.result);
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    if ("text" in o) return textoDeCelda(o.text);
  }
  return String(v).trim();
}

/** Lee el Excel en el navegador (ExcelJS se carga solo aquí). */
async function filasDeExcel(archivo: File): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await archivo.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("El archivo no tiene hojas legibles.");
  const filas: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      vals[col - 1] = textoDeCelda(cell.value);
    });
    filas.push(vals);
  });
  return filas;
}

/**
 * Sube el Excel de Ventas de Mercado Libre y enseña el cruce contra el ERP
 * venta por venta: ingresos, cargos, envío, anulaciones y el neto.
 */
export function ConciliarMeli() {
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [informe, setInforme] = useState<InformeVentasMeli | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const subir = async (archivo: File) => {
    setError(null);
    setInforme(null);
    try {
      setSubiendo("Leyendo el Excel…");
      const filas = await filasDeExcel(archivo);
      const ventas = leerReporteVentas(filas);
      if (!ventas.length) throw new Error("El archivo no trae ventas.");
      setSubiendo(`Cruzando ${ventas.length.toLocaleString("es-MX")} ventas…`);
      const j = await enviarJsonGzip<InformeVentasMeli>("/api/ventas/conciliar", { ventas });
      setInforme(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ background: "var(--acento)", opacity: subiendo ? 0.6 : 1 }}>
          {subiendo ?? "Subir reporte de Ventas (Excel)"}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            disabled={Boolean(subiendo)}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) subir(f);
            }}
          />
        </label>
        <span className="text-xs" style={{ color: "var(--ink-2)" }}>
          Mercado Libre → Ventas → Descargar reporte → el mes → Excel («Ventas MX»).
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

function Informe({ i }: { i: InformeVentasMeli }) {
  const s = i.sumas;
  const dNeto = Math.round((s.netoReporte - s.netoErp) * 100) / 100;
  const filas: { concepto: string; reporte: number; erp: number }[] = [
    { concepto: "Ingresos por productos (venta bruta)", reporte: s.ingresos, erp: s.total },
    { concepto: "Cargo por venta e impuestos (comisión + ISR + IVA)", reporte: s.cargosReporte, erp: s.cargosErp },
    { concepto: "Envíos (lo que pagó el comprador − lo que cobra MELI)", reporte: s.envioReporte, erp: s.envioErp },
    { concepto: "Anulaciones y reembolsos", reporte: s.anulacionesReporte, erp: s.reembolsadoErp },
    { concepto: "Total (lo que MELI te deja: el neto)", reporte: s.netoReporte, erp: s.netoErp },
  ];
  return (
    <div className="flex flex-col gap-4">
      <section className="tarjeta p-4">
        <h2 className="text-sm font-semibold">
          Reporte del {i.rango.desde} al {i.rango.hasta} · {n(i.ventasReporte)} ventas ({n(i.reporteCompleto.reventa)} en reventa, {n(i.canceladasReporte)} canceladas) · total del reporte {pesos(i.reporteCompleto.total)}
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Cifra titulo="Ventas que cuadran" valor={`${n(i.cuadran)} de ${n(i.comparables)}`} nota="Neto y cargos al centavo, de las comparables" tono={i.cuadran === i.comparables ? "bien" : "alerta"} />
          <Cifra titulo="Distintas" valor={n(i.distintas)} nota="Con pago real leído y aun así diferentes" tono={i.distintas ? "critico" : "bien"} />
          <Cifra titulo="Sin pago real aún" valor={n(i.sinPagoReal)} nota="La recarga todavía no las lee; no se compararon" tono={i.sinPagoReal ? "alerta" : "bien"} />
          <Cifra titulo="Solo en un lado" valor={`${n(i.soloReporte)} / ${n(i.soloErp)}`} nota="Solo en el reporte / solo en el ERP" tono={i.soloReporte - i.canceladasReporte > 0 || i.soloErp ? "alerta" : "bien"} />
        </div>
        {i.avisos.length ? (
          <ul className="mt-3 flex flex-col gap-1 text-sm" style={{ color: "var(--estado-alerta)" }}>
            {i.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Sumas de las ventas comparables ({n(i.comparables)})</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Solo las ventas que el ERP ya tiene con el pago real de Mercado Pago. En reventa el reporte no trae cargos ni envío y el ERP tampoco los descuenta.
          </p>
        </header>
        <table className="datos">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="num">Reporte MELI</th>
              <th className="num">ERP</th>
              <th className="num">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const d = Math.round((f.reporte - f.erp) * 100) / 100;
              return (
                <tr key={f.concepto}>
                  <td>{f.concepto}</td>
                  <td className="num cifra">{pesos(f.reporte)}</td>
                  <td className="num cifra">{pesos(f.erp)}</td>
                  <td className="num cifra" style={{ color: Math.abs(d) > 0.01 ? "var(--estado-critico)" : "var(--exito-texto)" }}>
                    {pesos(d)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t p-3 text-xs hairline" style={{ color: "var(--ink-2)" }}>
          Diferencia en el neto de las comparables: <strong className="cifra">{pesos(dNeto)}</strong>.
        </p>
      </section>

      {i.porEstadoDistintas.length ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Las distintas, por estado del reporte</h2>
          </header>
          <table className="datos">
            <thead>
              <tr>
                <th>Estado</th>
                <th className="num">Ventas</th>
                <th className="num">Diferencia en el neto</th>
              </tr>
            </thead>
            <tbody>
              {i.porEstadoDistintas.map((e) => (
                <tr key={e.estado}>
                  <td>{e.estado}</td>
                  <td className="num cifra">{n(e.ventas)}</td>
                  <td className="num cifra">{pesos(e.diferencia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {i.ejemplos.length ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Ventas que no cuadran (las {n(i.ejemplos.length)} más grandes)</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Ábrelas en Mercado Libre por su número de venta para ver qué pasó. Diferencia = reporte − ERP.
            </p>
          </header>
          <div className="max-h-[36rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Venta</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th>Motivo</th>
                  <th className="num">Ingresos</th>
                  <th className="num">Cargos rep. / ERP</th>
                  <th className="num">Envío rep. / ERP</th>
                  <th className="num">Anulaciones / reembolso</th>
                  <th className="num">Total rep.</th>
                  <th className="num">Neto ERP</th>
                  <th className="num">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {i.ejemplos.map((d) => (
                  <tr key={`${d.motivo}-${d.venta}`}>
                    <td className="cifra">{d.venta}</td>
                    <td className="cifra">{d.fecha ?? "—"}</td>
                    <td>{d.estado}</td>
                    <td>{d.motivo === "solo_reporte" ? "Solo en el reporte" : d.motivo === "solo_erp" ? "Solo en el ERP" : d.motivo === "neto" ? "Neto distinto" : "Cargos distintos"}</td>
                    <td className="num cifra">{pesos(d.reporte?.ingresos ?? d.erp?.total)}</td>
                    <td className="num cifra">{pesos(d.reporte?.cargos)} / {pesos(d.erp?.cargos)}</td>
                    <td className="num cifra">{pesos(d.reporte?.envio)} / {pesos(d.erp?.envio)}</td>
                    <td className="num cifra">{pesos(d.reporte?.anulaciones)} / {pesos(d.erp?.reembolsado)}</td>
                    <td className="num cifra">{pesos(d.reporte?.total)}</td>
                    <td className="num cifra">{pesos(d.erp?.neto)}</td>
                    <td className="num cifra" style={{ color: "var(--estado-critico)" }}>{pesos(d.diferencia)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <p className="text-sm font-medium" style={{ color: "var(--exito-texto)" }}>
          Todas las ventas comparables cuadran al centavo con el ERP.
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
