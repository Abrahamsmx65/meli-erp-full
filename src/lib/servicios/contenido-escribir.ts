/**
 * Lo que se guarda desde la sección de contenido.
 *
 * Va aparte de las rutas porque hay DOS puertas a la misma pantalla: la del
 * dueño (con sesión y RLS) y la del link sin contraseña (con service_role).
 * El cuerpo tiene que ser el mismo en las dos o tarde o temprano una se queda
 * atrás; las rutas solo se encargan de decidir quién entra y con qué cliente.
 */
import type { DB } from "../datos/repos";
import { invalidarApp } from "./cache-app";
import { enRangoContenido } from "./contenido-amazon";

const TOPE_NOTAS = 2000;
const TOPE_NOMBRE = 80;

export interface Guardado {
  ok: boolean;
  error?: string;
  status?: number;
}

const BIEN: Guardado = { ok: true };
const mal = (error: string, status = 400): Guardado => ({ ok: false, error, status });

/** Traduce los errores de Postgres a algo que se entienda en pantalla. */
function traducir(error: { message: string; code?: string }, tabla: string): Guardado {
  if (error.message.includes(tabla) && error.message.includes("does not exist")) {
    return mal(`Falta aplicar la migración 0032 en Supabase (tabla ${tabla}).`, 500);
  }
  // Llave foránea contra las categorías de la store.
  if (error.code === "23503") {
    return mal("Esa categoría ya no existe. Vuelve a cargar la página.");
  }
  return mal(error.message, 500);
}

/** Cuántos códigos puede tocar una sola petición (grupos y asignación masiva). */
const TOPE_MODELOS = 300;

/**
 * Guarda lo que se le anota a uno o VARIOS modelos: la misma anotación se
 * escribe en todos los códigos que vengan. Es lo que mantiene de acuerdo a los
 * grupos (GT117…GT122 comparten publicación: palomear el grupo palomea a
 * todos) y lo que hace posible asignar la categoría en masa. Solo escribe las
 * columnas que vengan en el cuerpo: mandar solo la prioridad no borra las
 * notas.
 */
export async function guardarModelo(db: DB, accountId: string, body: any): Promise<Guardado> {
  const crudos: unknown[] = Array.isArray(body?.modelos)
    ? body.modelos
    : typeof body?.modelo === "string"
      ? [body.modelo]
      : [];
  const modelos = [
    ...new Set(
      crudos
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, TOPE_MODELOS);
  if (!modelos.length) return mal("Falta el modelo.");
  const fuera = modelos.find((m) => !enRangoContenido(m));
  if (fuera) {
    return mal(`${fuera} no está en la lista de contenido (del GT054 en adelante, MY2307 y G650).`);
  }

  const base: Record<string, unknown> = {
    account_id: accountId,
    actualizado_en: new Date().toISOString(),
  };
  const fila = base;

  if ("categoria" in body) {
    const c = typeof body.categoria === "string" ? body.categoria.trim() : "";
    fila.categoria = c === "" ? null : c;
  }
  if ("prioridad" in body) {
    const p = Math.round(Number(body.prioridad));
    fila.prioridad = Number.isFinite(p) ? Math.min(5, Math.max(0, p)) : 0;
  }
  if ("imagenes" in body) fila.imagenes = body.imagenes === true;
  if ("aplus" in body) fila.aplus = body.aplus === true;
  if ("eliminado" in body) fila.eliminado = body.eliminado === true;
  if ("notas" in body) {
    fila.notas = typeof body.notas === "string" ? body.notas.slice(0, TOPE_NOTAS) : "";
  }

  const { error } = await db
    .from("amazon_contenido")
    .upsert(modelos.map((modelo) => ({ ...fila, modelo })), { onConflict: "account_id,modelo" });
  if (error) return traducir(error, "amazon_contenido");
  // Lo palomeado debe verse al instante: fuera el contenido masticado.
  await invalidarApp(db, accountId, "Se editó el contenido de Amazon.", { prefijo: "contenido:" });
  return BIEN;
}

/** Alta, palomeos, renombrar y borrar de las categorías de la store. */
export async function guardarCategoria(db: DB, accountId: string, body: any): Promise<Guardado> {
  const accion = typeof body?.accion === "string" ? body.accion : "guardar";
  const nombre =
    typeof body?.nombre === "string" ? body.nombre.trim().slice(0, TOPE_NOMBRE) : "";
  if (!nombre) return mal("Falta el nombre de la categoría.");

  if (accion === "borrar") {
    // Los modelos que la tenían se quedan sin categoría (lo hace la llave
    // foránea), no con el nombre de algo que ya no existe.
    const { error } = await db
      .from("amazon_categorias_store")
      .delete()
      .eq("account_id", accountId)
      .eq("nombre", nombre);
    if (error) return traducir(error, "amazon_categorias_store");
    await invalidarApp(db, accountId, "Se editó el contenido de Amazon.", { prefijo: "contenido:" });
    return BIEN;
  }

  if (accion === "renombrar") {
    const nuevo =
      typeof body?.nuevoNombre === "string" ? body.nuevoNombre.trim().slice(0, TOPE_NOMBRE) : "";
    if (!nuevo) return mal("Falta el nombre nuevo.");
    // El `on update cascade` arrastra a los modelos que la tenían puesta.
    const { error } = await db
      .from("amazon_categorias_store")
      .update({ nombre: nuevo, actualizado_en: new Date().toISOString() })
      .eq("account_id", accountId)
      .eq("nombre", nombre);
    if (error?.code === "23505") return mal(`Ya existe una categoría "${nuevo}".`);
    if (error) return traducir(error, "amazon_categorias_store");
    await invalidarApp(db, accountId, "Se editó el contenido de Amazon.", { prefijo: "contenido:" });
    return BIEN;
  }

  const fila: Record<string, unknown> = {
    account_id: accountId,
    nombre,
    actualizado_en: new Date().toISOString(),
  };
  if ("creada" in body) fila.creada = body.creada === true;
  if ("imagenes" in body) fila.imagenes = body.imagenes === true;
  if ("paginaStore" in body) fila.pagina_store = body.paginaStore === true;
  if ("notas" in body) {
    fila.notas = typeof body.notas === "string" ? body.notas.slice(0, TOPE_NOTAS) : "";
  }

  const { error } = await db
    .from("amazon_categorias_store")
    .upsert(fila, { onConflict: "account_id,nombre" });
  if (error) return traducir(error, "amazon_categorias_store");
  await invalidarApp(db, accountId, "Se editó el contenido de Amazon.", { prefijo: "contenido:" });
  return BIEN;
}
