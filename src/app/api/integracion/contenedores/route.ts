import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { llaveIntegracionValida } from "@/lib/servicios/integracion-llave";
import { armarArchivosBodega } from "@/lib/servicios/bodega-contenedor";
import { conSkusMeli, datosDeModelos, renglonesDelContenedor } from "@/lib/servicios/contenedor-datos";
import { excelIndusther } from "@/lib/servicios/corridas-integracion";
import {
  contenedorParaIndusther,
  esContenedorVivo,
  ESTADOS_PENDIENTES,
  numeroSinAnio,
  type FilaContenedor,
} from "@/lib/servicios/contenedores-integracion";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Industher lee aquí los contenedores que todavía no llegan (borrador o en
 * tránsito) para darlos de alta como BORRADOR de llegada, en su formato
 * (S260.xlsx). Solo LECTURA. Sin sesión: la puerta es la llave
 * `x-api-key` = CORRIDAS_API_KEY.
 *
 *   GET /api/integracion/contenedores[?numero=S271][&formato=xlsx]
 *
 * Un contenedor que el ERP marca recibido ya no sale aquí.
 */
export async function GET(req: NextRequest) {
  if (!llaveIntegracionValida(req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "API Key inválida." }, { status: 401 });
  }
  const numero = numeroSinAnio((req.nextUrl.searchParams.get("numero") ?? "").toUpperCase());
  const xlsx = req.nextUrl.searchParams.get("formato") === "xlsx";

  const admin = clienteAdmin();
  const { data: cuentas, error: errCuenta } = await admin
    .from("meli_accounts")
    .select("id")
    .order("creado_en", { ascending: true })
    .limit(1);
  if (errCuenta) return NextResponse.json({ error: errCuenta.message }, { status: 500 });
  const cuenta = cuentas?.[0]?.id as string | undefined;
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta." }, { status: 404 });

  const { data, error } = await admin
    .from("contenedores")
    .select("id, numero, numero_naviera, naviera, estado, fecha_salida, fecha_llegada_est, cajas_bl, otros")
    .eq("account_id", cuenta)
    .in("estado", [...ESTADOS_PENDIENTES])
    .order("numero", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const filas = ((data ?? []) as FilaContenedor[])
    .filter((c) => esContenedorVivo(c.numero))
    .filter((c) => !numero || numeroSinAnio(c.numero).toUpperCase() === numero);
  if (numero && !filas.length) {
    return NextResponse.json({ error: `${numero} no está pendiente en el ERP (no existe o ya se recibió).` }, { status: 404 });
  }

  const contenedores = [];
  for (const c of filas) {
    const renglones = await conSkusMeli(admin, cuenta, await renglonesDelContenedor(admin, c.id));
    const modelos = await datosDeModelos(admin, cuenta, [...new Set(renglones.map((r) => r.modelo))]);
    contenedores.push(contenedorParaIndusther(c, armarArchivosBodega(renglones, modelos, new Set())));
  }

  if (xlsx) {
    // Un contenedor = su «Sheet1», como el archivo de Industher; varios = una hoja por contenedor.
    const hojas = contenedores.map((c) => ({ nombre: numero ? "Sheet1" : c.numero, tabla: c.tabla }));
    const buffer = await excelIndusther(hojas.length ? hojas : [{ nombre: "Sheet1", tabla: { columnas: [], filas: [] } }]);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${numero || "contenedores-pendientes"}.xlsx"`,
      },
    });
  }

  return NextResponse.json({ ok: true, generado: new Date().toISOString(), total: contenedores.length, contenedores });
}
