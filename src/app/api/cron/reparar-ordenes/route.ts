import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { conCandado, RecursoOcupadoError } from "@/lib/datos/repos";
import { repararOrdenesAntiguas } from "@/lib/servicios/reparar-ordenes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Margen antes del corte de Vercel para guardar el avance. */
const PLAZO_MS = 220_000;

/**
 * Registra hacia atrás las órdenes de calzado que nunca entraron a
 * `ordenes_neto` (junio 2026), un día a la vez, cada 10 minutos
 * (vercel.json). Cuando llega al fondo se marca completo y ya no hace nada.
 * Mismo secreto que /api/cron/plan.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presentado) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const admin = clienteAdmin();
  let autorizado = Boolean(process.env.CRON_SECRET) && presentado === process.env.CRON_SECRET;
  if (!autorizado) {
    const { data } = await admin.from("app_secretos").select("valor").eq("clave", "cron_amazon").maybeSingle();
    autorizado = Boolean(data?.valor) && presentado === data!.valor;
  }
  if (!autorizado) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const limite = Date.now() + PLAZO_MS;
  const { data: cuentas } = await admin.from("meli_accounts").select("id, nickname").order("creado_en", { ascending: true });
  const resultados: Record<string, unknown>[] = [];
  for (const c of cuentas ?? []) {
    try {
      const r = await conCandado(admin, c.id, "reparar-ordenes", 290, () => repararOrdenesAntiguas(admin, c.id, limite));
      resultados.push({ cuenta: c.nickname, ...r });
    } catch (err) {
      resultados.push({ cuenta: c.nickname, ...(err instanceof RecursoOcupadoError ? { aviso: "Ya hay una corrida en curso." } : { error: (err as Error).message }) });
    }
  }
  return NextResponse.json({ cuentas: cuentas?.length ?? 0, resultados });
}
