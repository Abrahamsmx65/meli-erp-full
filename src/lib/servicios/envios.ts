/**
 * Partir el plan en envíos reales.
 *
 * El planeador decide QUÉ cajas mandar. Pero una caja no se manda sola: se
 * manda dentro de un envío, y un envío sale de UNA dirección. Caseshop e
 * Industher están juntas, así que sus cajas pueden ir en el mismo envío;
 * EnvioPack es otra bodega y tiene que ir por separado aunque las cajas vayan
 * al mismo destino.
 *
 * Si esto no se separa, el envío que se da de alta en Mercado Libre dice una
 * cantidad de cajas que ninguna bodega puede juntar sola, y el día de la
 * recolección falta producto en una dirección y sobra en otra.
 *
 * Los grupos no están fijos en el código: se guardan por cuenta en
 * `almacenes_activos.grupo_envio`, y si un almacén no trae grupo se usa su
 * propio nombre — o sea, sale solo. Es el comportamiento seguro: agrupar de
 * más junta bodegas que no se pueden juntar, agrupar de menos solo hace un
 * envío extra.
 */
import { traerTodo, type DB } from "../datos/repos";
import type { CajaGuardada } from "./cache";

export interface EnvioSeparado {
  /** identificador estable del grupo, sirve para el Excel y la URL */
  grupo: string;
  /** cómo se llama en pantalla */
  nombre: string;
  almacenes: string[];
  cajas: CajaGuardada[];
  totalCajas: number;
  totalPares: number;
  skus: number;
  /** qué SKUs y cuántos pares lleva este envío */
  porSku: { sku: string; talla: string; pares: number }[];
}

export interface PlanDeEnvios {
  envios: EnvioSeparado[];
  /** almacenes que aparecen en el plan pero no están configurados */
  sinConfigurar: string[];
}

function claveGrupo(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function separarEnvios(
  db: DB,
  accountId: string,
  cajas: CajaGuardada[],
): Promise<PlanDeEnvios> {
  const almacenes = await traerTodo<any>(
    db,
    "almacenes_activos",
    "almacen, surte_full, grupo_envio",
    (q) => q.eq("account_id", accountId),
  );

  const grupoDe = new Map<string, string>();
  for (const a of almacenes) {
    if (a.grupo_envio) grupoDe.set(a.almacen, String(a.grupo_envio));
  }

  const configurados = new Set(almacenes.map((a) => a.almacen));
  const sinConfigurar = new Set<string>();

  const porGrupo = new Map<string, EnvioSeparado>();

  for (const c of cajas) {
    if (!configurados.has(c.almacen)) sinConfigurar.add(c.almacen);

    // Sin grupo, el almacén es su propio grupo: sale en su propio envío.
    const nombre = grupoDe.get(c.almacen) ?? c.almacen;
    const grupo = claveGrupo(nombre);

    let e = porGrupo.get(grupo);
    if (!e) {
      e = {
        grupo,
        nombre,
        almacenes: [],
        cajas: [],
        totalCajas: 0,
        totalPares: 0,
        skus: 0,
        porSku: [],
      };
      porGrupo.set(grupo, e);
    }

    e.cajas.push(c);
    e.totalCajas += c.cantidad;
    e.totalPares += c.paresTotales;
    if (!e.almacenes.includes(c.almacen)) e.almacenes.push(c.almacen);
  }

  for (const e of porGrupo.values()) {
    const acc = new Map<string, { talla: string; pares: number }>();
    for (const c of e.cajas) {
      for (const a of c.aporta) {
        const prev = acc.get(a.sku) ?? { talla: a.talla, pares: 0 };
        prev.pares += a.paresTotales;
        acc.set(a.sku, prev);
      }
    }
    e.skus = acc.size;
    e.porSku = [...acc.entries()]
      .map(([sku, v]) => ({ sku, talla: v.talla, pares: v.pares }))
      .sort((a, b) => b.pares - a.pares);

    e.almacenes.sort();
    e.cajas.sort((a, b) => {
      if (a.almacen !== b.almacen) return a.almacen.localeCompare(b.almacen);
      if (a.modelo !== b.modelo) return a.modelo.localeCompare(b.modelo);
      return a.color.localeCompare(b.color);
    });
  }

  // El envío más grande primero: es el que hay que empezar a preparar antes.
  const envios = [...porGrupo.values()].sort((a, b) => b.totalCajas - a.totalCajas);

  return { envios, sinConfigurar: [...sinConfigurar].sort() };
}
