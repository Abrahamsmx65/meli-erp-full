import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/datos/repos";
import { amarreDeLineas } from "@/lib/servicios/amarre-pedido";
import { renglonesDelContenedor } from "@/lib/servicios/contenedor-datos";
import {
  colorParaIndusther,
  excelIndusther,
  leerPaginacion,
  separarCorrida,
  tablaDeCorridas,
  type FilaCorrida,
} from "@/lib/servicios/corridas-integracion";
import { esContenedorVivo, numeroSinAnio } from "@/lib/servicios/contenedores-integracion";
import { llaveIntegracionValida } from "@/lib/servicios/integracion-llave";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAMPOS = "pedido, modelo, color, tallas, total, origen, actualizado_en";

/**
 * Industher lee aquí las corridas de la sección Corridas (qué pares por
 * talla trae cada caja) en su formato (686_19.xlsx). Solo LECTURA. Sin
 * sesión: la puerta es la llave `x-api-key` = CORRIDAS_API_KEY.
 *
 *   GET /api/integracion/corridas?limit=1000&offset=0[&desde=ISO]
 *   GET /api/integracion/corridas?contenedor=S271     (solo las de ese contenedor)
 *   …&formato=xlsx                                    (el Excel, sin paginar)
 *
 * Orden estable (actualizado_en, pedido, modelo, color) para paginar sin
 * perder ni repetir; `desde` trae solo lo cambiado después de esa hora.
 */
export async function GET(req: NextRequest) {
  if (!llaveIntegracionValida(req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "API Key inválida." }, { status: 401 });
  }
  const params = req.nextUrl.searchParams;
  const pag = leerPaginacion(params);
  if ("error" in pag) return NextResponse.json({ error: pag.error }, { status: 400 });
  const xlsx = params.get("formato") === "xlsx";
  const contenedor = numeroSinAnio((params.get("contenedor") ?? "").toUpperCase());

  const admin = clienteAdmin();
  const { data: cuentas, error: errCuenta } = await admin
    .from("meli_accounts")
    .select("id")
    .order("creado_en", { ascending: true })
    .limit(1);
  if (errCuenta) return NextResponse.json({ error: errCuenta.message }, { status: 500 });
  const cuenta = cuentas?.[0]?.id as string | undefined;
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta." }, { status: 404 });

  const ordenar = (q: any) =>
    q.order("actualizado_en", { ascending: true }).order("pedido", { ascending: true }).order("modelo", { ascending: true }).order("color", { ascending: true });

  let filas: FilaCorrida[];
  let total: number;
  let paginado = false;
  try {
    if (contenedor) {
      // Las corridas de las cajas de ESE contenedor (por su clave pedido|modelo|color(-talla)).
      const { data: conts } = await admin.from("contenedores").select("id, numero").eq("account_id", cuenta);
      const c = (conts ?? []).find((x: any) => esContenedorVivo(x.numero) && numeroSinAnio(x.numero).toUpperCase() === contenedor);
      if (!c) return NextResponse.json({ error: `No existe el contenedor ${contenedor}.` }, { status: 404 });
      const renglones = await renglonesDelContenedor(admin, c.id);
      const claves = new Set(renglones.filter((r) => r.cajas > 0).map((r) => `${r.pedido}|${r.modelo}|${r.talla ? `${r.color}-${r.talla}` : r.color}`.toUpperCase()));
      const pedidos = [...new Set(renglones.map((r) => r.pedido))];
      const todas = pedidos.length
        ? await traerTodo<FilaCorrida>(admin, "corridas", CAMPOS, (q) => ordenar(q.eq("account_id", cuenta).in("pedido", pedidos)))
        : [];
      filas = todas.filter((f) => claves.has(`${f.pedido}|${f.modelo}|${f.color}`.toUpperCase()));
      total = filas.length;
    } else if (xlsx) {
      filas = await traerTodo<FilaCorrida>(admin, "corridas", CAMPOS, (q) => {
        let x = q.eq("account_id", cuenta);
        if (pag.desde) x = x.gt("actualizado_en", pag.desde);
        return ordenar(x);
      });
      total = filas.length;
    } else {
      let q = admin.from("corridas").select(CAMPOS, { count: "exact" }).eq("account_id", cuenta);
      if (pag.desde) q = q.gt("actualizado_en", pag.desde);
      const { data, error, count } = await ordenar(q).range(pag.offset, pag.offset + pag.limit - 1);
      if (error) throw new Error(error.message);
      filas = (data ?? []) as FilaCorrida[];
      total = count ?? filas.length;
      paginado = true;
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  // El COLOR que lleva el Sku de la caja (color de MELI; sin variante, el del pedido).
  const separadas = filas.map(separarCorrida);
  const amarres = await amarreDeLineas(
    admin,
    cuenta,
    separadas.map((c) => ({ modelo: c.modelo, color: c.color, talla: c.talla })),
  ).catch(() => [] as Awaited<ReturnType<typeof amarreDeLineas>>);
  const tabla = tablaDeCorridas(
    separadas.map((c, i) => ({
      pedido: c.pedido,
      modelo: c.modelo,
      color: colorParaIndusther(c, amarres[i]?.estado === "ligado" ? amarres[i].skuMeli : null),
      tallas: c.tallas,
    })),
  );

  if (xlsx) {
    const buffer = await excelIndusther([{ nombre: "Sheet1", tabla, vacio: "-" }]);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="corridas${contenedor ? `-${contenedor}` : ""}.xlsx"`,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    generado: new Date().toISOString(),
    total,
    ...(paginado ? { limit: pag.limit, offset: pag.offset, hayMas: pag.offset + filas.length < total } : {}),
    // El mayor actualizado_en de esta respuesta: el `desde` de la siguiente lectura incremental.
    ultimoCambio: filas.reduce<string | null>((m, f) => (f.actualizado_en && (!m || f.actualizado_en > m) ? f.actualizado_en : m), null),
    columnas: tabla.columnas,
    corridas: tabla.filas,
  });
}
