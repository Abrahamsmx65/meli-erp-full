import { NextResponse, type NextRequest } from "next/server";
import { calentarCortesRecientes } from "@/lib/servicios/tiktok-despacho";
import { configuracionTikTok } from "@/lib/tiktok/client";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Las etiquetas de los cortes de TikTok, CADA MINUTO.
 *
 * Dueño (1-oct-2026): «al momento que hago el corte, tomas todas las
 * etiquetas, las juntas y están disponibles para descargar; no hay que
 * armar nada después». La ruta del corte baja y arma lo que le alcanza en
 * su `after()` y prende un eslabón de fondo; este cron es el seguro de que
 * el trabajo SIGUE sin pausa aunque el eslabón no prenda o la pestaña se
 * cierre: cada minuto revisa si algún corte de los últimos dos días está
 * sin sus tomos y, si lo hay, trabaja con todo el rato de la función
 * (~4.5 min). El candado por corte (`tiktok-etiquetas-{id}`) hace que las
 * corridas encimadas contesten «ocupado» en el acto, así que entre un
 * obrero y el siguiente nunca pasa más de un minuto. Sin cortes pendientes
 * cuesta dos lecturas y nada más. Antes solo lo hacía el cron de inventario
 * cada 15 min con 150 s: el corte #45 (611 pedidos) tardó 64 minutos.
 */
export async function GET(req: NextRequest) {
  const inicioRuta = Date.now();
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secreto || auth !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (!configuracionTikTok()) {
    return NextResponse.json({
      ok: true,
      aviso: "TikTok Shop no está configurado.",
    });
  }

  const admin = clienteAdmin();
  const { data: cuentas } = await admin
    .from("meli_accounts")
    .select("id, nickname");
  const resultados: Record<string, unknown>[] = [];
  for (const c of cuentas ?? []) {
    const restante = 285_000 - (Date.now() - inicioRuta);
    if (restante < 40_000) break;
    try {
      const r = await calentarCortesRecientes(
        admin,
        c.id,
        restante,
        "cron-minuto",
      );
      resultados.push({ cuenta: c.nickname, ok: true, ...r });
    } catch (err) {
      resultados.push({
        cuenta: c.nickname,
        ok: false,
        error: (err as Error).message,
      });
    }
  }
  return NextResponse.json({
    cuentas: resultados.length,
    resultados,
    ms: Date.now() - inicioRuta,
  });
}
