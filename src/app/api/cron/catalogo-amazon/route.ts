import { NextResponse, type NextRequest } from "next/server";
import { refrescarCatalogoAmazon } from "@/lib/servicios/catalogo-amazon";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Pasada NOCTURNA del catálogo de Amazon para creadores: a las 2:00 de
 * México (08:00Z, México no cambia de horario) se releen TODOS los ASINs,
 * los más viejos primero, aunque estén frescos (`todo`). El cron de la
 * tienda de cada hora solo relee lo de más de 7 días, así que una foto
 * cargada en Amazon tardaba hasta una semana en salir en el catálogo
 * (6-oct-2026: los GT211, GT212, GT215, GT216, GT220, GT222 y GT225 del
 * IN10079 no salían porque Amazon no tenía fotos; dueño: «que el catálogo
 * de Amazon se lea cada noche a las 2am»).
 *
 * Bearer CRON_SECRET (el cron de Vercel) o TIENDA_SECRET (para lanzarlo a
 * mano). Lo que no alcance en los 5 minutos queda para la noche siguiente;
 * la bitácora `catalogo-amazon` (origen `nocturno`) dice cuánto se leyó.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const validos = [process.env.CRON_SECRET, process.env.TIENDA_SECRET].map((s) => (s ?? "").trim()).filter(Boolean);
  if (!validos.some((s) => auth === `Bearer ${s}`)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const admin = clienteAdmin();
  const { data: tiendas } = await admin.from("tiktok_tienda").select("account_id");
  const inicio = Date.now();
  const resultados: Record<string, unknown>[] = [];
  for (const t of tiendas ?? []) {
    const restante = 290_000 - (Date.now() - inicio);
    if (restante < 60_000) break;
    try {
      resultados.push({ cuenta: t.account_id, catalogoAmazon: await refrescarCatalogoAmazon(admin, t.account_id, restante, { todo: true }) });
    } catch (err) {
      resultados.push({ cuenta: t.account_id, catalogoAmazon: { error: (err as Error).message } });
    }
  }
  return NextResponse.json({ ok: true, resultados });
}
