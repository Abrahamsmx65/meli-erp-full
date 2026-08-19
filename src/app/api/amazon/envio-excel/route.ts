import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { cargarAmazon, cuentaAmazon, normalizarDias } from "@/lib/servicios/amazon";
import {
  OBJETIVO_DIAS_FBA,
  URGENTE_DIAS_FBA,
  mapaCorridas,
  sugerirEnvioFba,
} from "@/lib/servicios/fba";
import { aISO } from "@/lib/engine/fechas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ENCABEZADO = { bold: true, color: { argb: "FFFFFFFF" } } as const;
const FONDO_ENCABEZADO = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF2A78D6" },
} as const;

function encabezar(hoja: ExcelJS.Worksheet): void {
  const fila = hoja.getRow(1);
  fila.font = ENCABEZADO;
  fila.fill = FONDO_ENCABEZADO as ExcelJS.Fill;
  fila.alignment = { vertical: "middle", wrapText: true };
  fila.height = 24;
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  hoja.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: hoja.columnCount },
  };
}

/**
 * El Excel del envío a FBA, hermano del de Full: una hoja de resumen y la
 * lista de qué mandar, con el mismo cálculo que la pantalla (servicios/fba).
 */
export async function GET(request: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta de Amazon conectada." }, { status: 400 });
  }

  const dias = normalizarDias(request.nextUrl.searchParams.get("dias") ?? undefined);
  const cuentaMeli = await cuentaActiva(supabase);
  const [{ renglones }, corridasRaw] = await Promise.all([
    cargarAmazon(supabase, dias, ""),
    cuentaMeli
      ? traerTodo<any>(supabase, "corridas", "modelo, color, tallas, total, pedido", (q) =>
          q.eq("account_id", cuentaMeli.id),
        )
      : Promise.resolve([]),
  ]);
  const sugerencias = sugerirEnvioFba(renglones, dias, mapaCorridas(corridasRaw));
  const totalCajas = sugerencias.reduce((a, s) => a + s.cajas, 0);
  const totalPares = sugerencias.reduce((a, s) => a + s.pares, 0);
  const urgentes = sugerencias.filter((s) => (s.cobertura ?? 0) < URGENTE_DIAS_FBA).length;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Planeador de envíos a FBA";
  wb.created = new Date();

  // ------------------------------------------------------------------ RESUMEN
  const hResumen = wb.addWorksheet("Resumen");
  hResumen.columns = [
    { header: "Concepto", key: "c", width: 42 },
    { header: "Valor", key: "v", width: 22 },
    { header: "Nota", key: "n", width: 70 },
  ];
  encabezar(hResumen);

  const filasResumen: [string, string | number, string][] = [
    ["Generado", new Date().toLocaleString("es-MX"), ""],
    ["Cuenta de Amazon", cuenta.nombre ?? "", ""],
    ["Periodo de venta analizado", `${dias} días`, "El ritmo de venta sale de este periodo"],
    ["Cobertura objetivo", `${OBJETIVO_DIAS_FBA} días`, "Cuánta venta quieres tener en FBA"],
    ["", "", ""],
    ["Productos por reponer", sugerencias.length, "Solo calzado (GT, MY, YH, G650)"],
    ["Cajas", totalCajas, "Cajas completas: no se abren"],
    ["Pares", totalPares, ""],
    [
      "Urgentes",
      urgentes,
      `Con menos de ${URGENTE_DIAS_FBA} días de stock al ritmo actual`,
    ],
  ];
  for (const [c, v, nota] of filasResumen) hResumen.addRow({ c, v, n: nota });
  hResumen.getColumn("c").font = { bold: false };

  // ------------------------------------------------------------ ENVÍO A FBA
  const hEnvio = wb.addWorksheet("Envío a FBA");
  hEnvio.columns = [
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Color", key: "color", width: 18 },
    { header: "Producto", key: "titulo", width: 60 },
    { header: "Tallas", key: "tallas", width: 8 },
    { header: "Venta/día", key: "ventaDiaria", width: 11 },
    { header: "En FBA", key: "disponible", width: 10 },
    { header: "En camino", key: "enTransferencia", width: 11 },
    { header: "Cobertura (días)", key: "cobertura", width: 14 },
    { header: "Pares/caja", key: "porCaja", width: 11 },
    { header: "Cajas a mandar", key: "cajas", width: 14 },
    { header: "Pares", key: "pares", width: 10 },
  ];
  encabezar(hEnvio);

  for (const s of sugerencias) {
    hEnvio.addRow({
      modelo: s.modelo,
      color: s.color,
      titulo: s.titulo ?? "",
      tallas: s.tallas,
      ventaDiaria: Number(s.ventaDiaria.toFixed(2)),
      disponible: s.disponible,
      enTransferencia: s.enTransferencia,
      cobertura: s.cobertura === null ? "" : Math.round(s.cobertura),
      porCaja: s.paresPorCaja ?? "sin corrida",
      cajas: s.tieneCorrida ? s.cajas : "?",
      pares: s.pares,
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const nombre = `envio-fba-${aISO(new Date())}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
