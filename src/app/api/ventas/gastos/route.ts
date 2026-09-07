import { NextResponse } from "next/server";
import { sesionYCuenta } from "../_comun";

export const dynamic = "force-dynamic";

const CATEGORIAS = new Set(["full", "publicidad", "otro"]);

/** POST { fecha, concepto, categoria, monto } -> captura un gasto del mes. */
export async function POST(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const b = await req.json().catch(() => ({}));
  const fecha = typeof b?.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.fecha) ? b.fecha : null;
  const concepto = typeof b?.concepto === "string" ? b.concepto.trim().slice(0, 200) : "";
  const categoria = CATEGORIAS.has(b?.categoria) ? b.categoria : "otro";
  const monto = Number(b?.monto);
  if (!fecha) return NextResponse.json({ error: "Falta la fecha." }, { status: 400 });
  if (!concepto) return NextResponse.json({ error: "Falta el concepto." }, { status: 400 });
  if (!Number.isFinite(monto) || monto === 0) return NextResponse.json({ error: "El monto tiene que ser un número distinto de cero." }, { status: 400 });

  const { data, error } = await s.supabase
    .from("gastos_meli")
    .insert({
      account_id: s.cuenta.id,
      fecha,
      concepto,
      categoria,
      monto: Math.round(monto * 100) / 100,
      creado_por: s.userId,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

/** DELETE { id } -> borra un gasto capturado. */
export async function DELETE(req: Request) {
  const s = await sesionYCuenta();
  if (!s.ok) return s.respuesta;
  const b = await req.json().catch(() => ({}));
  const id = Number(b?.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Gasto inválido." }, { status: 400 });
  const { error } = await s.supabase.from("gastos_meli").delete().eq("account_id", s.cuenta.id).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
