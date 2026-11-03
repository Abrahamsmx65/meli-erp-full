import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { refrescarPantallasAmazon } from "@/lib/servicios/latido-amazon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Deja tiempo para guardar antes de que Vercel corte. */
const PLAZO_MS = 240_000;

/**
 * Ventas y Publicidad de Amazon masticadas por atrás cada 10 minutos
 * (vercel.json). Vivían al final del latido con lo que sobraba de 45 s y
 * casi nunca alcanzaban: las pantallas se servían viejas. Mismo secreto que
 * /api/cron/consolidado.
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
  // La cuenta de MELI amarra los SKUs de Amazon a su modelo (costos); es una
  // sola por dueño (registro cerrado), la más vieja.
  const { data: meli } = await admin
    .from("meli_accounts")
    .select("id")
    .order("creado_en", { ascending: true })
    .limit(1)
    .maybeSingle();
  try {
    const hechas = await refrescarPantallasAmazon(admin, meli?.id ?? null, limite);
    return NextResponse.json({ ok: true, hechas });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
