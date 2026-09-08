/**
 * Envíos a Full dados de alta en Mercado Libre.
 *
 * MELI no expone la Gestión de envíos por API, así que el sistema no tiene
 * forma de enterarse solo de que un envío ya se despachó — y ese hueco es
 * caro: miles de pares "confirmados" que ni descuentan bodega ni cuentan
 * como en camino, con el plan sugiriendo mandar las mismas cajas otra vez.
 *
 * La salida es un clic: la app ya sabe exactamente qué cajas trae cada envío
 * (ella los arma), así que "ya lo di de alta en MELI" registra el envío
 * completo en `envios_full`/`envio_cajas`.
 *
 * REGLA NO NEGOCIABLE: estos envíos SOLO alimentan cálculos. Sus pares
 * cuentan como "en camino" en la posición del plan; NUNCA descuentan
 * inventario de bodega (el inventario sale del reporte del almacén). A los
 * 7 días caducan solos y se quedan visibles como caducados.
 */
import type { DB } from "../datos/repos";
import type { StockFull } from "../engine/types";
import type { EnvioSeparado } from "./envios";

/**
 * A los cuántos días un envío en camino CADUCA solo. Para entonces el stock
 * ya debe estar en Full y contado por MELI: seguirlo sumando duplicaría.
 * Los caducados se quedan visibles en la lista, marcados, por si algo no
 * llegó y hay que reclamarlo.
 */
const DIAS_CADUCIDAD = 7;

export interface EnvioRegistrado {
  id: string;
  folio: string | null;
  bodegas: string[];
  cajas: number;
  pares: number;
  enviadoEn: string;
  estado: "enviado" | "caducado" | "recibido";
  detalleCajas: {
    cajaCodigo: string;
    almacen: string | null;
    skuCaja: string | null;
    pedido: string | null;
    cantidad: number;
    pares: number;
    /** aporte por SKU: [{ sku, talla, paresTotales }] */
    detalle: { sku: string; talla: string; paresTotales: number }[];
  }[];
}

