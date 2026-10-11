import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { Cuenta } from "@/lib/datos/repos";
import { enviarCorreoPublicidad } from "@/lib/servicios/publicidad-correo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Lee tres canales; el de fundas pagina sus anuncios de 50 en 50.
export const maxDuration = 800;

/**
 * Correo de los LUNES y JUEVES a las 8:15 de México (14:15Z, vercel.json)
 * con los cambios de publicidad de calzado, fundas y Amazon. Mismo secreto que los demás crons. Para
 * probarlo a mano: `?forzar=1` (sin `forzar`, no se repite en el mismo día)
 * y `&para=correo@…` para mandarlo solo a una dirección.
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

  const sp = req.nextUrl.searchParams;
  const forzar = sp.get("forzar") === "1";
  const para = sp.get("para")?.trim() || undefined;

  // Cuelga de la primera cuenta de MELI (calzado); fundas y Amazon se leen
  // desde su propia cuenta.
  const { data: cuentas } = await admin
    .from("meli_accounts")
    .select("id, meli_user_id, nickname, site_id")
    .order("creado_en", { ascending: true })
    .limit(1);
  const cuenta = (cuentas ?? [])[0] as Cuenta | undefined;
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta de Mercado Libre." }, { status: 404 });
  try {
    return NextResponse.json(await enviarCorreoPublicidad(admin, cuenta, { forzar, para }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
