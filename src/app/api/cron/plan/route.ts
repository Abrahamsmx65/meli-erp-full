import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { latido } from "@/lib/servicios/latido";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Empujón manual (o programado) del latido: drena los avisos de MELI y deja
 * el plan recalculado. Normalmente no hace falta — la app abierta late cada
 * 30 s y el webhook lo enciende cada hora si está cerrada — pero tener una
 * puerta con secreto permite dispararlo desde fuera (pg_cron, un curl) sin
 * sesión.
 *
 * El secreto se acepta de dos fuentes: el CRON_SECRET de Vercel o el
 * guardado en la tabla app_secretos, que es el que usa la base de datos
 * para llamarse a sí misma (mismo patrón que /api/cron/amazon).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presentado) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = clienteAdmin();

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

  const { data: cuentas } = await admin.from("meli_accounts").select("id, nickname");
  const resultados: Record<string, unknown>[] = [];

  for (const c of cuentas ?? []) {
    const r = await latido(admin, c.id);
    resultados.push({
      cuenta: c.nickname,
      ...(r.corrio ? { ok: true, procesados: r.procesados, msPlan: r.msPlan } : { aviso: "Ya hay trabajo en curso." }),
    });
  }

  return NextResponse.json({ cuentas: cuentas?.length ?? 0, resultados });
}
