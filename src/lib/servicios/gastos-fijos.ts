import type { DB } from "../datos/repos";

/**
 * Gastos FIJOS del negocio (dueño, 9-oct-2026: «mis gastos regularmente son
 * nóminas, fletes, rentas y logística a 3PL; la mayoría son los mismos todos
 * los meses»). Se dan de alta UNA vez como plantilla (`gastos_fijos`) y cada
 * mes se materializa su renglón en `gastos_empresariales` (día 1 del mes,
 * `gasto_fijo_id`), que se puede corregir para ese mes (`editado`) u omitir
 * (`omitido`). Cambiar la plantilla corrige del mes en curso en adelante;
 * los meses pasados se quedan como estaban.
 *
 * En el mes EN CURSO el corte cuenta el gasto fijo en proporción a los días
 * transcurridos (decisión del dueño): al día 10 de un mes de 30, un tercio.
 * Así la utilidad del mes en curso y la comparación «mismos días del mes
 * anterior» son parejas. Un gasto suelto cuenta completo en su fecha.
 */

export const CATEGORIAS_GASTO = ["Nómina", "Fletes", "Renta", "Logística 3PL", "Servicios", "Otros"] as const;

export interface GastoFijo {
  id: number;
  concepto: string;
  categoria: string;
  monto: number;
  /** primer mes en que aplica (YYYY-MM) */
  desde: string;
  /** último mes en que aplica (YYYY-MM); null = sigue */
  hasta: string | null;
}

/** Hoy en México (UTC−6 fijo, como el resto del ERP). */
export function hoyMx(): string {
  return new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
}

export function periodoDe(fecha: string): string {
  return fecha.slice(0, 7);
}