export async function registrarEnvio(
  db: DB,
  accountId: string,
  envio: EnvioSeparado,
): Promise<string> {
  const { data: cabecera, error } = await db
    .from("envios_full")
    .insert({
      account_id: accountId,
      folio: null,
      bodegas: envio.almacenes,
      estado: "enviado",
      cajas: envio.totalCajas,
      pares: envio.totalPares,
      notas: `Registrado desde el plan (${envio.nombre})`,
      enviado_en: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !cabecera) {
    throw new Error(`No se pudo registrar el envío: ${error?.message ?? "sin id"}`);
  }

  const filas = envio.cajas.map((c) => ({
    envio_id: cabecera.id,
    caja_codigo: c.codigo,
    almacen: c.almacen,
    sku_caja: c.skuCaja,
    pedido: c.pedido,
    modelo: c.modelo,
    color: c.color,
    talla: c.talla,
    cantidad: c.cantidad,
    pares: c.paresTotales,
    detalle: c.aporta,
  }));
  const { error: errCajas } = await db.from("envio_cajas").insert(filas);
  if (errCajas) {
    // Sin cajas el registro no sirve: se limpia para poder reintentar.
    await db.from("envios_full").delete().eq("id", cabecera.id);
    throw new Error(`No se pudieron registrar las cajas: ${errCajas.message}`);
  }

  return cabecera.id as string;
}

/**
 * Registra un envío que YA va en camino, capturado a mano: folio de MELI y
 * la lista de SKU + pares. Es para los envíos dados de alta antes de que
 * existiera el botón, o armados fuera del plan. Sus pares cuentan como en
 * camino igual que los registrados con un clic.
 */
export async function registrarEnvioManual(
  db: DB,
  accountId: string,
  folio: string,
  renglones: { sku: string; pares: number }[],
): Promise<string> {
  const pares = renglones.reduce((a, r) => a + r.pares, 0);
  const { data: cabecera, error } = await db
    .from("envios_full")
    .insert({
      account_id: accountId,
      folio: folio || null,
      bodegas: [],
      estado: "enviado",
      cajas: 0,
      pares,
      notas: "Registrado a mano (envío ya dado de alta en MELI)",
      enviado_en: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !cabecera) {
    throw new Error(`No se pudo registrar el envío: ${error?.message ?? "sin id"}`);
  }

  const { error: errCajas } = await db.from("envio_cajas").insert(
    renglones.map((r) => ({
      envio_id: cabecera.id,
      caja_codigo: `manual|${r.sku}`,
      almacen: null,
      sku_caja: null,
      pedido: null,
      modelo: null,
      color: null,
      talla: null,
      cantidad: 0,
      pares: r.pares,
      detalle: [{ sku: r.sku, talla: "", paresTotales: r.pares }],
    })),
  );
  if (errCajas) {
    await db.from("envios_full").delete().eq("id", cabecera.id);
    throw new Error(`No se pudieron registrar los renglones: ${errCajas.message}`);
  }

  return cabecera.id as string;
}

export async function marcarRecibido(db: DB, envioId: string): Promise<void> {
  const { error } = await db
    .from("envios_full")
    .update({ estado: "recibido", notas: "Marcado como recibido" })
    .eq("id", envioId);
  if (error) throw new Error(error.message);
}

/**
 * Envíos que siguen en camino (los que cuentan para el plan). De paso caduca
 * solos los que ya pasaron del plazo.
 */
export async function enviosActivos(db: DB, accountId: string): Promise<EnvioRegistrado[]> {
  const corte = new Date(Date.now() - DIAS_CADUCIDAD * 86_400_000).toISOString();
  await db
    .from("envios_full")
    .update({
      estado: "caducado",
      notas: `Caducó a los ${DIAS_CADUCIDAD} días: el stock ya debe estar en Full`,
    })
    .eq("account_id", accountId)
    .eq("estado", "enviado")
    .lt("enviado_en", corte);

  return leerEnvios(db, accountId, ["enviado"]);
}

/**
 * Lo que se pinta en pantalla: los que van en camino Y los que caducaron
 * hace poco, para que se vea qué pasó con cada uno.
 *
 * SOLO LECTURA: la lista muestra 7 campos de cabecera, así que no baja el
 * detalle por caja (jsonb de cientos de KB que se tiraba), y ya no caduca
 * aquí — un GET no debe escribir. La caducidad la aplica `enviosActivos`,
 * que corre con cada recálculo del plan en el fondo (latido).
 */
export async function enviosParaPantalla(
  db: DB,
  accountId: string,
): Promise<EnvioRegistrado[]> {
  const todos = await leerEnvios(db, accountId, ["enviado", "caducado", "recibido"], undefined, {
    conDetalle: false,
  });
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const corte = new Date(Date.now() - DIAS_CADUCIDAD * 86_400_000).toISOString();
  return todos
    .map((e) =>
      // Si el fondo aún no lo marcó, la pantalla lo PINTA como caducado igual
      // (el dato manda, no el momento del UPDATE).
      e.estado === "enviado" && e.enviadoEn < corte ? { ...e, estado: "caducado" as const } : e,
    )
    .filter((e) => e.estado === "enviado" || e.enviadoEn >= hace30);
}

async function leerEnvios(
  db: DB,
  accountId: string,
  estados: string[],
  ultimosDias?: number,
  opts?: { conDetalle?: boolean },
): Promise<EnvioRegistrado[]> {
  const conDetalle = opts?.conDetalle !== false;
  let q = db
    .from("envios_full")
    .select(
      conDetalle
        ? "id, folio, bodegas, cajas, pares, enviado_en, estado, envio_cajas(caja_codigo, almacen, sku_caja, pedido, cantidad, pares, detalle)"
        : "id, folio, bodegas, cajas, pares, enviado_en, estado",
    )
    .eq("account_id", accountId)
    .in("estado", estados)
    .order("enviado_en", { ascending: false });
  if (ultimosDias) {
    q = q.gte("enviado_en", new Date(Date.now() - ultimosDias * 86_400_000).toISOString());
  }
  const { data } = await q;

  return (data ?? []).map((e: any) => ({
    id: e.id,
    folio: e.folio,
    bodegas: e.bodegas ?? [],
    cajas: e.cajas ?? 0,
    pares: e.pares ?? 0,
    enviadoEn: e.enviado_en,
    estado: e.estado ?? "enviado",
    detalleCajas: (e.envio_cajas ?? []).map((c: any) => ({
      cajaCodigo: c.caja_codigo,
      almacen: c.almacen,
      skuCaja: c.sku_caja,
      pedido: c.pedido,
      cantidad: c.cantidad ?? 0,
      pares: c.pares ?? 0,
      detalle: Array.isArray(c.detalle) ? c.detalle : [],
    })),
  }));
}

/**
 * Suma a la posición del plan los pares que van en camino por envíos
 * registrados. Se toma el MÁXIMO entre lo que MELI ya reporta en tránsito y
 * lo registrado: cuando MELI recolecta, su "transfer" ES este envío — sumar
 * ambos contaría el mismo par dos veces.
 */
export function sumarEnCamino(
  stockActual: StockFull[],
  envios: EnvioRegistrado[],
): StockFull[] {
  const manual = new Map<string, number>();
  for (const e of envios) {
    for (const c of e.detalleCajas) {
      for (const d of c.detalle) {
        manual.set(d.sku, (manual.get(d.sku) ?? 0) + (d.paresTotales ?? 0));
      }
    }
  }
  if (!manual.size) return stockActual;

  const porSku = new Map(stockActual.map((s) => [s.sku, s]));
  for (const [sku, pares] of manual) {
    const s = porSku.get(sku);
    if (s) {
      s.enTransferencia = Math.max(s.enTransferencia, pares);
      s.total = s.disponible + s.enTransferencia + s.noDisponible;
    } else {
      const nuevo: StockFull = {
        sku,
        disponible: 0,
        enTransferencia: pares,
        noDisponible: 0,
        total: pares,
      };
      stockActual.push(nuevo);
      porSku.set(sku, nuevo);
    }
  }
  return stockActual;
}
