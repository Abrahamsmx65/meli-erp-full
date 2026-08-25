import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { indexarCatalogo } from "@/lib/etiquetas/resolver";
import { cargarAmazon, cuentaAmazon, normalizarDias, SIN_LIMITE } from "@/lib/servicios/amazon";
import { aplicarEnCamino, enCaminoFba } from "@/lib/servicios/fba-en-camino";
import {
  OBJETIVO_DIAS_FBA,
  URGENTE_DIAS_FBA,
  mapaCorridas,
  sugerirEnvioFba,
} from "@/lib/servicios/fba";
import { planFbaConCajas } from "@/lib/servicios/fba-plan";
import { catalogoBodega } from "@/lib/servicios/inventario";
import { desglosarOpcionales, textoDeMas } from "@/lib/reporte/opcionales";
import { normalizarParametros } from "@/lib/engine/params";
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
  const [{ renglones: renglonesCrudos }, corridasRaw, skusMeli, bodega, paramsBd, enCamino] = await Promise.all([
    cargarAmazon(supabase, dias, "", SIN_LIMITE),
    cuentaMeli
      ? traerTodo<any>(supabase, "corridas", "modelo, color, tallas, total, pedido", (q) =>
          q.eq("account_id", cuentaMeli.id),
        )
      : Promise.resolve([]),
    cuentaMeli
      ? traerTodo<any>(supabase, "skus", "sku, modelo, color, talla", (q) =>
          // Solo activos: un SKU renombrado (apagado) no debe ganar el amarre.
          q.eq("account_id", cuentaMeli.id).eq("activo", true),
        )
      : Promise.resolve([]),
    cuentaMeli ? catalogoBodega(supabase, cuentaMeli.id) : Promise.resolve(null),
    cuentaMeli
      ? supabase.from("parametros").select("datos").eq("account_id", cuentaMeli.id).maybeSingle()
      : Promise.resolve({ data: null }),
    enCaminoFba(supabase, cuenta.id),
  ]);
  // El mismo "en camino" real que la pantalla: los envíos atorados no cuentan.
  const renglones = aplicarEnCamino(renglonesCrudos, enCamino);
  const indiceMeli = indexarCatalogo(skusMeli);
  const sugerencias = sugerirEnvioFba(renglones, dias, mapaCorridas(corridasRaw), undefined, indiceMeli);
  const urgentes = sugerencias.filter((s) => (s.cobertura ?? 0) < URGENTE_DIAS_FBA).length;

  // Las cajas REALES de bodega, con el mismo motor que los envíos a Full.
  const planFba = planFbaConCajas({
    renglones,
    dias,
    catalogo: bodega?.catalogo.cajas ?? [],
    indiceMeli,
    parametros: normalizarParametros((paramsBd?.data?.datos as Record<string, unknown>) ?? {}),
  });
  const desglose = desglosarOpcionales(
    planFba.cajas.map((c) => ({
      codigo: c.codigo,
      cantidad: c.cantidad,
      paresPorCaja: c.paresPorCaja,
      cantidadOpcional: c.cantidadOpcional,
      aporta: c.aporta.map((a) => ({ sku: a.sku, talla: a.talla, paresPorCaja: a.paresPorCaja })),
    })),
    planFba.lineas,
  );

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
    ["Pares sugeridos", planFba.paresSugeridos, "El faltante exacto por talla"],
    ["Cajas a mandar (obligatorias)", desglose.cajasObligatorias, "Cajas reales de bodega, del mismo motor que Full"],
    ["Pares que viajan (obligatorias)", desglose.paresObligatorios, ""],
    [
      "Cajas OPCIONALES",
      desglose.cajasOpcionales,
      "En rojo en la hoja de cajas: rescatan tallas con faltante chico. Tú decides cuáles subir.",
    ],
    ["Pares extra si subes todas las opcionales", desglose.paresOpcionales, ""],
    [
      "Pares de más del plan, por talla",
      desglose.totalDeMas,
      textoDeMas(desglose.deMasPorTalla, 12) || "Nada por encima de lo sugerido",
    ],
    [
      "Faltante sin caja en bodega",
      planFba.sinCajaEnBodega.reduce((a, f) => a + f.pares, 0),
      "Pares que faltan y ninguna caja disponible trae",
    ],
    [
      "SKUs de Amazon sin amarre a MELI",
      planFba.sinAmarre.length,
      planFba.sinAmarre.slice(0, 6).map((s) => s.sku).join(", "),
    ],
    [
      "Urgentes",
      urgentes,
      `Con menos de ${URGENTE_DIAS_FBA} días de stock al ritmo actual`,
    ],
    [
      "Envíos entrantes ignorados por viejos",
      enCamino ? enCamino.viejos.length : "sin detalle aún",
      enCamino
        ? `${enCamino.paresViejos} pares "en el aire" que ya no cuentan como en camino`
        : "El detalle de envíos entrantes aún no se sincroniza; se usó el reporte",
    ],
  ];
  for (const [c, v, nota] of filasResumen) hResumen.addRow({ c, v, n: nota });
  hResumen.getColumn("c").font = { bold: false };

  // ------------------------------------------------------------ CAJAS A MANDAR
  const hCajas = wb.addWorksheet("Cajas a mandar");
  hCajas.columns = [
    { header: "SKU de caja", key: "skuCaja", width: 30 },
    { header: "Almacén", key: "almacen", width: 14 },
    { header: "Pedido", key: "pedido", width: 12 },
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Color", key: "color", width: 18 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Cajas a mandar", key: "cantidad", width: 14 },
    { header: "De esas, opcionales", key: "opcionales", width: 16 },
    { header: "Sobra por talla (si la subes)", key: "deMas", width: 34 },
    { header: "Cajas disponibles", key: "disp", width: 16 },
    { header: "Pares por caja", key: "porCaja", width: 13 },
    { header: "Pares totales", key: "pares", width: 13 },
    { header: "Contenido por talla", key: "contenido", width: 40 },
  ];
  encabezar(hCajas);

  const ROJO = { color: { argb: "FFC00000" } } as const;
  for (const c of planFba.cajas) {
    const opcionales = Math.min(c.cantidad, c.cantidadOpcional ?? 0);
    const fila = hCajas.addRow({
      skuCaja: c.skuCaja,
      almacen: c.almacen,
      pedido: c.pedido,
      modelo: c.modelo,
      color: c.color,
      tipo: c.esCorrida ? "Corrida" : `Talla ${c.talla}`,
      cantidad: c.cantidad,
      opcionales: opcionales || "",
      deMas: opcionales ? textoDeMas(desglose.deMasPorCaja.get(c.codigo) ?? [], 12) : "",
      disp: c.cajasDisponibles,
      porCaja: c.paresPorCaja,
      pares: c.paresTotales,
      contenido: c.aporta.map((a) => `${a.talla}:${a.paresTotales}`).join("  "),
    });
    // Lo OPCIONAL en rojo, igual que en el Excel de envíos a Full.
    if (opcionales > 0) fila.font = ROJO;
  }

  // ------------------------------------------------------------ ENVÍO A FBA
  const hEnvio = wb.addWorksheet("Cobertura por producto");
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
