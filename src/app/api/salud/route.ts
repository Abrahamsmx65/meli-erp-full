import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaActiva as cuentaYz } from "@/lib/yapanizcel/cuenta";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { revisarSalud } from "@/lib/servicios/salud";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** La revisión general en JSON: la misma que enseña /salud. */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  const [yz, amz] = await Promise.all([
    cuentaYz(supabase).catch(() => null),
    cuentaAmazon(supabase).catch(() => null),
  ]);
  const salud = await revisarSalud(supabase, cuenta, {
    yzAccountId: yz?.id ?? null,
    amazonAccountId: amz?.id ?? null,
  });
  return NextResponse.json(salud);
}
