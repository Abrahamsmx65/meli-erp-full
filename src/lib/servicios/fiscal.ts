/**
 * Datos fiscales de las publicaciones (solo México).
 *
 * MELI expone la información fiscal en un API GraphQL aparte
 * (fiscal_information/graphql, documentado en "Envío de datos fiscales").
 * La lectura masiva va POR PUBLICACIÓN: getFiscalInformationsByItem con
 * allVariations trae lo fiscal de todas las variantes en una sola llamada
 * (~15 SKUs por POST). La escritura va POR SKU con updateFiscalInformationMLM,
 * que acepta actualización parcial.
 *
 * La respuesta es un tipo por país: los campos de México exigen el fragmento
 * ... on FiscalInformationMLM (confirmado contra el API real; la
 * introspección la bloquea el PolicyAgent).
 */
import { traerTodo, upsertEnTandas, type DB } from "../datos/repos";
import type { MeliClient } from "../meli/client";

export const RUTA_FISCAL = "/fiscal_information/graphql";

export const CONSULTA_POR_ITEM = `query PorItem($itemId: String!, $allVariations: Boolean) {
  getFiscalInformationsByItem(itemId: $itemId, allVariations: $allVariations) {
    itemId
    variationId
    type
    components {
      sku
      quantity
      percentageShare
      fiscalInformation {
        __typename
        ... on FiscalInformationMLM {
          sku
          sat
          upc
          iva
          ieps
          description
          measureUnit
          measureUnitDescription
        }
      }
    }
  }
}`;

export const MUTACION_MLM = `mutation Actualizar($where: FiscalInformationWhereInput!, $input: UpdateFiscalInformationMLMInput!) {
  updateFiscalInformationMLM(where: $where, input: $input) {
    __typename
    ... on FiscalInformationMLM {
      sku
      sat
      iva
      ieps
      measureUnit
      measureUnitDescription
    }
  }
}`;

export interface FilaFiscal {
  sku: string;
  itemId: string;
  variationId: string | null;
  sat: string | null;
  iva: string | null;
  ieps: number | null;
  upc: string | null;
  descripcion: string | null;
  unidad: string | null;
  unidadDesc: string | null;
}

export interface ValoresFiscales {
  sat?: string;
  iva?: string;
  ieps?: number;
  unidad?: string;
}

interface RespuestaPorItem {
  data?: {
    getFiscalInformationsByItem?: {
      itemId?: string;
      variationId?: string | null;
      components?: {
        sku?: string | null;
        fiscalInformation?: {
          sku?: string | null;
          sat?: string | null;
          upc?: string | null;
          iva?: string | null;
          ieps?: number | null;
          description?: string | null;
          measureUnit?: string | null;
          measureUnitDescription?: string | null;
        } | null;
      }[];
    }[];
  };
  errors?: { message?: string }[];
}

/** Un SKU "tiene la info cargada" cuando MELI ya guarda su clave SAT. */
export function tieneDatos(f: Pick<FilaFiscal, "sat">): boolean {
  return Boolean(f.sat && String(f.sat).trim());
}

/**
 * Aplana la respuesta de getFiscalInformationsByItem a una fila por SKU.
 * Los kits traen varios components por variante: sale una fila por cada uno.
 * Un componente sin SKU no se puede amarrar y se descarta (contado aparte).
 */
export function normalizarRespuestaItem(
  itemId: string,
  respuesta: unknown,
): { filas: FilaFiscal[]; sinSku: number } {
  const r = respuesta as RespuestaPorItem;
  if (r?.errors?.length) {
    throw new Error(
      `MELI rechazó la consulta fiscal de ${itemId}: ${r.errors
        .map((e) => e.message ?? "")
        .join("; ")
        .slice(0, 400)}`,
    );
  }

  const variantes = r?.data?.getFiscalInformationsByItem ?? [];
  const porSku = new Map<string, FilaFiscal>();
  let sinSku = 0;

  for (const v of variantes) {
    for (const c of v.components ?? []) {
      const sku = (c.sku ?? c.fiscalInformation?.sku ?? "").trim();
      if (!sku) {
        sinSku++;
        continue;
      }
      const fi = c.fiscalInformation;
      porSku.set(sku, {
        sku,
        itemId: v.itemId ?? itemId,
        variationId: v.variationId ?? null,
        sat: fi?.sat ?? null,
        iva: fi?.iva ?? null,
        ieps: typeof fi?.ieps === "number" ? fi.ieps : null,
        upc: fi?.upc ?? null,
        descripcion: fi?.description ?? null,
        unidad: fi?.measureUnit ?? null,
        unidadDesc: fi?.measureUnitDescription ?? null,
      });
    }
  }

  return { filas: [...porSku.values()], sinSku };
}

/**
 * Arma las variables de la mutación con actualización PARCIAL: solo viajan
 * los campos capturados. La unidad va con su descripción (MELI guarda ambas).
 */