export function diasDelMes(periodo: string): number {
  const [a, m] = periodo.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

export function finDelMes(periodo: string): string {
  return `${periodo}-${String(diasDelMes(periodo)).padStart(2, "0")}`;
}

export function mesSiguiente(periodo: string, n = 1): string {
  const [a, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Los meses en que aplica un gasto fijo, hasta `tope` (incluido). */
export function mesesDelFijo(fijo: Pick<GastoFijo, "desde" | "hasta">, tope: string): string[] {
  const ultimo = fijo.hasta && fijo.hasta < tope ? fijo.hasta : tope;
  const meses: string[] = [];
  for (let p = fijo.desde; p <= ultimo && meses.length < 600; p = mesSiguiente(p)) meses.push(p);
  return meses;
}

/**
 * Qué parte del mes `periodo` cae en el rango [desde, hasta] — sin pasar de
 * hoy —, en días ÷ días del mes. Un mes cerrado y completo en el rango da 1.
 */
export function proporcionDelMes(periodo: string, desde: string, hasta: string, hoy = hoyMx()): number {
  const inicio = `${periodo}-01`;
  const fin = finDelMes(periodo);
  const a = desde > inicio ? desde : inicio;
  let b = hasta < fin ? hasta : fin;
  if (hoy < b) b = hoy;
  if (b < a) return 0;
  const dias = (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000 + 1;
  return Math.min(1, dias / diasDelMes(periodo));
}

function validarFijo(b: any): { valor?: Omit<GastoFijo, "id">; error?: string } {
  const concepto = typeof b?.concepto === "string" ? b.concepto.trim().slice(0, 200) : "";
  const categoria = typeof b?.categoria === "string" ? b.categoria.trim().slice(0, 80) : "";
  const monto = Number(b?.monto);
  const desde = typeof b?.desde === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.desde) ? b.desde : "";
  if (!concepto) return { error: "Falta el concepto." };
  if (!categoria) return { error: "Falta la categoría." };
  if (!Number.isFinite(monto) || monto <= 0) return { error: "El monto debe ser mayor que cero." };
  if (!desde) return { error: "Falta el mes desde el que aplica." };
  return { valor: { concepto, categoria, monto: Math.round(monto * 100) / 100, desde, hasta: null } };
}

function deFila(f: any): GastoFijo {
  return {
    id: Number(f.id),
    concepto: f.concepto,
    categoria: f.categoria,
    monto: Number(f.monto) || 0,
    desde: String(f.desde).slice(0, 7),
    hasta: f.hasta ? String(f.hasta).slice(0, 7) : null,
  };
}

export async function listarGastosFijos(db: DB, accountId: string): Promise<GastoFijo[]> {
  const { data, error } = await db
    .from("gastos_fijos")
    .select("id, concepto, categoria, monto, desde, hasta")
    .eq("account_id", accountId)
    .order("categoria", { ascending: true })
    .order("concepto", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`No se pudieron leer los gastos fijos: ${error.message}`);
  return (data ?? []).map(deFila);
}

/**
 * Deja creado el renglón de cada gasto fijo en cada mes que le toca, hasta
 * `tope` (YYYY-MM, nunca más allá del mes en curso). Idempotente: lo que ya
 * existe —editado u omitido— no se toca.
 */
export async function asegurarGastosFijos(db: DB, accountId: string, tope: string, fijos?: GastoFijo[]): Promise<number> {
  const mesActual = periodoDe(hoyMx());
  const hasta = tope < mesActual ? tope : mesActual;
  const lista = fijos ?? (await listarGastosFijos(db, accountId));
  const filas: Record<string, unknown>[] = [];
  for (const f of lista) {
    for (const p of mesesDelFijo(f, hasta)) {
      filas.push({
        account_id: accountId,
        gasto_fijo_id: f.id,
        fecha: `${p}-01`,
        concepto: f.concepto,
        categoria: f.categoria,
        monto: f.monto,
      });
    }
  }
  if (!filas.length) return 0;
  const { error } = await db
    .from("gastos_empresariales")
    .upsert(filas, { onConflict: "account_id,gasto_fijo_id,fecha", ignoreDuplicates: true });
  if (error) throw new Error(`No se pudieron preparar los gastos fijos del mes: ${error.message}`);
  return filas.length;
}

export async function crearGastoFijo(db: DB, accountId: string, b: any): Promise<{ id?: number; error?: string }> {
  const v = validarFijo(b);
  if (!v.valor) return { error: v.error };
  const { data, error } = await db
    .from("gastos_fijos")
    .insert({ account_id: accountId, ...v.valor, desde: `${v.valor.desde}-01`, hasta: null })
    .select("id, concepto, categoria, monto, desde, hasta")
    .single();
  if (error) return { error: error.message };
  const fijo = deFila(data);
  await asegurarGastosFijos(db, accountId, periodoDe(hoyMx()), [fijo]);
  return { id: fijo.id };
}

/**
 * Cambia la plantilla. Del mes en curso en adelante, los renglones que el
 * dueño no corrigió a mano toman los datos nuevos; los meses pasados se
 * quedan como se cobraron. Si el «desde» se mueve, los meses que quedan
 * fuera y nadie corrigió se quitan, y los que entran se crean.
 */
export async function editarGastoFijo(db: DB, accountId: string, b: any): Promise<{ id?: number; error?: string }> {
  const id = Number(b?.id);
  if (!Number.isFinite(id)) return { error: "Gasto fijo inválido." };
  const v = validarFijo(b);
  if (!v.valor) return { error: v.error };
  const { data, error } = await db
    .from("gastos_fijos")
    .update({
      concepto: v.valor.concepto,
      categoria: v.valor.categoria,
      monto: v.valor.monto,
      desde: `${v.valor.desde}-01`,
      actualizado_en: new Date().toISOString(),
    })
    .eq("account_id", accountId)
    .eq("id", id)
    .select("id, concepto, categoria, monto, desde, hasta")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Ese gasto fijo ya no existe." };
  const fijo = deFila(data);
  const mesActual = periodoDe(hoyMx());

  const { error: e1 } = await db
    .from("gastos_empresariales")
    .update({ concepto: fijo.concepto, categoria: fijo.categoria, monto: fijo.monto })
    .eq("account_id", accountId)
    .eq("gasto_fijo_id", id)
    .eq("editado", false)
    .gte("fecha", `${mesActual}-01`);
  if (e1) return { error: e1.message };
  const { error: e2 } = await db
    .from("gastos_empresariales")
    .delete()
    .eq("account_id", accountId)
    .eq("gasto_fijo_id", id)
    .eq("editado", false)
    .lt("fecha", `${fijo.desde}-01`);
  if (e2) return { error: e2.message };
  await asegurarGastosFijos(db, accountId, mesActual, [fijo]);
  return { id };
}

/**
 * Deja de aplicar desde `desde` (YYYY-MM; por omisión el mes en curso): el
 * último mes es el anterior. Lo de ese mes en adelante que nadie corrigió se
 * quita; lo pasado se queda. Si nunca llegó a aplicar, la plantilla se borra.
 */
export async function darDeBajaGastoFijo(db: DB, accountId: string, b: any): Promise<{ ok?: true; error?: string }> {
  const id = Number(b?.id);
  if (!Number.isFinite(id)) return { error: "Gasto fijo inválido." };
  const desde = typeof b?.desde === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.desde) ? b.desde : periodoDe(hoyMx());
  const { data: actual, error: e0 } = await db
    .from("gastos_fijos")
    .select("id, desde")
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (e0) return { error: e0.message };
  if (!actual) return { error: "Ese gasto fijo ya no existe." };

  const { error: e1 } = await db
    .from("gastos_empresariales")
    .delete()
    .eq("account_id", accountId)
    .eq("gasto_fijo_id", id)
    .eq("editado", false)
    .gte("fecha", `${desde}-01`);
  if (e1) return { error: e1.message };

  const ultimo = mesSiguiente(desde, -1);
  const r =
    ultimo < String(actual.desde).slice(0, 7)
      ? await db.from("gastos_fijos").delete().eq("account_id", accountId).eq("id", id)
      : await db
          .from("gastos_fijos")
          .update({ hasta: `${ultimo}-01`, actualizado_en: new Date().toISOString() })
          .eq("account_id", accountId)
          .eq("id", id);
  return r.error ? { error: r.error.message } : { ok: true };
}
