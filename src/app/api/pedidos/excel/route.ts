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
 * cada talla, y cajas unitalla cuando la talla justifica 5+ cajas. Sale
 * listo para mandárselo a la fábrica.
 */
export async function GET(request: NextRequest) {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  }

  const modelo = (request.nextUrl.searchParams.get("modelo") ?? "").trim().toUpperCase();

  let planEstado;
  let inventario;
  let amazonEstado;
  try {
    [planEstado, inventario, amazonEstado] = await Promise.all([
      obtenerPlan(supabase, cuenta.id),
      cargarInventario(supabase, cuenta.id),
      amazonParaCompras(supabase),
    ]);
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudo generar el Excel porque faltan datos de Amazon: ${(err as Error).message}` },
      { status: 503 },
    );
  }
  if (amazonEstado.advertencias.length) {
    return NextResponse.json(
      {
        error:
          "No se generó el Excel porque los datos de Amazon están incompletos. Intenta de nuevo cuando se recupere la lectura.",
        detalles: amazonEstado.advertencias,
      },
      { status: 503 },
    );
  }

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
    amazonEstado.datos,
  );

  // Opción 1 (descontando stock) y opción 2 (solo venta) traen listas
  // distintas: un color con inventario suficiente puede no pedir nada en la
  // opción 1 y sí en la 2.
  const delModelo = compra.renglones.filter((r) => !modelo || r.modelo === modelo);
  const renglones = delModelo.filter((r) => r.cajasSugeridas > 0);
  const renglonesSoloVenta = delModelo.filter((r) => r.soloVenta.cajas > 0);
  if (!renglones.length && !renglonesSoloVenta.length) {
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
  const totalCajasSV = renglonesSoloVenta.reduce((a, r) => a + r.soloVenta.cajas, 0);
  const totalParesSV = renglonesSoloVenta.reduce((a, r) => a + r.soloVenta.pares, 0);

  const filasResumen: [string, string | number, string][] = [
    ["Generado", new Date().toLocaleString("es-MX"), ""],
    ["Pedido de", modelo || "todos los modelos", ""],
    ["", "", ""],
    ["— Opción 1: descontando stock —", "", "Hoja \"Pedido 1 con stock\""],
    ["Colores", renglones.length, ""],
    ["Cajas", totalCajas, "La corrida se cuadra para completar las piezas que faltan"],
    ["Pares", totalPares, ""],
    ["", "", ""],
    ["— Opción 2: solo según la venta —", "", "Hoja \"Pedido 2 solo venta\""],
    ["Colores", renglonesSoloVenta.length, ""],
    [
      "Cajas",
      totalCajasSV,
      "Sin descontar ningún inventario; una talla agotada cuenta lo que habría vendido",
    ],
    ["Pares", totalParesSV, ""],
    ["", "", ""],
    ["— Parámetros —", "", ""],
    ["Días de fábrica", p.diasProduccion, ""],
    ["Días de tránsito", p.diasTransito, "Barco + aduana + traslado"],
    ["Cobertura al llegar", `${p.diasCobertura} días`, ""],
    [
      "Regla de unitalla",
      "5 cajas",
      "Una talla se separa en cajas completas si sola justifica 5+ cajas",
    ],
  ];
  for (const [c, v, nota] of filasResumen) hResumen.addRow({ c, v, n: nota });
  hResumen.getColumn("c").font = { bold: false };

  // --------------------------------------------------- LAS DOS HOJAS DE PEDIDO
  // Mismo formato para las dos opciones; solo cambia de dónde salen las
  // cajas: la 1 descuenta el stock (la corrida se cuadra para completar lo
  // que falta), la 2 va solo con la venta del horizonte, sin descontar nada
  // — y una talla agotada cuenta lo que habría vendido, no cero.
  interface PedidoDeHoja {
    cajasCorrida: number;
    corridaPropuesta: Record<string, number> | null;
    unitallas: { talla: string; cajas: number }[];
  }
  const hojaPedido = (
    nombre: string,
    lista: typeof renglones,
    pedidoDe: (r: (typeof renglones)[number]) => PedidoDeHoja,
  ) => {
    const hoja = wb.addWorksheet(nombre);
    const tallasTodas = [
      ...new Set(
        lista.flatMap((r) => {
          const ped = pedidoDe(r);
          return [
            ...Object.keys(ped.corridaPropuesta ?? {}),
            ...ped.unitallas.map((u) => u.talla),
          ];
        }),
      ),
    ].sort((a, b) => Number(a) - Number(b));

    hoja.columns = [
      { header: "Modelo", key: "modelo", width: 12 },
      { header: "Color", key: "color", width: 20 },
      { header: "Tipo de caja", key: "tipo", width: 16 },
      ...tallasTodas.map((t) => ({ header: `T${t}`, key: `t${t}`, width: 6 })),
      { header: "Pares/caja", key: "porCaja", width: 11 },
      { header: "Cajas", key: "cajas", width: 8 },
      { header: "Pares", key: "pares", width: 10 },
    ];
    encabezar(hoja);

    for (const r of lista) {
      const ped = pedidoDe(r);
      if (ped.cajasCorrida > 0 && ped.corridaPropuesta) {
        const fila: Record<string, unknown> = {
          modelo: r.modelo,
          color: r.color,
          tipo: "Corrida",
          porCaja: r.paresPorCaja,
          cajas: ped.cajasCorrida,
          pares: ped.cajasCorrida * (r.paresPorCaja ?? 0),
        };
        for (const t of tallasTodas) fila[`t${t}`] = ped.corridaPropuesta[t] ?? "";
        hoja.addRow(fila);
      }
      for (const u of ped.unitallas) {
        const fila: Record<string, unknown> = {
          modelo: r.modelo,
          color: r.color,
          tipo: `Unitalla ${u.talla}`,
          porCaja: r.paresPorCaja,
          cajas: u.cajas,
          pares: u.cajas * (r.paresPorCaja ?? 0),
        };
        fila[`t${u.talla}`] = r.paresPorCaja ?? "";
        hoja.addRow(fila);
      }
    }
  };

  hojaPedido("Pedido 1 con stock", renglones, (r) => ({
    cajasCorrida: r.cajasCorrida,
    corridaPropuesta: r.corridaPropuesta,
    unitallas: r.unitallas,
  }));
  hojaPedido("Pedido 2 solo venta", renglonesSoloVenta, (r) => ({
    cajasCorrida: r.soloVenta.cajasCorrida,
    corridaPropuesta: r.soloVenta.corridaPropuesta,
    unitallas: r.soloVenta.unitallas,
  }));

  // ------------------------------------------------------------------ LÓGICA
  const hLogica = wb.addWorksheet("Por qué");
  hLogica.columns = [
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Color", key: "color", width: 20 },
    { header: "Cobertura (días)", key: "cobertura", width: 15 },
    { header: "Faltante (pares)", key: "faltante", width: 15 },
    { header: "Cajas opción 1 (con stock)", key: "cajas", width: 20 },
    { header: "Cajas opción 2 (solo venta)", key: "cajasSV", width: 20 },
    { header: "Explicación", key: "motivo", width: 90 },
  ];
  encabezar(hLogica);
  for (const r of delModelo.filter((x) => x.cajasSugeridas > 0 || x.soloVenta.cajas > 0)) {
    hLogica.addRow({
      modelo: r.modelo,
      color: r.color,
      cobertura: r.coberturaDias ?? "",
      faltante: r.faltante,
      cajas: r.cajasSugeridas,
      cajasSV: r.soloVenta.cajas,
      motivo:
        r.cajasSugeridas > 0
          ? r.motivo
          : `Con stock no hace falta pedir (${r.motivo}) — la opción 2 lo pide igual porque va solo con la venta.`,
    });
  }

  // ------------------------------------------------------------- DETALLE SKU
  // Un renglón por SKU con todos los números que alimentan el pedido: venta
  // de cada canal, stock en cada lado, lo que viene de China y el faltante.
  // Es la hoja para auditar por qué se sugiere pedir lo que se pide.
  const hDetalle = wb.addWorksheet("Detalle SKU");
  hDetalle.columns = [
    { header: "SKU", key: "sku", width: 28 },
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Color", key: "color", width: 18 },
    { header: "Talla", key: "talla", width: 7 },
    { header: "Venta MELI/mes (usada)", key: "vMeli", width: 19 },
    { header: "Vendido MELI 30 días (real)", key: "vReal", width: 21 },
    { header: "Venta AMZ/mes (usada)", key: "vAmz", width: 18 },
    { header: "Vendido AMZ 30 días (real)", key: "vAmzReal", width: 20 },
    { header: "Stock Full (+camino)", key: "full", width: 17 },
    { header: "Stock FBA (+camino)", key: "fba", width: 17 },
    { header: "Bodega", key: "bodega", width: 10 },
    { header: "De China", key: "china", width: 10 },
    { header: "Inventario total", key: "inv", width: 14 },
    { header: "Faltante", key: "faltante", width: 10 },
  ];
  encabezar(hDetalle);

  const detalleFiltrado = compra.detalleSkus.filter((d) => !modelo || d.modelo === modelo);
  for (const d of detalleFiltrado) {
    const fila = hDetalle.addRow({
      sku: d.sku,
      modelo: d.modelo,
      color: d.color,
      talla: d.talla,
      vMeli: d.ventaMesMeli,
      vReal: d.ventaMesRealMeli,
      vAmz: d.ventaMesAmazon,
      vAmzReal: d.ventaMesRealAmazon,
      full: d.enFull,
      fba: d.enFba,
      bodega: d.enBodega,
      china: d.deChina,
      inv: d.inventarioTotal,
      faltante: d.faltante,
    });
    // El faltante en rojo cuando el SKU de verdad pide pares.
    if (d.faltante > 0) {
      fila.getCell("faltante").font = { bold: true, color: { argb: "FFC00000" } };
    }
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
