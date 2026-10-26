/**
 * Familias de modelos (tabla `modelos_familias`, migración 0148): lectura y
 * escritura. El motor puro vive en `pedidos-china/familias.ts`.
 */
import type { DB } from "../datos/repos";
import { armarMapaFamilias, listarFamilias, validarFamilia, type Familia, type MapaFamilias } from "../pedidos-china/familias";

export async function cargarFamilias(db: DB, accountId: string): Promise<MapaFamilias> {
  const { data, error } = await db.from("modelos_familias").select("modelo, familia").eq("account_id", accountId);
  if (error) throw new Error(`modelos_familias: ${error.message}`);
  return armarMapaFamilias((data ?? []) as { modelo: string; familia: string }[]);
}

export async function familiasDeCuenta(db: DB, accountId: string): Promise<Familia[]> {
  return listarFamilias(await cargarFamilias(db, accountId));
}

/**
 * Da de alta (o rehace) una familia: los modelos que se manden quedan en
 * ella y los que estaban y ya no vienen salen. Un modelo solo puede estar
 * en una familia: si venía de otra, se mueve.
 */
export async function guardarFamilia(db: DB, accountId: string, familia: string, modelos: string[]): Promise<Familia[]> {
  const v = validarFamilia(familia, modelos);
  const { error: e1 } = await db.from("modelos_familias").delete().eq("account_id", accountId).eq("familia", v.familia);
  if (e1) throw new Error(`No se pudo rehacer la familia: ${e1.message}`);
  const { error: e2 } = await db
    .from("modelos_familias")
    .upsert(
      v.modelos.map((modelo) => ({ account_id: accountId, modelo, familia: v.familia })),
      { onConflict: "account_id,modelo" },
    );
  if (e2) throw new Error(`No se pudo guardar la familia: ${e2.message}`);
  return familiasDeCuenta(db, accountId);
}

export async function quitarFamilia(db: DB, accountId: string, familia: string): Promise<Familia[]> {
  const nombre = String(familia ?? "").trim().toUpperCase();
  if (!nombre) throw new Error("Falta la familia.");
  const { error } = await db.from("modelos_familias").delete().eq("account_id", accountId).eq("familia", nombre);
  if (error) throw new Error(`No se pudo quitar la familia: ${error.message}`);
  return familiasDeCuenta(db, accountId);
}
