import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { esCron } from "@/lib/yapanizcel/api";
import { sincronizar } from "@/lib/yapanizcel/sync";
import { sincronizarInventarioDesdeSheets } from "@/lib/yapanizcel/inventario";
import { configuracionSheets } from "@/lib/yapanizcel/sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sincronización diaria de YAPANIZCEL: Mercado Libre (catálogo, stock,
 * ventas) y el sheet de bodega. Corre aunque no se vaya a planear ese día:
 * cada corrida deja la foto del stock, y esas fotos son las que con el
 * tiempo permiten medir los agotamientos en vez de suponerlos.
 */
export async function GET(req: NextRequest) {
  if (!esCron(req)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const admin = clienteAdmin();
  const { data: cuentas } = await admin.from("yz_cuentas").select("id, nickname");
  const resultados: Record<string, unknown>[] = [];

  for (const c of cuentas ?? []) {
    const r: Record<string, unknown> = { cuenta: c.nickname };
    try {
      r.meli = await sincronizar(admin, c.id);
    } catch (err) {
      r.meli = { error: (err as Error).message };
      await admin.from("yz_sync_log").insert({ account_id: c.id, ok: false, detalle: { error: (err as Error).message } });
    }
    if (configuracionSheets()) {
      try {
        const s = await sincronizarInventarioDesdeSheets(admin, c.id);
        r.sheets = { renglones: s.renglones, unidades: s.unidades, avisos: s.avisos.length };
      } catch (err) {
        r.sheets = { error: (err as Error).message };
      }
    }
    resultados.push(r);
  }

  // Los SKUs que quedaron pendientes se resuelven en segundo plano.
  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const secreto = process.env.CRON_SECRET;
  if (secreto) {
    fetch(`${origen}/api/yapanizcel/skus-pendientes`, { method: "POST", headers: { authorization: `Bearer ${secreto}` } }).catch(() => {});
  }

  return NextResponse.json({ ok: true, resultados });
}
