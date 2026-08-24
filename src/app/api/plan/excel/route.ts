import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { obtenerPlan } from "@/lib/servicios/cache";
import { separarEnvios } from "@/lib/servicios/envios";
import { aISO } from "@/lib/engine/fechas";
import { etiquetaEstadoTexto } from "@/lib/reporte/etiquetas";
import { coincide, terminosDeBusqueda } from "@/lib/reporte/filtro";
import { desglosarOpcionales, textoDeMas } from "@/lib/reporte/opcionales";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ENCABEZADO = { bold: true, color: { argb: "FFFFFFFF" } } as const;
const FONDO_ENCABEZADO = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF2A78D6" },
} as const;

/** Aplica formato de encabezado y congela la primera fila. */
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

export async function GET(request: NextRequest) {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const terminos = terminosDeBusqueda(q);

  const { plan } = await obtenerPlan(supabase, cuenta.id);
  const { pendientes, catalogo } = plan;
  const p = plan.parametros;
  const r = plan.resumen;

  // Un envío se da de alta por dirección de recolección, así que el Excel que
  // se lleva a la bodega tiene que traer SOLO las cajas de esa bodega. Un
  // archivo con las tres bodegas juntas es exactamente lo que hace que alguien
  // baje cajas que no le tocaban.
  const grupo = (request.nextUrl.searchParams.get("grupo") ?? "").trim();
  const { envios } = await separarEnvios(supabase, cuenta.id, plan.cajas);
  const envio = grupo ? envios.find((e) => e.grupo === grupo) : null;

  if (grupo && !envio) {
    return NextResponse.json({ error: "Ese envío ya no existe en el plan." }, { status: 404 });
  }

  const cajasPlaneadas = envio ? envio.cajas : plan.cajas;

  // Obligatorias vs. opcionales (rescate de tallas) y el sobrante por talla,
  // calculado contra lo sugerido del propio plan.
  const desglose = desglosarOpcionales(
    cajasPlaneadas.map((c) => ({
      codigo: c.codigo,
      cantidad: c.cantidad,
      paresPorCaja: c.paresPorCaja,
      cantidadOpcional: Math.min(c.cantidad, c.cantidadOpcional ?? 0),
      aporta: c.aporta.map((a) => ({ sku: a.sku, talla: a.talla, paresPorCaja: a.paresPorCaja })),
    })),
    plan.lineas.map((l) => ({ sku: l.sku, sugerido: l.sugerido })),
  );
  // Cuando se pide un envío en particular, los SKUs que se listan son los que
  // van EN ESE envío; los demás no se están preparando aquí.
  const skusDelEnvio = envio ? new Set(envio.porSku.map((s) => s.sku)) : null;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Planeador de envíos a Full";
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
    ["Cuenta de Mercado Libre", cuenta.nickname ?? String(cuenta.meli_user_id), ""],
    ["Próximo envío", r.proximoEnvio, `${p.enviosPorSemana} envíos por semana`],
    ...(envio
      ? ([
          ["", "", ""],
          ["— Este archivo es UN envío —", "", ""],
          ["Envío", envio.nombre, `Recolección en ${envio.almacenes.join(" y ")}`],
          ["Cajas de este envío", envio.totalCajas, "Es el número que se captura al darlo de alta"],
          ["Pares de este envío", envio.totalPares, ""],
          ["SKUs de este envío", envio.skus, ""],
          [
            "Ojo",
            "",
            "Las cifras de arriba son del plan completo; las de aquí abajo son solo de este envío.",
          ],
        ] as [string, string | number, string][])
      : []),
    ["", "", ""],
    ["SKUs analizados", r.skusAnalizados, ""],
    ["SKUs críticos", r.skusCriticos, "Se agotan antes de que llegue el envío de hoy"],
    ["SKUs urgentes", r.skusUrgentes, "Caen bajo el punto de reorden antes del siguiente envío"],
    ["SKUs en sobrestock", r.skusSobrestock, `Más de ${p.horizonteDias * p.sobrestockFactor} días de cobertura`],
    ["SKUs con quiebre histórico", r.skusConQuiebreHistorico, "Estuvieron agotados 3 días o más"],
    ["", "", ""],
    ["Pares sugeridos", r.piezasSugeridas, "Lo ideal, antes de cuadrar cajas completas"],
    ["Cajas a mandar (obligatorias)", desglose.cajasObligatorias, "El plan de verdad"],
    ["Pares que viajan (obligatorias)", desglose.paresObligatorios, "Lo que se manda al cerrar cajas"],
    [
      "Cajas OPCIONALES",
      desglose.cajasOpcionales,
      "En rojo en la hoja de cajas: rescatan tallas con faltante chico. Tú decides cuáles subir.",
    ],
    [
      "Pares extra si subes todas las opcionales",
      desglose.paresOpcionales,
      desglose.deMasEnOpcionales > 0
        ? `De esos, ${desglose.deMasEnOpcionales} son de más (tallas ya cubiertas)`
        : "",
    ],
    [
      "Pares de más del plan, por talla",
      desglose.totalDeMas,
      textoDeMas(desglose.deMasPorTalla, 12) || "Nada por encima de lo sugerido",
    ],
    ["Venta perdida estimada", r.ventaPerdidaEstimada, `Pares no vendidos por agotamiento en ${p.diasHistoria} días`],
    ["", "", ""],
    ["Tipos de caja en bodega", catalogo.tiposDeCaja, ""],
    ["Cajas disponibles", catalogo.cajasDisponibles, ""],
    ["Pares en bodega", catalogo.paresEnBodega, ""],
    ["", "", ""],
    ["— Parámetros usados —", "", ""],
    ["Horizonte de cobertura", `${p.horizonteDias} días`, "Cuánta venta quieres tener en Full"],
    ["Lead time", `${p.leadTimeDias} días`, "De que armas el envío a que MELI lo publica"],
    ["Envíos por semana", p.enviosPorSemana, ""],
    ["Nivel de servicio", `${(p.nivelServicio * 100).toFixed(0)}%`, "Dimensiona el stock de seguridad"],
    ["Tope de corrección por agotamiento", `${p.factorCorreccionMax}×`, "Máximo que puede inflar la demanda observada"],
    ["Peso faltante / sobrante", `${p.pesoFaltante} / ${p.pesoSobrante}`, "Quedarse corto vs. pasarse, medido en días de cobertura"],
  ];
  for (const [c, v, nota] of filasResumen) hResumen.addRow({ c, v, n: nota });
  hResumen.getColumn("c").font = { bold: false };

  // ------------------------------------------------------------- CAJAS A MANDAR
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
    { header: "Contenedores", key: "contenedores", width: 22 },
  ];
  encabezar(hCajas);

  const cajasFiltradas = cajasPlaneadas.filter((c) =>
    coincide(`${c.skuCaja} ${c.modelo} ${c.color} ${c.almacen}`, terminos),
  );

  const ROJO = { color: { argb: "FFC00000" } } as const;

  for (const c of cajasFiltradas) {
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
      contenedores: c.contenedores.join(", "),
    });
    // Lo OPCIONAL va en rojo, como se acordó: se ve de lejos qué renglones
    // puede recortar el que arma el envío.
    if (opcionales > 0) fila.font = ROJO;
  }

  // ------------------------------------------------- CONTENIDO CAJA POR TALLA
  // Esta es la hoja que se imprime para armar el envío en la bodega.
  const hPicking = wb.addWorksheet("Picking por talla");
  hPicking.columns = [
    { header: "SKU de caja", key: "skuCaja", width: 30 },
    { header: "Almacén", key: "almacen", width: 14 },
    { header: "Cajas", key: "cajas", width: 8 },
    { header: "SKU Mercado Libre", key: "sku", width: 30 },
    { header: "Talla", key: "talla", width: 8 },
    { header: "Pares por caja", key: "porCaja", width: 13 },
    { header: "Pares totales", key: "pares", width: 13 },
  ];
  encabezar(hPicking);

  for (const c of cajasFiltradas) {
    const opcionales = Math.min(c.cantidad, c.cantidadOpcional ?? 0);
    for (const a of c.aporta) {
      const fila = hPicking.addRow({
        skuCaja: c.skuCaja,
        almacen: c.almacen,
        cajas: c.cantidad,
        sku: a.sku,
        talla: a.talla,
        porCaja: a.paresPorCaja,
        pares: a.paresTotales,
      });
      if (opcionales > 0) fila.font = ROJO;
    }
  }

  // ------------------------------------------------------------ DETALLE POR SKU
  const hSkus = wb.addWorksheet("Detalle por SKU");
  hSkus.columns = [
    { header: "SKU", key: "sku", width: 30 },
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Color", key: "color", width: 18 },
    { header: "Talla", key: "talla", width: 8 },
    { header: "Estado", key: "estado", width: 13 },
    { header: "Venta/día", key: "demanda", width: 11 },
    { header: "Venta/día sin corregir", key: "cruda", width: 18 },
    { header: "Factor corrección", key: "factor", width: 15 },
    { header: "Días agotado (90d)", key: "diasSin", width: 16 },
    { header: "Unidades vendidas (90d)", key: "vendidas", width: 19 },
    { header: "Disponible en Full", key: "disp", width: 16 },
    { header: "En transferencia", key: "transito", width: 15 },
    { header: "Posición total", key: "posicion", width: 13 },
    { header: "Cobertura (días)", key: "cobertura", width: 14 },
    { header: "Fecha de quiebre", key: "quiebre", width: 15 },
    { header: "Stock de seguridad", key: "ss", width: 16 },
    { header: "Punto de reorden", key: "reorden", width: 15 },
    { header: "Nivel objetivo", key: "objetivo", width: 13 },
    { header: "Pares sugeridos", key: "sugerido", width: 14 },
    { header: "Pares que se mandan", key: "enviado", width: 17 },
    { header: "Diferencia", key: "dif", width: 11 },
    { header: "Confianza", key: "confianza", width: 11 },
    { header: "Por qué", key: "explicacion", width: 90 },
  ];
  encabezar(hSkus);

  const lineasFiltradas = plan.lineas.filter(
    (l) =>
      (!skusDelEnvio || skusDelEnvio.has(l.sku)) &&
      coincide(`${l.sku} ${l.modelo} ${l.color}`, terminos),
  );

  for (const l of lineasFiltradas) {
    hSkus.addRow({
      sku: l.sku,
      modelo: l.modelo,
      color: l.color,
      talla: l.talla,
      estado: etiquetaEstadoTexto(l.estado),
      demanda: l.demandaDiaria,
      cruda: l.tasaObservada,
      factor: l.factorCorreccion,
      diasSin: l.diasSinStock,
      vendidas: l.unidadesTotales,
      disp: l.disponible,
      transito: l.enTransferencia,
      posicion: l.posicion,
      cobertura: l.coberturaDias ?? "",
      quiebre: l.fechaQuiebre ?? "",
      ss: l.stockSeguridad,
      reorden: l.puntoReorden,
      objetivo: l.nivelObjetivo,
      sugerido: l.sugerido,
      enviado: l.enviado,
      dif: l.enviado - l.sugerido,
      confianza: l.confianza,
      explicacion: l.explicacion,
    });
  }

  // ------------------------------------------------------------------ PENDIENTES
  const hPend = wb.addWorksheet("Pendientes");
  hPend.columns = [
    { header: "Tipo", key: "tipo", width: 24 },
    { header: "Referencia", key: "ref", width: 34 },
    { header: "Almacén", key: "almacen", width: 14 },
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Color", key: "color", width: 18 },
    { header: "Talla", key: "talla", width: 8 },
    { header: "Cajas", key: "cajas", width: 8 },
    { header: "Pares afectados", key: "pares", width: 15 },
    { header: "Qué hacer", key: "accion", width: 60 },
  ];
  encabezar(hPend);

  for (const s of pendientes.sinCorrida) {
    hPend.addRow({
      tipo: "Sin corrida capturada",
      ref: s.skuCaja,
      almacen: s.almacen,
      modelo: s.modelo,
      color: s.color,
      talla: "Corrida",
      cajas: s.cajasDisponibles,
      pares: s.cajasDisponibles * s.paresPorCaja,
      accion: "Capturar el reparto de tallas de esta corrida en la pantalla de Pendientes.",
    });
  }

  for (const s of pendientes.sinAmarre) {
    hPend.addRow({
      tipo: "SKU sin amarrar a MELI",
      ref: s.skuConstruido,
      almacen: "",
      modelo: s.modelo,
      color: s.color,
      talla: s.talla,
      cajas: s.apariciones,
      pares: s.paresAfectados,
      accion: "Ligar a mano con el SKU real de la publicación, o corregirlo en Mercado Libre.",
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const nombre = `${envio ? `envio-${envio.grupo}` : "plan-envio-full"}-${aISO(new Date())}${
    q ? `-${q.replace(/\s+/g, "_")}` : ""
  }.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
