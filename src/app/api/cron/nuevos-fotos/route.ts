import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { revisarFotosDeNuevos } from "@/lib/servicios/productos-nuevos-revisar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Cada hora (vercel.json): fotos de Lanzamientos. Solo se le pregunta a MELI
 * y Amazon por lo que aún no tiene sus fotos; lo demás queda guardado. Hasta
 * el 21-oct-2026 solo se revisaba con el botón o al cargar un contenedor, y la
 * pantalla enseñaba «Sin fotos» en lo que ya las tenía.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presentado || !process.env.CRON_SECRET || presentado !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = clienteAdmin();
  const { data: cuentas } = await admin
    .from("meli_accounts")
    .select("id")
    .order("creado_en", { ascending: true })
    .limit(1);
  const cuenta = (cuentas ?? [])[0] as { id: string } | undefined;
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta de Mercado Libre." }, { status: 404 });

  try {
    const { lista: _lista, productos: _productos, ...r } = await revisarFotosDeNuevos(admin, admin, cuenta.id, false);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