export function construirVariablesMutacion(
  sku: string,
  valores: ValoresFiscales,
): { where: { sku: string }; input: Record<string, string | number> } {
  const input: Record<string, string | number> = {};
  if (valores.sat !== undefined) input.sat = valores.sat;
  if (valores.iva !== undefined) input.iva = valores.iva;
  if (valores.ieps !== undefined) input.ieps = valores.ieps;
  if (valores.unidad !== undefined) {
    input.measureUnit = valores.unidad;
    input.measureUnitDescription = DESCRIPCION_UNIDAD[valores.unidad] ?? valores.unidad;
  }
  if (!Object.keys(input).length) {
    throw new Error(`No hay ningún valor fiscal que mandar para ${sku}.`);
  }
  return { where: { sku }, input };
}

/** Unidades del catálogo c_ClaveUnidad del SAT que se usan en calzado. */
export const DESCRIPCION_UNIDAD: Record<string, string> = {
  H87: "UN",
  XPR: "Par",
  EA: "Elemento",
};

/**
 * Valida lo capturado por modelo antes de encolarlo. Regresa el mensaje de
 * error o null si todo cuadra. La clave SAT son 8 dígitos del catálogo
 * c_ClaveProdServ; el IVA en México es 0, 8 o 16.
 */
export function validarValores(v: ValoresFiscales): string | null {
  if (v.sat === undefined || !/^\d{8}$/.test(v.sat)) {
    return "La clave SAT debe ser de 8 dígitos (catálogo c_ClaveProdServ).";
  }
  if (v.iva !== undefined && !["0", "8", "16"].includes(v.iva)) {
    return "El IVA debe ser 0, 8 o 16.";
  }
  if (v.ieps !== undefined && (!Number.isFinite(v.ieps) || v.ieps < 0 || v.ieps > 100)) {
    return "El IEPS debe ser un porcentaje entre 0 y 100.";
  }
  if (v.unidad !== undefined && !/^[A-Z0-9]{1,4}$/.test(v.unidad)) {
    return "La unidad debe ser una clave del catálogo del SAT (H87, XPR…).";
  }
  return null;
}

/** Pausa corta entre llamadas para no toparse con el límite de tasa. */
function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ResultadoLectura {
  itemsLeidos: number;
  skusLeidos: number;
  sinDatos: number;
  itemsRestantes: number;
  errores: string[];
}

/**
 * Lee de MELI la información fiscal de los items del catálogo que aún no
 * tienen todas sus filas en `datos_fiscales`. Trabaja hasta que `sigue()`
 * diga que no (presupuesto de tiempo) y reporta cuántos items quedaron:
 * el que llama decide si se relanza.
 *
 * Una fila en estado `pendiente` o `error` no se pisa: trae captura del
 * usuario que todavía no llega a MELI.
 */
export async function leerFiscalFaltante(
  db: DB,
  cliente: MeliClient,
  accountId: string,
  sigue: () => boolean,
): Promise<ResultadoLectura> {
  // Sin traerTodo, Supabase corta en 1000 renglones y el resto del catálogo
  // quedaría invisible para la lectura.
  const skus = await traerTodo<{ sku: string; item_id: string }>(
    db,
    "skus",
    "sku, item_id",
    (q) => q.eq("account_id", accountId).eq("activo", true).not("item_id", "is", null),
  );
  const existentes = await traerTodo<{
    sku: string;
    estado: string;
    leido_en: string | null;
  }>(db, "datos_fiscales", "sku, estado, leido_en", (q) => q.eq("account_id", accountId));

  const yaLeido = new Set(
    (existentes ?? []).filter((e) => e.leido_en).map((e) => e.sku as string),
  );
  const enCola = new Set(
    (existentes ?? [])
      .filter((e) => e.estado === "pendiente" || e.estado === "error")
      .map((e) => e.sku as string),
  );

  // Items con al menos un SKU del catálogo todavía sin leer.
  const porItem = new Map<string, string[]>();
  for (const s of skus ?? []) {
    const item = s.item_id as string;
    const lista = porItem.get(item) ?? [];
    lista.push(s.sku as string);
    porItem.set(item, lista);
  }
  const pendientes = [...porItem.entries()]
    .filter(([, lista]) => lista.some((sku) => !yaLeido.has(sku)))
    .map(([item]) => item);

  const resultado: ResultadoLectura = {
    itemsLeidos: 0,
    skusLeidos: 0,
    sinDatos: 0,
    itemsRestantes: pendientes.length,
    errores: [],
  };

  for (const itemId of pendientes) {
    if (!sigue()) break;
    try {
      const respuesta = await cliente.post(RUTA_FISCAL, {
        query: CONSULTA_POR_ITEM,
        variables: { itemId, allVariations: true },
      });
      const { filas } = normalizarRespuestaItem(itemId, respuesta);
      const ahora = new Date().toISOString();

      // La captura en cola no se pisa; lo demás se refresca completo.
      const nuevas = filas.filter((f) => !enCola.has(f.sku));
      if (nuevas.length) {
        await upsertEnTandas(
          db,
          "datos_fiscales",
          nuevas.map((f) => ({
            account_id: accountId,
            sku: f.sku,
            item_id: f.itemId,
            variation_id: f.variationId,
            sat: f.sat,
            iva: f.iva,
            ieps: f.ieps,
            upc: f.upc,
            descripcion: f.descripcion,
            unidad: f.unidad,
            unidad_desc: f.unidadDesc,
            leido_en: ahora,
            estado: tieneDatos(f) ? "ok" : "sin_datos",
            actualizado_en: ahora,
          })),
          "account_id,sku",
        );
      }

      resultado.itemsLeidos++;
      resultado.skusLeidos += filas.length;
      resultado.sinDatos += filas.filter((f) => !tieneDatos(f)).length;
      resultado.itemsRestantes--;
      filas.forEach((f) => yaLeido.add(f.sku));
    } catch (err) {
      resultado.errores.push(`${itemId}: ${(err as Error).message.slice(0, 200)}`);
      resultado.itemsRestantes--;
      // Un item que truena no detiene la corrida; queda contado y visible.
    }
    await dormir(250);
  }

  return resultado;
}

