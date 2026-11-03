/**
 * Lee SOLOS los sheets del dueño («Cuentas YAPANIZCEL» y «Números») y deja
 * en la base lo que dicen. Decisión del dueño (16-oct-2026: «sí, que lo lea
 * automático y manda el sheet»): lo que vino del sheet se REEMPLAZA completo
 * en cada lectura (por `clave_importacion` que empieza con `cuentas:`, los
 * contenedores y modelos que el sheet trae); lo capturado a mano en el ERP sin
 * clave se queda. El sheet nunca se escribe.
 *
 * Corre cada hora (`/api/cron/sheets-finanzas`) y con el botón «Leer sheets»
 * de Costeo, Números y Cuenta del año. El resultado queda en `app_cache`
 * (`finanzas:sheets`) para que las pantallas digan de cuándo es lo leído.
 */
import { conCandado, traerTodo, type DB } from "../datos/repos";
import {
  SHEET_CUENTAS,
  SHEET_NUMEROS,
  libroDeXlsx,
  leerCuentas,
  leerNumeros,
  type MovimientoSheet,
} from "../finanzas/sheets";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";
import { recalcularCosteo } from "./costeo";
import { guardadoDe } from "./numeros";
import { CAMPOS_NUMEROS, mezclarConSheet, type ValoresNumeros } from "../finanzas/numeros-sheet";

export const CLAVE_SHEETS = "finanzas:sheets";

export interface ResultadoSheets {
  leidoEn: string;
  ok: boolean;
  cuentas: {
    gastos: number;
    transferencias: number;
    shein: number;
    ingresos: number;
    retiros: number;
    contenedores: number;
    pagos: number;
  } | null;
  numeros: { modelos: number } | null;
  avisos: string[];
  errores: string[];
}

const LOTE = 500;

export async function bajar(url: string): Promise<Buffer> {
  const r = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!r.ok) {
    throw new Error(
      r.status === 401 || r.status === 403
        ? `Google contestó ${r.status}: el sheet tiene que estar compartido como «cualquiera con el enlace puede ver».`
        : `Google contestó ${r.status} al bajar el sheet.`,
    );
  }
  const buf = Buffer.from(await r.arrayBuffer());
  // Un .xlsx es un ZIP: empieza con «PK». Si no, Google mandó una página.
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error("Google no mandó el archivo (¿el sheet dejó de estar compartido?).");
  }
  return buf;
}

async function borrarPorPrefijo(db: DB, tabla: string, accountId: string, prefijo: string): Promise<void> {
  const { error } = await db.from(tabla).delete().eq("account_id", accountId).like("clave_importacion", `${prefijo}%`);
  if (error) throw new Error(`${tabla}: ${error.message}`);
}

