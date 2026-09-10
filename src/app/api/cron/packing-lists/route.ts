import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { sincronizarPackingListsDrive } from "@/lib/servicios/drive-packing";
import { avisarContenedores } from "@/lib/servicios/avisos-contenedor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Una vez al día: los packing lists de la carpeta de Drive de la fábrica
 * entran como contenedores en BORRADOR (ver drive-packing.ts). Mismo
 * secreto que los demás crons (CRON_SECRET o app_secretos).
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

  const finMs = Date.now() + 240_000;
  const { data: cuentas } = await admin.from("meli_accounts").select("id, nickname");
  const resultados: Record<string, unknown>[] = [];
  for (const c of cuentas ?? []) {
    try {
      const r = await sincronizarPackingListsDrive(admin, c.id, { finMs });
      // Los recordatorios del contenedor (una semana antes y el día que
      // llega) van aquí: es el trabajo diario de contenedores.
      const avisos = await avisarContenedores(admin, c.id);
      resultados.push({ cuenta: c.nickname, ...r, avisos });
    } catch (err) {
      resultados.push({ cuenta: c.nickname, error: (err as Error).message.slice(0, 300) });
    }
  }
  return NextResponse.json({ ok: true, resultados });
}
