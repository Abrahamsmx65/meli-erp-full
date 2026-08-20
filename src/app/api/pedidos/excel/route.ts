import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { obtenerPlan } from "@/lib/servicios/cache";
import { cargarInventario } from "@/lib/servicios/inventario";
import { sugerirCompra } from "@/lib/servicios/compras";
import { amazonParaCompras } from "@/lib/servicios/fba";
import { aISO } from "@/lib/engine/fechas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
 * El Excel del pedido a China, por modelo (o completo si no se pide uno).
 *
 * Mismo cálculo que la pantalla: corrida propuesta según el faltante real de
 * cada talla, y cajas unitalla solo cuando el volumen las justifica. Sale
 * listo para mandárselo a la fábrica.
 */
export async function GET(request: NextRequest) {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  }

  const modelo = (request.nextUrl.searchParams.get("modelo") ?? "").trim().toUpperCase();

  const [planEstado, inventario, amazon] = await Promise.all([
    obtenerPlan(supabase, cuenta.id),
    cargarInventario(supabase, cuenta.id),
    amazonParaCompras(supabase),
  ]);

  const inventarioPorSku = new Map(
    inventario.renglones.map((r) => [
      r.sku,
      {
        enFull: r.enFull,
        enTransferencia: r.enTransferencia,
        enBodega: r.enBodega,
        enCamino: r.enCamino,
      },
    ]),
  );

  const compra = await sugerirCompra(
    supabase,
    cuenta.id,
    planEstado.plan.lineas,
    inventarioPorSku,
    undefined,
    inventario.crudos,
    amazon,
  );

  const renglones = compra.renglones.filter(
    (r) => r.cajasSugeridas > 0 && (!modelo || r.modelo === modelo),
  );
  if (!renglones.length) {
    return NextResponse.json(
      { error: modelo ? `No hay nada que pedir del ${modelo}.` : "No hay nada que pedir." },
      { status: 404 },
    );
  }

  const p = compra.parametros;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Planeador de pedidos a China";
  wb.created = new Date();

  // ------------------------------------------------------------------ RESUMEN
  const hResumen = wb.addWorksheet("Resumen");
  hResumen.columns = [
    { header: "Concepto", key: "c", width: 42 },
    { header: "Valor", key: "v", width: 24 },
    { header: "Nota", key: "n", width: 70 },
  ];
  encabezar(hResumen);

  const totalCajas = renglones.reduce((a, r) => a + r.cajasSugeridas, 0);
  const totalPares = renglones.reduce((a, r) => a + r.paresSugeridos, 0);

  const filasResumen: [string, string | number, string][] = [
    ["Generado", new Date().toLocaleString("es-MX"), ""],
    ["Pedido de", modelo || "todos los modelos", ""],
    ["Colores", renglones.length, ""],
    ["Cajas", totalCajas, ""],
    ["Pares", totalPares, ""],
    ["", "", ""],
    ["— Parámetros —", "", ""],
    ["Días de fábrica", p.diasProduccion, ""],
    ["Días de tránsito", p.diasTransito, "Barco + aduana + traslado"],
    ["Cobertura al llegar", `${p.diasCobertura} días`, ""],
    [
      "Regla de unitalla",
      "10 cajas / 100 cajas",
      "Solo si la talla justifica 10+ cajas y el color pide 100+",
    ],
  ];
  for (const [c, v, nota] of filasResumen) hResumen.addRow({ c, v, n: nota });
  hResumen.getColumn("c").font = { bold: false };

  // ------------------------------------------------------------------ PEDIDO
  const hPedido = wb.addWorksheet("Pedido");
  const tallasTodas = [
    ...new Set(
      renglones.flatMap((r) => [
        ...Object.keys(r.corridaPropuesta ?? {}),
        ...r.unitallas.map((u) => u.talla),
      ]),
    ),
  ].sort((a, b) => Number(a) - Number(b));

  hPedido.columns = [
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Color", key: "color", width: 20 },
    { header: "Tipo de caja", key: "tipo", width: 16 },
    ...tallasTodas.map((t) => ({ header: `T${t}`, key: `t${t}`, width: 6 })),
    { header: "Pares/caja", key: "porCaja", width: 11 },
    { header: "Cajas", key: "cajas", width: 8 },
    { header: "Pares", key: "pares", width: 10 },
  ];
  encabezar(hPedido);

  for (const r of renglones) {
    if (r.cajasCorrida > 0 && r.corridaPropuesta) {
      const fila: Record<string, unknown> = {
        modelo: r.modelo,
        color: r.color,
        tipo: "Corrida",
        porCaja: r.paresPorCaja,
        cajas: r.cajasCorrida,
        pares: r.cajasCorrida * (r.paresPorCaja ?? 0),
      };
      for (const t of tallasTodas) fila[`t${t}`] = r.corridaPropuesta[t] ?? "";
      hPedido.addRow(fila);
    }
    for (const u of r.unitallas) {
      const fila: Record<string, unknown> = {
        modelo: r.modelo,
        color: r.color,
        tipo: `Unitalla ${u.talla}`,
        porCaja: r.paresPorCaja,
        cajas: u.cajas,
        pares: u.cajas * (r.paresPorCaja ?? 0),
      };
      fila[`t${u.talla}`] = r.paresPorCaja ?? "";
      hPedido.addRow(fila);
    }
  }

  // ------------------------------------------------------------------ LÓGICA
  const hLogica = wb.addWorksheet("Por qué");
  hLogica.columns = [
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Color", key: "color", width: 20 },
    { header: "Cobertura (días)", key: "cobertura", width: 15 },
    { header: "Faltante (pares)", key: "faltante", width: 15 },
    { header: "Cajas", key: "cajas", width: 8 },
    { header: "Explicación", key: "motivo", width: 90 },
  ];
  encabezar(hLogica);
  for (const r of renglones) {
    hLogica.addRow({
      modelo: r.modelo,
      color: r.color,
      cobertura: r.coberturaDias ?? "",
      faltante: r.faltante,
      cajas: r.cajasSugeridas,
      motivo: r.motivo,
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const nombre = `pedido-china-${modelo ? `${modelo.toLowerCase()}-` : ""}${aISO(new Date())}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
