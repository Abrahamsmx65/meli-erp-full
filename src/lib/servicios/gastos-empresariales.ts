import type { DB } from "../datos/repos";

export interface GastoEmpresarial {
  id: number;
  fecha: string;
  concepto: string;
  categoria: string;
  monto: number;
}

type EntradaGasto = Pick<GastoEmpresarial, "fecha" | "concepto" | "categoria" | "monto">;

function claveImportacionValida(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length >= 1 && valor.trim().length <= 200;
}

function claveIdempotenteValida(valor: unknown): valor is string {
  return typeof valor === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

function fechaValida(valor: unknown): valor is string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [anio, mes, dia] = valor.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

function validarEntrada(b: any): { valor?: EntradaGasto; error?: string } {
  const fecha = fechaValida(b?.fecha) ? b.fecha : "";
  const concepto = typeof b?.concepto === "string" ? b.concepto.trim().slice(0, 200) : "";
  const categoria = typeof b?.categoria === "string" ? b.categoria.trim().slice(0, 80) : "";
  const monto = Number(b?.monto);
  if (!fecha) return { error: "Falta una fecha válida." };
  if (!concepto) return { error: "Falta el concepto." };
  if (!categoria) return { error: "Falta la categoría." };
  if (!Number.isFinite(monto) || monto <= 0) return { error: "El monto debe ser mayor que cero." };
  return { valor: { fecha, concepto, categoria, monto: Math.round(monto * 100) / 100 } };
}

export async function listarGastosEmpresariales(db: DB, accountId: string, desde: string, hasta: string): Promise<GastoEmpresarial[]> {
  const { data, error } = await db
    .from("gastos_empresariales")
    .select("id, fecha, concepto, categoria, monto")
    .eq("account_id", accountId)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(`No se pudieron cargar los gastos empresariales: ${error.message}`);
  return (data ?? []).map((g: any) => ({ ...g, id: Number(g.id), monto: Number(g.monto) || 0 }));
}

export async function crearGastoEmpresarial(db: DB, accountId: string, userId: string, b: any) {
  const entrada = validarEntrada(b);
  if (!entrada.valor) return { error: entrada.error };
  const claveIdempotencia = b?.claveIdempotencia;
  if (!claveIdempotenteValida(claveIdempotencia)) return { error: "Falta una clave idempotente válida." };
  const { data, error } = await db
    .from("gastos_empresariales")
    .insert({ account_id: accountId, ...entrada.valor, creado_por: userId, clave_idempotencia: claveIdempotencia })
    .select("id")
    .single();
  if (!error) return { id: Number(data.id), fecha: entrada.valor.fecha };
  if (error.code !== "23505") return { error: error.message };

  const repetido = await db
    .from("gastos_empresariales")
    .select("id, fecha, concepto, categoria, monto")
    .eq("account_id", accountId)
    .eq("clave_idempotencia", claveIdempotencia)
    .maybeSingle();
  if (repetido.error) return { error: repetido.error.message };
  if (!repetido.data) return { error: "No se pudo recuperar el gasto ya creado." };

  const original = repetido.data as any;
  const mismaPeticion =
    original.fecha === entrada.valor.fecha &&
    original.concepto === entrada.valor.concepto &&
    original.categoria === entrada.valor.categoria &&
    Number(original.monto) === entrada.valor.monto;
  if (!mismaPeticion) return { error: "La clave idempotente ya fue usada para otro gasto." };
  return { id: Number(original.id), fecha: original.fecha as string };
}

export async function importarGastoEmpresarial(db: DB, accountId: string, userId: string, b: any) {
  const entrada = validarEntrada(b);
  if (!entrada.valor) return { error: entrada.error };
  if (!claveImportacionValida(b?.claveImportacion)) return { error: "Falta una clave de importación válida." };
  const claveImportacion = b.claveImportacion.trim();

  // El id del archivo se ignora deliberadamente: PostgreSQL siempre genera el id interno.
  const { data, error } = await db
    .from("gastos_empresariales")
    .insert({
      account_id: accountId,
      ...entrada.valor,
      creado_por: userId,
      clave_importacion: claveImportacion,
    })
    .select("id")
    .single();
  if (!error) return { id: Number(data.id), fecha: entrada.valor.fecha };
  if (error.code !== "23505") return { error: error.message };

  const repetido = await db
    .from("gastos_empresariales")
    .select("id, fecha, concepto, categoria, monto")
    .eq("account_id", accountId)
    .eq("clave_importacion", claveImportacion)
    .maybeSingle();
  if (repetido.error) return { error: repetido.error.message };
  if (!repetido.data) return { error: "No se pudo recuperar el gasto ya importado." };

  const original = repetido.data as any;
  const mismaFila =
    original.fecha === entrada.valor.fecha &&
    original.concepto === entrada.valor.concepto &&
    original.categoria === entrada.valor.categoria &&
    Number(original.monto) === entrada.valor.monto;
  if (!mismaFila) return { error: "La clave de importación ya pertenece a otro gasto." };
  return { id: Number(original.id), fecha: original.fecha as string };
}

export async function editarGastoEmpresarial(db: DB, accountId: string, b: any) {
  const id = Number(b?.id);
  if (!Number.isFinite(id)) return { error: "Gasto inválido." };
  const entrada = validarEntrada(b);
  if (!entrada.valor) return { error: entrada.error };
  const { data: anterior } = await db.from("gastos_empresariales").select("fecha").eq("account_id", accountId).eq("id", id).maybeSingle();
  const { data, error } = await db
    .from("gastos_empresariales")
    .update(entrada.valor)
    .eq("account_id", accountId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Ese gasto ya no existe." };
  return { id, fecha: entrada.valor.fecha, fechaAnterior: anterior?.fecha as string | undefined };
}

export async function borrarGastoEmpresarial(db: DB, accountId: string, b: any) {
  const id = Number(b?.id);
  if (!Number.isFinite(id)) return { error: "Gasto inválido." };
  const { data } = await db.from("gastos_empresariales").select("fecha").eq("account_id", accountId).eq("id", id).maybeSingle();
  if (!data) return { error: "Ese gasto ya no existe." };
  const { error } = await db.from("gastos_empresariales").delete().eq("account_id", accountId).eq("id", id);
  return error ? { error: error.message } : { fecha: data.fecha as string };
}