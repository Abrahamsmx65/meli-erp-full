import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { Cliente, cuentasAmazon } from "@/lib/amazon/spapi";
import { sincronizarInventario, sincronizarVentas } from "@/lib/amazon/sync";

export const dynamic = "force-dynamic";
// zlib para descomprimir los reportes: hace falta el runtime de Node, no edge.
export const runtime = "nodejs";
// El plan Hobby topa las funciones en 60 s; pedir más no las alarga.
export const maxDuration = 60;

/** Margen antes del corte, para alcanzar a guardar lo ya conseguido. */
const PLAZO_MS = 50_000;

/**
 * Sincronización de Amazon. La dispara Vercel Cron.
 *
 *   ?tarea=ventas      cada 15 min · pedidos nuevos y modificados
 *   ?tarea=inventario  cada hora   · stock en FBA, vía reporte en dos pasos
 *
 * Quien la dispara NO es Vercel Cron: el plan Hobby sólo permite frecuencia
 * diaria. La programación vive en pg_cron dentro de Supabase, que llama a
 * esta ruta con pg_net. Así corre en línea sin depender de ninguna Mac y sin
 * subir de plan.
 *
 * El secreto se valida contra la base y no contra una variable de entorno,
 * porque quien llama es la propia base de datos.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presentado) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = clienteAdmin();

  // Vale el secreto de Vercel (por si algún día se dispara desde ahí) o el
  // guardado en la base, que es el que usa pg_cron.
  let autorizado = Boolean(process.env.CRON_SECRET) && presentado === process.env.CRON_SECRET;
  if (!autorizado) {
    const { data } = await admin
      .from("app_secretos")
      .select("valor")
      .eq("clave", "cron_amazon")
      .maybeSingle();
    autorizado = Boolean(data?.valor) && presentado === data!.valor;
  }
  if (!autorizado) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const tarea = req.nextUrl.searchParams.get("tarea") ?? "ventas";
  if (tarea !== "ventas" && tarea !== "inventario") {
    return NextResponse.json(
      { error: "tarea debe ser 'ventas' o 'inventario'." },
      { status: 400 },
    );
  }

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
