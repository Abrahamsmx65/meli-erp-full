import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, reemplazarExistencias, upsertEnTandas } from "@/lib/datos/repos";
import { invalidar } from "@/lib/servicios/cache";
import { invalidarInventario } from "@/lib/servicios/inventario";
import { importarCorridas, importarExistencias } from "@/lib/importar/excel";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Recibe los Excel de la operación y los guarda.
 *
 *   CORRIDAS BASE  -> se acumula: una corrida vieja sigue sirviendo para el
 *                     inventario de ese pedido.
 *   EXISTENCIAS    -> se REEMPLAZA completo: es una foto del momento, y
 *                     conservar renglones viejos haría planear con cajas
 *                     que ya se movieron.
 *
 * Las existencias ya llegan solas desde el API de Industher (/api/industher y
 * el cron diario); la pantalla de importar ya no ofrece ese archivo. La rama
 * de EXISTENCIAS se conserva como respaldo de emergencia por si el API del
 * almacén llegara a caerse.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json(
      { error: "Conecta primero tu cuenta de Mercado Libre." },
      { status: 400 },
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "No recibí archivos." }, { status: 400 });

  const fCorridas = form.get("corridas");
  const fExistencias = form.get("existencias");
  const resumen: Record<string, unknown> = {};
  const avisos: string[] = [];

  try {
    if (fCorridas instanceof File && fCorridas.size > 0) {
      const buf = Buffer.from(await fCorridas.arrayBuffer());
      const r = await importarCorridas(buf);

      const filas = r.corridas.map((c) => ({
        account_id: cuenta.id,
        pedido: c.pedido,
        modelo: c.modelo,
        color: c.color,
        tallas: c.tallas,
        total: c.total,
        origen: "excel",
        actualizado_en: new Date().toISOString(),
      }));

      await upsertEnTandas(supabase, "corridas", filas, "account_id,pedido,modelo,color");
      resumen.corridas = { leidas: r.corridas.length, tallas: r.tallas };
      avisos.push(...r.avisos.map((a) => `Corridas fila ${a.fila}: ${a.mensaje}`));
    }

    if (fExistencias instanceof File && fExistencias.size > 0) {
      const buf = Buffer.from(await fExistencias.arrayBuffer());
      const r = await importarExistencias(buf);

      const filas = r.filas.map((f) => ({
        almacen: f.almacen,
        codigo_almacen: f.codigoAlmacen,
        sku_caja: f.skuCaja,
        pedido: f.pedido,
        modelo: f.modelo,
        color: f.color,
        talla: f.talla,
        contenedor: f.contenedor || "",
        cajas_fisicas: f.cajasFisicas,
        cajas_apartadas: f.cajasApartadas,
        en_camino: f.enCamino,
        cajas_disponibles: f.cajasDisponibles,
        pares_por_caja: f.paresPorCaja,
      }));

      await reemplazarExistencias(supabase, cuenta.id, r.almacenes, filas, true);

      resumen.existencias = {
        leidas: r.filas.length,
        almacenes: r.almacenes,
        cajasDisponibles: r.filas.reduce((a, f) => a + f.cajasDisponibles, 0),
      };
      avisos.push(...r.avisos.map((a) => `Existencias fila ${a.fila}: ${a.mensaje}`));
    }

    if (!Object.keys(resumen).length) {
      return NextResponse.json({ error: "No mandaste ningún archivo válido." }, { status: 400 });
    }

    invalidarInventario(cuenta.id);
    await invalidar(supabase, cuenta.id, "Se importaron archivos de corridas o existencias.");
    return NextResponse.json({ ok: true, resumen, avisos: avisos.slice(0, 50) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
