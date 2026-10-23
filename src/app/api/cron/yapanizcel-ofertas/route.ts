import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { DB } from "@/lib/datos/repos";
import { esCron } from "@/lib/yapanizcel/api";
import { clienteDeCuenta } from "@/lib/yapanizcel/cuenta";
import { confirmarPromosFundas, leerConfigOfertasFundas, revisarOfertasFundas } from "@/lib/servicios/fundas-ofertas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * Ofertas de las fundas (vercel.json):
 *  - `?que=promos` a las 10:05 y 00:35 de México: relámpago, Buen Fin y
 *    oferta de todos los días a los precios de la pestaña FUNDAS de Números
 *    (las mismas horas que el calzado: la de las 00:35 alcanza la relámpago
 *    del día en cuanto termina la de ayer).
 *  - `?que=aporte` cada hora: revisa las ofertas con aporte de MELI y acepta
 *    las que cumplen el PV MELI.
 * Con «Confirmar solas» apagado, solo revisa las de aporte y no inscribe nada.
 */
export async function GET(req: NextRequest) {
  if (!esCron(req)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const que = new URL(req.url).searchParams.get("que") === "promos" ? "promos" : "aporte";
  const admin = clienteAdmin() as DB;
  const { data: cuentas } = await admin.from("yz_cuentas").select("id, nickname");
  const resultados: Record<string, unknown>[] = [];
  for (const c of (cuentas ?? []) as { id: string; nickname: string | null }[]) {
    try {
      const { automatico } = await leerConfigOfertasFundas(admin, c.id);
      const cliente = await clienteDeCuenta(admin, c.id);
      if (que === "promos") {
        if (!automatico) {
          resultados.push({ cuenta: c.nickname, omitido: "Confirmar solas está apagado" });
          continue;
        }
        const { relampagos, buenFin } = await confirmarPromosFundas(admin, cliente, c.id, "cron");
        resultados.push({
          cuenta: c.nickname,
          relampagos: { inscritas: relampagos?.inscritas.length ?? 0, fallidas: relampagos?.fallidas.length ?? 0 },
          buenFin: { inscritas: buenFin?.inscritas.length ?? 0, fallidas: buenFin?.fallidas.length ?? 0 },
        });
      } else {
        const r = await revisarOfertasFundas(admin, cliente, c.id, { aceptar: automatico, origen: "cron" });
        resultados.push({
          cuenta: c.nickname,
          automatico,
          ofertas: r.renglones.length,
          aceptadas: r.ultimaAceptacion?.origen === "cron" ? r.ultimaAceptacion.aceptadas.length : 0,
        });
      }
    } catch (err) {
      resultados.push({ cuenta: c.nickname, error: (err as Error).message });
    }
  }
  return NextResponse.json({ que, resultados });
}
