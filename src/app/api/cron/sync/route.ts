import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { sincronizar } from "@/lib/servicios/sync";
import { recalcular } from "@/lib/servicios/cache";
import { configuracionIndusther, sincronizarInventarioIndusther } from "@/lib/servicios/industher";
import { dispararPendientes } from "@/lib/servicios/disparar-pendientes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sincronización automática de cada mañana. La dispara Vercel Cron.
 *
 * Hace dos cosas, y la segunda es la que se siente: baja los datos de Mercado
 * Libre y DEJA EL PLAN YA CALCULADO. Si solo sincronizara, el plan quedaría
 * marcado como viejo y el primero en abrir la pantalla pagaría los segundos
 * del recálculo. Así llegas y ya está.
 *
 * Corre a diario aunque no vayas a planear ese día: cada corrida guarda la
 * foto del stock, y esas fotos son las que con el tiempo dejan medir los
 * agotamientos en vez de estimarlos.
 */
export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  if (!secreto || auth !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = clienteAdmin();
  const { data: cuentas } = await admin.from("meli_accounts").select("id, nickname");

  const resultados: Record<string, unknown>[] = [];

  for (const c of cuentas ?? []) {
    try {
      const r = await sincronizar(admin, c.id);

      // El inventario de bodega también llega solo, si la integración con
      // Industher está configurada. Si su API falla, la foto anterior sigue
      // sirviendo: se avisa y el resto de la sincronización continúa.
      let industher: Record<string, unknown> | null = null;
      if (configuracionIndusther()) {
        try {
          const inv = await sincronizarInventarioIndusther(admin, c.id);
          industher = { renglones: inv.renglones, cajasDisponibles: inv.cajasDisponibles };
        } catch (err) {
          industher = { error: (err as Error).message };
        }
      }

      // Dejar el plan servido. Si esto truena, la sincronización sigue siendo
      // buena: solo se pierde el adelanto y el plan se calcula al abrir.
      let msPlan: number | null = null;
      try {
        const plan = await recalcular(admin, c.id);
        msPlan = plan.msCalculo;
      } catch (err) {
        resultados.push({
          cuenta: c.nickname,
          aviso: `Se sincronizó pero no se pudo dejar el plan listo: ${(err as Error).message}`,
        });
      }

      resultados.push({ cuenta: c.nickname, ok: true, msPlan, industher, ...r });
    } catch (err) {
      resultados.push({ cuenta: c.nickname, ok: false, error: (err as Error).message });
    }
  }

  // Las tallas que quedaron sin SKU se resuelven solas después del cron.
  await dispararPendientes(process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin);

  return NextResponse.json({ corridas: resultados.length, resultados });
}
