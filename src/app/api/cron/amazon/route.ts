import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { Cliente, cuentasAmazon } from "@/lib/amazon/spapi";
import { sincronizarInventario, sincronizarVentas } from "@/lib/amazon/sync";

export const dynamic = "force-dynamic";
// zlib para descomprimir los reportes: hace falta el runtime de Node, no edge.
export const runtime = "nodejs";
export const maxDuration = 300;

/** Margen antes del corte de Vercel, para alcanzar a guardar lo conseguido. */
const PLAZO_MS = 270_000;

/**
 * Sincronización de Amazon. La dispara Vercel Cron.
 *
 *   ?tarea=ventas      cada 15 min · pedidos nuevos y modificados
 *   ?tarea=inventario  cada hora   · stock en FBA, vía reporte en dos pasos
 *
 * Vive en línea a propósito: antes dependía de que una Mac estuviera
 * encendida, y una laptop que se duerme no sirve para sincronizar.
 */
export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secreto || auth !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const tarea = req.nextUrl.searchParams.get("tarea") ?? "ventas";
  if (tarea !== "ventas" && tarea !== "inventario") {
    return NextResponse.json(
      { error: "tarea debe ser 'ventas' o 'inventario'." },
      { status: 400 },
    );
  }

  const admin = clienteAdmin();
  const cuentas = await cuentasAmazon(admin);

  if (cuentas.length === 0) {
    return NextResponse.json({
      aviso: "No hay cuentas de Amazon con credenciales guardadas.",
    });
  }

  const limite = Date.now() + PLAZO_MS;
  const resultados: Record<string, unknown>[] = [];

  for (const cuenta of cuentas) {
    const inicio = Date.now();
    const { data: corrida } = await admin
      .from("amazon_sync_log")
      .insert({ account_id: cuenta.accountId, tarea: `cron_${tarea}`, estado: "corriendo" })
      .select("id")
      .maybeSingle();

    try {
      const cliente = new Cliente(cuenta, limite);
      const r =
        tarea === "ventas"
          ? await sincronizarVentas(admin, cliente)
          : await sincronizarInventario(admin, cliente);

      resultados.push({ cuenta: cuenta.nombre, ok: true, ...r });

      if (corrida?.id) {
        await admin
          .from("amazon_sync_log")
          .update({
            fin: new Date().toISOString(),
            estado: "ok",
            detalle: { ...r, ms: Date.now() - inicio },
          })
          .eq("id", corrida.id);
      }
    } catch (err) {
      const mensaje = (err as Error).message;
      resultados.push({ cuenta: cuenta.nombre, ok: false, error: mensaje });

      if (corrida?.id) {
        await admin
          .from("amazon_sync_log")
          .update({
            fin: new Date().toISOString(),
            estado: "error",
            detalle: { error: mensaje.slice(0, 1000) },
          })
          .eq("id", corrida.id);
      }
    }
  }

  return NextResponse.json({ tarea, cuentas: cuentas.length, resultados });
}
