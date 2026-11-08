import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { ENTRADA_VACIA, type EntradaNumeros } from "@/lib/finanzas/numeros";
import { numerosEnVivo } from "@/lib/servicios/numeros-vivo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const num = (x: unknown): number | null => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));

/**
 * Números EN VIVO de un modelo: comisión y envío de MELI a sus precios y
 * comisión y FBA de Amazon al PVP, preguntados en el momento. Recibe la
 * entrada como está en pantalla (aunque no se haya guardado). No escribe.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Partial<Record<keyof EntradaNumeros, unknown>>;
  const modelo = String(body.modelo ?? "").trim().toUpperCase();
  if (!/^[A-Z]{1,4}\d{2,5}[A-Z]?$/.test(modelo)) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  const entrada: EntradaNumeros = {
    modelo,
    envioMeli: num(body.envioMeli),
    precioRelampago: num(body.precioRelampago),
    pvNormal: num(body.pvNormal),
    retencion: Boolean(body.retencion),
    envioAmazon: num(body.envioAmazon),
    pvpDeal: num(body.pvpDeal),
    tiktokExtra: num(body.tiktokExtra) ?? ENTRADA_VACIA.tiktokExtra,
    tiktokComision: num(body.tiktokComision) ?? ENTRADA_VACIA.tiktokComision,
    tiktokOferta: num(body.tiktokOferta) ?? ENTRADA_VACIA.tiktokOferta,
  };
  const admin = clienteAdmin() as DB;
  const cliente = await clienteDeCuenta(admin, cuenta.id);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 });
  try {
    return NextResponse.json(await numerosEnVivo(supabase as DB, admin, cliente, cuenta.id, cuenta.meli_user_id, entrada));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
