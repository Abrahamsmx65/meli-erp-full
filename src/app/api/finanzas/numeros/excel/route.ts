import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { listarNumeros } from "@/lib/servicios/numeros";
import { leerCacheAppGuardado } from "@/lib/servicios/cache-app";
import { CLAVE_TARIFAS, type TarifasGuardadas } from "@/lib/servicios/tarifas-reales";
import { calcularNumeros } from "@/lib/finanzas/numeros";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PESOS = '"$"#,##0.00';
const PCT = "0.0%";

/**
 * Todo Números en Excel para revisarlo (dueño, 11-nov-2026: «descargar el
 * Excel de todos los precios, lo que está en Números»): un renglón por
 * modelo con los precios de MELI, Amazon y TikTok, lo que se recibe, la
 * ganancia y las tasas con que se calculó cada canal y de dónde salieron.
 * La MISMA cuenta que la tabla (`calcularNumeros` con las tarifas reales
 * guardadas, sin la lectura en vivo).
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  const db = supabase as DB;
  const tarifas = await leerCacheAppGuardado<TarifasGuardadas>(db, cuenta.id, CLAVE_TARIFAS).catch(() => null);
  const porModelo = tarifas && tarifas.estado === "encontrado" ? tarifas.valor.datos.porModelo : {};
  const { renglones } = await listarNumeros(db, cuenta.id, porModelo);

  const libro = new ExcelJS.Workbook();
  const h = libro.addWorksheet("Números");
  h.columns = [
    { header: "Modelo", key: "modelo", width: 10 },
    { header: "Categoría", key: "categoria", width: 16 },
    { header: "Costo", key: "costo", width: 10 },
    { header: "Costo de", key: "fuenteCosto", width: 14 },
    { header: "MELI relámpago", key: "relampago", width: 12 },
    { header: "MELI recibe por par", key: "recibido", width: 12 },
    { header: "Recibido de", key: "fuenteRecibido", width: 13 },
    { header: "Ganancia MELI", key: "ganancia", width: 12 },
    { header: "% sobre costo", key: "porcentaje", width: 10 },
    { header: "MELI PV normal", key: "pvNormal", width: 12 },
    { header: "Ganancia PV normal", key: "gananciaNormal", width: 12 },
    { header: "MELI comisión", key: "comMeli", width: 10 },
    { header: "MELI envío", key: "envioMeli", width: 10 },
    { header: "Envío de", key: "envioFuente", width: 10 },
    { header: "MELI retención", key: "retMeli", width: 10 },
    { header: "MELI tasas de", key: "fuenteMeli", width: 11 },
    { header: "Relámpago real 30 d", key: "relampagoReal", width: 12 },
    { header: "Amazon recibir", key: "recibirAmazon", width: 12 },
    { header: "Amazon PVP", key: "pvpAmazon", width: 12 },
    { header: "Amazon PVP deal", key: "pvpDeal", width: 12 },
    { header: "Amazon % (com. + ret.)", key: "pctAmazon", width: 12 },
    { header: "Amazon por par", key: "porParAmazon", width: 11 },
    { header: "Amazon tasas de", key: "fuenteAmazon", width: 12 },
    { header: "TikTok gana igual", key: "tiktokLives", width: 12 },
    { header: "TikTok relámpagos", key: "tiktokRelampago", width: 12 },
    { header: "TikTok oferta campañas", key: "tiktokOferta", width: 12 },
    { header: "TikTok % se queda", key: "pctTiktok", width: 11 },
    { header: "TikTok tasas de", key: "fuenteTiktok", width: 12 },
  ];
  const nombres: Record<string, string> = {
    real: "real 30 d",
    vivo: "en vivo",
    desde_ventas: "ventas cercanas",
    tasas: "tasas",
    estimado: "estimado",
    general: "real cuenta",
    tramo: "real tramo",
    ventas: "real ventas",
    tuyo: "capturado",
    contenedor: "último contenedor",
    catalogo: "catálogo",
  };
  const nombre = (x: string | null | undefined) => (x ? nombres[x] ?? x : null);
  for (const r of renglones) {
    const c = calcularNumeros(r.entrada, r.costo, r.reales);
    const u = c.usado;
    h.addRow({
      modelo: r.entrada.modelo,
      categoria: r.categoria,
      costo: r.costo,
      fuenteCosto: r.fuenteCosto ? `${nombre(r.fuenteCosto)}${r.contenedor ? ` ${r.contenedor}` : ""}` : null,
      relampago: r.entrada.precioRelampago,
      recibido: c.recibidoMeli?.porPar ?? null,
      fuenteRecibido: nombre(c.recibidoMeli?.fuente),
      ganancia: c.ganancia,
      porcentaje: c.porcentaje,
      pvNormal: c.pvNormal,
      gananciaNormal: c.gananciaNormal,
      comMeli: u.meli.comisionPct,
      envioMeli: u.meli.envio,
      envioFuente: nombre(u.meli.envioFuente),
      retMeli: u.meli.retencionPct,
      fuenteMeli: nombre(u.meli.fuente),
      relampagoReal: c.relampagoMeli?.precio ?? null,
      recibirAmazon: c.recibirAmazon,
      pvpAmazon: c.pvpAmazon,
      pvpDeal: c.pvpDeal,
      pctAmazon: u.amazon.pctTotal,
      porParAmazon: u.amazon.porPar,
      fuenteAmazon: nombre(u.amazon.fuente),
      tiktokLives: c.tiktokLives,
      tiktokRelampago: c.tiktokRelampago,
      tiktokOferta: c.tiktokOferta,
      pctTiktok: u.tiktok.pctTotal,
      fuenteTiktok: nombre(u.tiktok.fuente),
    });
  }
  for (const k of [
    "costo", "relampago", "recibido", "ganancia", "pvNormal", "gananciaNormal", "envioMeli", "relampagoReal",
    "recibirAmazon", "pvpAmazon", "pvpDeal", "porParAmazon", "tiktokLives", "tiktokRelampago", "tiktokOferta",
  ])
    h.getColumn(k).numFmt = PESOS;
  for (const k of ["porcentaje", "comMeli", "retMeli", "pctAmazon", "pctTiktok"]) h.getColumn(k).numFmt = PCT;
  const titulo = h.getRow(1);
  titulo.font = { bold: true, color: { argb: "FFFFFFFF" } };
  titulo.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B4636" } };
  titulo.alignment = { wrapText: true, vertical: "middle" };
  titulo.height = 32;
  h.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
  h.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: h.columns.length } };

  const buf = await libro.xlsx.writeBuffer();
  const dia = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="numeros-${dia}.xlsx"`,
    },
  });
}
