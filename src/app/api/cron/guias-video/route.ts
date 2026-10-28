import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { generarGuias } from "@/lib/servicios/guias-ia";
import { RecursoOcupadoError } from "@/lib/datos/repos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cada hora (vercel.json): las ideas para el video que faltan, hechas por
 * Claude mirando las fotos (`servicios/guias-ia.ts`). Un modelo ya hecho no
 * se vuelve a pagar salvo que cambie su producto; sin la llave
 * ANTHROPIC_API_KEY_GUIAS o con el tope del mes alcanzado, no llama a nada.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presentado || !process.env.CRON_SECRET || presentado !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = clienteAdmin();
  const { data: cuentas } = await admin.from("meli_accounts").select("id").order("creado_en", { ascending: true }).limit(1);
  const cuenta = (cuentas ?? [])[0] as { id: string } | undefined;
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta de Mercado Libre." }, { status: 404 });

  try {
    const r = await generarGuias(admin, cuenta.id, { msMax: 240_000 });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof RecursoOcupadoError) return NextResponse.json({ ok: true, ocupado: true });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
