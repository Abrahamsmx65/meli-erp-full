import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { esCron } from "@/lib/yapanizcel/api";
import { correrPendientes } from "@/lib/yapanizcel/pendientes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Resuelve los SKUs pendientes de YAPANIZCEL contra /user-products. El
 * trabajo corre DESPUÉS de contestar (`after`), porque tarda minutos y quien
 * dispara no puede quedarse esperando. Se relanza solo hasta vaciar la tabla;
 * el cron de cada hora es la red de seguridad.
 */
async function autorizado(req: NextRequest): Promise<boolean> {
  if (esCron(req)) return true;
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => correrPendientes(origen));
  return NextResponse.json({ ok: true, encolado: true }, { status: 202 });
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => correrPendientes(origen));
  const admin = clienteAdmin();
  const { count } = await admin.from("yz_skus_pendientes").select("*", { count: "exact", head: true });
  return NextResponse.json({ ok: true, encolado: true, pendientes: count ?? 0 }, { status: 202 });
}
