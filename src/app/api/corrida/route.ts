import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { invalidar } from "@/lib/servicios/cache";

export const dynamic = "force-dynamic";

/** Captura a mano una corrida que falta en la base. */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const pedido = String(body?.pedido ?? "").trim();
  const modelo = String(body?.modelo ?? "").trim();
  const color = String(body?.color ?? "").trim();
  const tallasRaw = body?.tallas as Record<string, unknown> | undefined;

  if (!pedido || !modelo || !tallasRaw) {
    return NextResponse.json(
      { error: "Faltan pedido, modelo o el desglose de tallas." },
      { status: 400 },
    );
  }

  const tallas: Record<string, number> = {};
  let total = 0;
  for (const [t, v] of Object.entries(tallasRaw)) {
    const pares = Number(v);
    if (!Number.isFinite(pares) || pares <= 0) continue;
    tallas[String(t)] = Math.round(pares);
    total += Math.round(pares);
  }

  if (total <= 0) {
    return NextResponse.json({ error: "La corrida no puede ir en ceros." }, { status: 400 });
  }

  const { error } = await supabase.from("corridas").upsert(
    {
      account_id: cuenta.id,
      pedido,
      modelo,
      color,
      tallas,
      total,
      origen: "manual",
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "account_id,pedido,modelo,color" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await invalidar(supabase, cuenta.id, "Se capturó o cambió una corrida.");
    return NextResponse.json({ ok: true, total });
}
