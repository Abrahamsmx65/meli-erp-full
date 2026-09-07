/** Alta y baja de gastos capturados a mano, para calzado (gastos_meli) y fundas (yz_gastos). */
import type { DB } from "../datos/repos";

const CATEGORIAS = new Set(["full", "publicidad", "otro"]);

export async function crearGasto(
  db: DB,
  accountId: string,
  userId: string,
  b: any,
  tabla: string,
): Promise<{ id?: number; error?: string }> {
  const fecha = typeof b?.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.fecha) ? b.fecha : null;
  const concepto = typeof b?.concepto === "string" ? b.concepto.trim().slice(0, 200) : "";
  const categoria = CATEGORIAS.has(b?.categoria) ? b.categoria : "otro";
  const monto = Number(b?.monto);
  if (!fecha) return { error: "Falta la fecha." };
  if (!concepto) return { error: "Falta el concepto." };
  if (!Number.isFinite(monto) || monto === 0) return { error: "El monto tiene que ser un número distinto de cero." };
  const { data, error } = await db
    .from(tabla)
    .insert({ account_id: accountId, fecha, concepto, categoria, monto: Math.round(monto * 100) / 100, creado_por: userId })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: Number(data.id) };
}

export async function borrarGasto(db: DB, accountId: string, b: any, tabla: string): Promise<{ error?: string }> {
  const id = Number(b?.id);
  if (!Number.isFinite(id)) return { error: "Gasto inválido." };
  const { error } = await db.from(tabla).delete().eq("account_id", accountId).eq("id", id);
  return error ? { error: error.message } : {};
}
