import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { aceptarBuenFinAMinimo } from "@/lib/servicios/precios-modelos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Acepta a su mínimo las promociones de Buen Fin que MELI rechazó por precio. */
export async function POST(req: Request) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  const admin = clienteAdmin() as DB;
  const cliente = await clienteDeCuenta(admin, cuenta.id);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 });
  const body = (await req.json().catch(() => null)) as { renglones?: unknown } | null;
  const renglones = (Array.isArray(body?.renglones) ? body.renglones : [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x.itemId === "string" && /^MLM\d+$/.test(x.itemId) && Number(x.precio) > 0)
    .map((x) => ({
      itemId: x.itemId as string,
      promoId: typeof x.promoId === "string" ? x.promoId : null,
      tipo: String(x.tipo ?? ""),
      offerId: typeof x.offerId === "string" ? x.offerId : null,
      accion: x.accion === "cambiar" ? "cambiar" : "inscribir",
      precio: Math.round(Number(x.precio) * 100) / 100,
      donde: typeof x.donde === "string" ? x.donde : undefined,
    }));
  if (!renglones.length) return NextResponse.json({ error: "No hay promociones que aceptar." }, { status: 400 });
  return NextResponse.json({ resultados: await aceptarBuenFinAMinimo(admin, cliente, cuenta.id, renglones) });
}
