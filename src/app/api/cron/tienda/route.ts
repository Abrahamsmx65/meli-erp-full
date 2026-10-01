import { NextResponse, type NextRequest } from "next/server";
import { refrescarCatalogoTienda } from "@/lib/servicios/tienda-catalogo";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * El contenido de la tienda en línea, con su PROPIO tiempo (cada hora):
 * catálogo de TikTok (precio, colores, tallas), las fotos de Amazon por
 * color (catálogo por ASIN), los puntos clave, el contenido A+ y los
 * banners de la tienda de marca. En el cron de TikTok solo le tocaba lo que
 * sobraba del rato y casi nunca alcanzaba para Amazon (1-oct-2026).
 *
 * Bearer CRON_SECRET (el cron de Vercel) o TIENDA_SECRET (para lanzarlo a
 * mano). `?todo=1` relee todo aunque esté fresco.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const validos = [process.env.CRON_SECRET, process.env.TIENDA_SECRET].map((s) => (s ?? "").trim()).filter(Boolean);
  if (!validos.some((s) => auth === `Bearer ${s}`)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const todo = req.nextUrl.searchParams.get("todo") === "1";
  const admin = clienteAdmin();
  const { data: tiendas } = await admin.from("tiktok_tienda").select("account_id");
  const inicio = Date.now();
  const resultados: Record<string, unknown>[] = [];
  for (const t of tiendas ?? []) {
    const restante = 285_000 - (Date.now() - inicio);
    if (restante < 30_000) break;
    try {
      resultados.push({ cuenta: t.account_id, ...(await refrescarCatalogoTienda(admin, t.account_id, restante, { todo })) });
    } catch (err) {
      resultados.push({ cuenta: t.account_id, error: (err as Error).message });
    }
  }
  return NextResponse.json({ ok: true, resultados });
}