/**
 * Enciende el proceso fiscal en segundo plano (contesta 202 y trabaja
 * después). Mismo esquema que los SKUs pendientes: de servidor a servidor con
 * CRON_SECRET y, si falta, con las cookies de la sesión que disparó.
 */
export async function dispararProcesoFiscal(
  origen: string,
  cookies?: string | null,
): Promise<void> {
  const secreto = process.env.CRON_SECRET;
  try {
    if (secreto) {
      await fetch(`${origen}/api/fiscal/procesar`, {
        method: "POST",
        headers: { authorization: `Bearer ${secreto}` },
        signal: AbortSignal.timeout(10_000),
      });
      return;
    }
    if (cookies) {
      await fetch(`${origen}/api/fiscal/procesar`, {
        method: "GET",
        headers: { cookie: cookies },
        signal: AbortSignal.timeout(10_000),
      });
      return;
    }
    console.error(
      "dispararProcesoFiscal: falta CRON_SECRET y no hay sesión; el proceso queda apagado.",
    );
  } catch (err) {
    console.error("dispararProcesoFiscal: no prendió:", (err as Error).message);
  }
}

export interface ResultadoEnvio {
  enviados: number;
  fallidos: number;
  restantes: number;
}

/**
 * Empuja a MELI las filas encoladas (estado `pendiente`) con la mutación
 * documentada. Solo cuando MELI confirma, los valores nuevos pasan a ser los
 * valores reales de la fila; si rechaza, el error queda textual en la fila.
 */
export async function enviarFiscalPendiente(
  db: DB,
  cliente: MeliClient,
  accountId: string,
  sigue: () => boolean,
): Promise<ResultadoEnvio> {
  const { data: cola, error } = await db
    .from("datos_fiscales")
    .select("sku, sat_nuevo, iva_nuevo, ieps_nuevo, unidad_nueva")
    .eq("account_id", accountId)
    .eq("estado", "pendiente")
    .order("sku")
    .limit(2000);
  if (error) throw new Error(`datos_fiscales: ${error.message}`);

  const resultado: ResultadoEnvio = {
    enviados: 0,
    fallidos: 0,
    restantes: cola?.length ?? 0,
  };

  for (const fila of cola ?? []) {
    if (!sigue()) break;
    const valores: ValoresFiscales = {};
    if (fila.sat_nuevo != null) valores.sat = fila.sat_nuevo as string;
    if (fila.iva_nuevo != null) valores.iva = fila.iva_nuevo as string;
    if (fila.ieps_nuevo != null) valores.ieps = Number(fila.ieps_nuevo);
    if (fila.unidad_nueva != null) valores.unidad = fila.unidad_nueva as string;

    const ahora = new Date().toISOString();
    try {
      const variables = construirVariablesMutacion(fila.sku as string, valores);
      const respuesta = (await cliente.post(RUTA_FISCAL, {
        query: MUTACION_MLM,
        variables,
      })) as { errors?: { message?: string }[] };
      if (respuesta?.errors?.length) {
        throw new Error(
          respuesta.errors.map((e) => e.message ?? "").join("; ").slice(0, 400),
        );
      }

      await db
        .from("datos_fiscales")
        .update({
          sat: valores.sat ?? undefined,
          iva: valores.iva ?? undefined,
          ieps: valores.ieps ?? undefined,
          unidad: valores.unidad ?? undefined,
          unidad_desc: valores.unidad
            ? DESCRIPCION_UNIDAD[valores.unidad] ?? valores.unidad
            : undefined,
          estado: "ok",
          sat_nuevo: null,
          iva_nuevo: null,
          ieps_nuevo: null,
          unidad_nueva: null,
          ultimo_error: null,
          enviado_en: ahora,
          actualizado_en: ahora,
        })
        .eq("account_id", accountId)
        .eq("sku", fila.sku);
      resultado.enviados++;
    } catch (err) {
      await db
        .from("datos_fiscales")
        .update({
          estado: "error",
          ultimo_error: (err as Error).message.slice(0, 500),
          actualizado_en: ahora,
        })
        .eq("account_id", accountId)
        .eq("sku", fila.sku);
      resultado.fallidos++;
    }
    resultado.restantes--;
    await dormir(250);
  }

  return resultado;
}
