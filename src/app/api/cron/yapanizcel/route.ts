import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { esCron } from "@/lib/yapanizcel/api";
import { sincronizar } from "@/lib/yapanizcel/sync";
import { sincronizarInventarioDesdeSheets } from "@/lib/yapanizcel/inventario";
import { configuracionSheets } from "@/lib/yapanizcel/sheets";
import { correrPendientes as resolverPendientesLuego } from "@/lib/yapanizcel/pendientes";

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
      // Tramos hasta que se acabe el presupuesto de la función; lo que falte
      // lo recoge el siguiente cron (o el botón de la pantalla).
      const t0 = Date.now();
      let resumen = await sincronizar(admin, c.id, { presupuestoMs: 150_000 });
      while (!resumen.completo && Date.now() - t0 < 200_000) {
        resumen = await sincronizar(admin, c.id, {
          presupuestoMs: 200_000 - (Date.now() - t0),
          continuar: true,
          conStock: resumen.pendiente.stock,
        });
      }
      r.meli = resumen;
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

  // Los SKUs que quedaron pendientes se resuelven después de contestar, en
  // este mismo proceso; el cron de cada hora sigue como red de seguridad.
  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => resolverPendientesLuego(origen));

  return NextResponse.json({ ok: true, resultados });
}
