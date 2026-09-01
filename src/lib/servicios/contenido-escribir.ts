/**
 * Lo que se guarda desde la sección de contenido.
 *
 * Va aparte de las rutas porque hay DOS puertas a la misma pantalla: la del
 * dueño (con sesión y RLS) y la del link sin contraseña (con service_role).
 * El cuerpo tiene que ser el mismo en las dos o tarde o temprano una se queda
 * atrás; las rutas solo se encargan de decidir quién entra y con qué cliente.
 */
import type { DB } from "../datos/repos";
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

/**
 * Guarda lo que se le anota a un modelo. Solo escribe las columnas que vengan
 * en el cuerpo: mandar solo la prioridad no puede borrar las notas.
 */
export async function guardarModelo(db: DB, accountId: string, body: any): Promise<Guardado> {
  const modelo = typeof body?.modelo === "string" ? body.modelo.trim().toUpperCase() : "";
  if (!modelo) return mal("Falta el modelo.");
  if (!enRangoContenido(modelo)) {
    return mal(`${modelo} no está en la lista de contenido (del GT054 en adelante, MY2307 y G650).`);
  }

  const fila: Record<string, unknown> = {
    account_id: accountId,
    modelo,
    actualizado_en: new Date().toISOString(),
  };

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
    .upsert(fila, { onConflict: "account_id,modelo" });
  return error ? traducir(error, "amazon_contenido") : BIEN;
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
    return error ? traducir(error, "amazon_categorias_store") : BIEN;
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
    return error ? traducir(error, "amazon_categorias_store") : BIEN;
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
  return error ? traducir(error, "amazon_categorias_store") : BIEN;
}