async function insertar(db: DB, tabla: string, filas: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < filas.length; i += LOTE) {
    const { error } = await db.from(tabla).insert(filas.slice(i, i + LOTE));
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

/** Categoría que el ERP ya le tiene a cada concepto (la última que se usó). */
async function categoriasConocidas(db: DB, accountId: string): Promise<Map<string, string>> {
  const filas = await traerTodo<{ concepto: string; categoria: string }>(
    db,
    "gastos_empresariales",
    "concepto, categoria, fecha, id",
    (q) => q.eq("account_id", accountId).eq("medio", "efectivo").order("fecha", { ascending: true }).order("id", { ascending: true }),
  );
  const m = new Map<string, string>();
  for (const f of filas) if (f.concepto && f.categoria) m.set(String(f.concepto).toUpperCase().replace(/\s+/g, " ").trim(), f.categoria);
  return m;
}

async function escribirCuentas(db: DB, accountId: string, buf: Buffer, r: ResultadoSheets): Promise<void> {
  const c = leerCuentas(await libroDeXlsx(buf), await categoriasConocidas(db, accountId));
  r.avisos.push(...c.avisos);
  const movs = (tipo: MovimientoSheet["tipo"]) => c.movimientos.filter((m) => m.tipo === tipo);
  const filaMov = (m: MovimientoSheet) => ({
    account_id: accountId,
    fecha: m.fecha,
    tipo: m.tipo,
    monto: m.monto,
    beneficiario: m.beneficiario,
    referencia: m.referencia,
    comision: m.comision,
    notas: m.notas,
    clave_importacion: m.clave,
  });
  let pagos = 0;

  // GASTOS MEX → gastos en efectivo (y los negativos, ingresos de la cuenta).
  if (c.leidas.has("gastos")) {
    await borrarPorPrefijo(db, "gastos_empresariales", accountId, "cuentas:gastos-mex:");
    await borrarPorPrefijo(db, "cuenta_paralela", accountId, "cuentas:gastos-mex:");
    await insertar(
      db,
      "gastos_empresariales",
      c.gastos.map((g) => ({
        account_id: accountId, fecha: g.fecha, concepto: g.concepto, categoria: g.categoria, monto: g.monto,
        medio: "efectivo", clave_importacion: g.clave,
      })),
    );
    await insertar(db, "cuenta_paralela", movs("ingreso").map(filaMov));
  }
  if (c.leidas.has("transferencias")) {
    await borrarPorPrefijo(db, "cuenta_paralela", accountId, "cuentas:transferencias:");
    await insertar(db, "cuenta_paralela", movs("transferencia").map(filaMov));
  }
  if (c.leidas.has("shein")) {
    await borrarPorPrefijo(db, "cuenta_paralela", accountId, "cuentas:shein:");
    await insertar(db, "cuenta_paralela", movs("shein").map(filaMov));
  }
  if (c.leidas.has("total")) {
    await borrarPorPrefijo(db, "cuenta_paralela", accountId, "cuentas:total:");
    await insertar(db, "cuenta_paralela", movs("gasto").map(filaMov));
  }

  // SUELDOS → retiros de los socios (solo se apuntan, nunca son gasto).
  if (c.leidas.has("sueldos")) {
    const { data: socios } = await db.from("socios").select("id, nombre").eq("account_id", accountId);
    const idDe = (nombre: string) =>
      ((socios ?? []) as { id: number; nombre: string }[]).find((s) => s.nombre.toUpperCase().startsWith(nombre))?.id;
    const filas = c.retiros
      .map((x) => ({ x, socio: idDe(x.socio) }))
      .filter((y) => {
        if (y.socio == null) r.avisos.push(`SUELDOS: no hay socio «${y.x.socio}» en el ERP.`);
        return y.socio != null;
      })
      .map(({ x, socio }) => ({
        account_id: accountId, socio_id: socio, fecha: x.fecha, concepto: x.concepto, monto: x.monto, clave_importacion: x.clave,
      }));
    await borrarPorPrefijo(db, "socios_retiros", accountId, "cuentas:sueldos:");
    await insertar(db, "socios_retiros", filas);
  }

  // COSTING GETAC / FUNDAS → lo pagado por contenedor.
  if (c.leidas.has("costeo")) {
    for (const k of c.contenedores) {
      const { error } = await db.from("costeo_contenedores").upsert(
        {
          account_id: accountId,
          contenedor: k.contenedor,
          ...(k.iso ? { iso: k.iso } : {}),
          ...(k.productos ? { productos: k.productos } : {}),
          costo_usd: k.costoUsd,
          flete_usd: k.fleteUsd,
          aduana_mxn: k.aduana,
          entregado: k.entregado,
          negocio: k.negocio,
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: "account_id,contenedor" },
      );
      if (error) throw new Error(`costeo_contenedores ${k.contenedor}: ${error.message}`);
      // Los pagos solo se rehacen si el sheet ya trae el tipo de cambio: un
      // contenedor apenas anotado (S272 sin T.C.) conserva lo del ERP.
      if (k.costoUsd && k.tcFabrica) {
        const { error: e1 } = await db.from("costeo_pagos").delete().eq("account_id", accountId).eq("contenedor", k.contenedor);
        if (e1) throw new Error(`costeo_pagos ${k.contenedor}: ${e1.message}`);
        const hoja = k.negocio === "fundas" ? "COSTING FUNDAS" : "COSTING GETAC";
        const nuevos: Record<string, unknown>[] = [
          { account_id: accountId, contenedor: k.contenedor, concepto: "fabrica", usd: k.costoUsd, tipo_cambio: k.tcFabrica, notas: `Del sheet ${hoja}` },
        ];
        if (k.fleteUsd && k.tcFlete) {
          nuevos.push({ account_id: accountId, contenedor: k.contenedor, concepto: "flete", usd: k.fleteUsd, tipo_cambio: k.tcFlete, notas: `Del sheet ${hoja}` });
        }
        await insertar(db, "costeo_pagos", nuevos);
        pagos += nuevos.length;
      }
    }
  }

  r.cuentas = {
    gastos: c.gastos.length,
    transferencias: movs("transferencia").length,
    shein: movs("shein").length,
    ingresos: movs("ingreso").length,
    retiros: c.retiros.length,
    contenedores: c.contenedores.length,
    pagos,
  };
}

async function escribirNumeros(db: DB, accountId: string, buf: Buffer, r: ResultadoSheets): Promise<void> {
  const n = leerNumeros(await libroDeXlsx(buf));
  r.avisos.push(...n.avisos);
  const ahora = new Date().toISOString();
  // Lo cambiado en el ERP le gana al sheet mientras el sheet no cambie ese campo.
  const guardados = await traerTodo<any>(
    db,
    "numeros_modelos",
    `modelo, ${CAMPOS_NUMEROS.join(", ")}, editados_erp, valores_sheet`,
    (q) => q.eq("account_id", accountId).order("modelo", { ascending: true }),
  );
  const previos = new Map(guardados.map((g) => [String(g.modelo), guardadoDe(g)]));
  let respetados = 0;
  const filas = n.modelos.map((m) => {
    const sheet: ValoresNumeros = {
      envio_meli: m.envioMeli,
      precio_relampago: m.precioRelampago,
      pv_normal: m.pvNormal,
      retencion: m.retencion,
      envio_amazon: m.envioAmazon,
      pvp_deal: m.pvpDeal,
      tiktok_extra: m.tiktokExtra,
      tiktok_comision: m.tiktokComision,
      tiktok_oferta: m.tiktokOferta,
    };
    const x = mezclarConSheet(sheet, previos.get(m.modelo) ?? null);
    if (x.respetados.length) respetados++;
    return { account_id: accountId, modelo: m.modelo, ...x.valores, editados_erp: x.editados, valores_sheet: sheet, actualizado_en: ahora };
  });
  if (respetados) r.avisos.push(`Números: ${respetados} modelos conservan lo cambiado en el ERP (el sheet no cambió esos campos).`);
  for (let i = 0; i < filas.length; i += LOTE) {
    const { error } = await db.from("numeros_modelos").upsert(filas.slice(i, i + LOTE), { onConflict: "account_id,modelo" });
    if (error) throw new Error(`numeros_modelos: ${error.message}`);
  }
  r.numeros = { modelos: filas.length };
}

/** Lee los dos sheets y escribe lo que dicen. Un sheet que falla no frena al otro. */
export async function leerSheetsFinanzas(db: DB, accountId: string): Promise<ResultadoSheets> {
  return conCandado(
    db,
    accountId,
    "sheets-finanzas",
    300,
    async () => {
      const r: ResultadoSheets = { leidoEn: new Date().toISOString(), ok: true, cuentas: null, numeros: null, avisos: [], errores: [] };
      try {
        await escribirCuentas(db, accountId, await bajar(SHEET_CUENTAS), r);
      } catch (err) {
        r.errores.push(`Cuentas YAPANIZCEL: ${(err as Error).message}`);
      }
      try {
        await escribirNumeros(db, accountId, await bajar(SHEET_NUMEROS), r);
      } catch (err) {
        r.errores.push(`Números: ${(err as Error).message}`);
      }
      r.ok = r.errores.length === 0;
      // Costeo y Números leen el costeo masticado: se rehace con lo nuevo.
      if (r.cuentas) await recalcularCosteo(db, accountId).catch((err) => r.errores.push(`Costeo: ${(err as Error).message}`));
      await guardarCacheApp(db, accountId, CLAVE_SHEETS, r, 0);
      return r;
    },
    "Ya se están leyendo los sheets.",
  );
}

export async function ultimaLecturaSheets(db: DB, accountId: string): Promise<ResultadoSheets | null> {
  const g = await leerCacheAppGuardado<ResultadoSheets>(db, accountId, CLAVE_SHEETS);
  return g.estado === "encontrado" ? g.valor.datos : null;
}
