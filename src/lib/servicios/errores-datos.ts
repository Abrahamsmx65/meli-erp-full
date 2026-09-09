/** Convierte errores de Supabase/PostgREST en mensajes estables para la UI. */
export function mensajeErrorDatos(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Error de datos");
  }
  return String(error ?? "Error de datos");
}

/** Contrato común para lecturas que distinguen ausencia de un fallo observable. */
export type ResultadoLecturaDatos<T> =
  | { estado: "encontrado"; valor: T }
  | { estado: "ausente" }
  | { estado: "fallo"; error: Error };

function codigoError(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code?: unknown }).code ?? "").toUpperCase();
}

/**
 * Los respaldos por esquema viejo sólo deben correr cuando Postgres confirma
 * que falta una columna concreta. Red, permisos y timeouts no son "legacy".
 */
export function esErrorColumnaLegacy(
  error: unknown,
  columnas: readonly string[],
): boolean {
  const codigo = codigoError(error);
  const mensaje = mensajeErrorDatos(error);
  const mencionaColumna = columnas.some((columna) =>
    new RegExp(`(?:column|columna|field|campo)[^\\n]*["'.]?${columna}["'.]?`, "i").test(
      mensaje,
    ),
  );
  return (codigo === "42703" || codigo === "PGRST204") && mencionaColumna;
}

/** Tablas/RPC opcionales introducidos por migraciones conocidas. */
export function esErrorObjetoLegacy(
  error: unknown,
  nombres: readonly string[],
): boolean {
  const codigo = codigoError(error);
  const mensaje = mensajeErrorDatos(error);
  const mencionaObjeto = nombres.some((nombre) => mensaje.toLowerCase().includes(nombre.toLowerCase()));
  const codigoAusente = ["42P01", "42883", "PGRST202", "PGRST205"].includes(codigo);
  return mencionaObjeto && codigoAusente;
}

/**
 * Traduce el error de lectura de una tabla opcional al contrato compartido:
 * una tabla legacy aún no migrada es ausencia; cualquier otro error se expone.
 */
export function resultadoErrorLecturaCache(
  tabla: string,
  clave: string,
  error: unknown,
): ResultadoLecturaDatos<never> {
  if (esErrorObjetoLegacy(error, [tabla])) return { estado: "ausente" };
  const fallo = new Error(
    `No se pudo leer ${tabla} (${clave}): ${mensajeErrorDatos(error)}`,
  );
  console.error(fallo.message);
  return { estado: "fallo", error: fallo };
}