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

export interface PuntoVerificacion {
  ok: boolean;
  texto: string;
}

/**
 * Doble verificación de los envíos armados, ANTES de darlos de alta: que
 * ninguna caja pida más de las que hay, que ninguna caja esté repetida entre
 * envíos, que los pares cuadren, y que nada de lo que va se esté duplicando
 * con un envío pendiente que la bodega ya apartó.
 */
export function verificarEnvios(
  envios: EnvioSeparado[],
  pendientesMeli: { id: string; filas: { sku: string; cantidad: number }[] }[] = [],
): PuntoVerificacion[] {
  const puntos: PuntoVerificacion[] = [];

  // 1. Stock: ninguna caja pide más de las disponibles.
  const excedidas: string[] = [];
  for (const e of envios) {
    for (const c of e.cajas) {
      if (c.cantidad > c.cajasDisponibles) {
        excedidas.push(`${c.modelo} ${c.color} (${c.cantidad} de ${c.cajasDisponibles})`);
      }
    }
  }
  puntos.push(
    excedidas.length
      ? {
          ok: false,
          texto: `Hay cajas pedidas de más: ${excedidas.slice(0, 4).join(", ")}${excedidas.length > 4 ? "…" : ""}.`,
        }
      : { ok: true, texto: "Ninguna caja pide más de las que hay en bodega." },
  );

  // 2. Duplicados: la misma caja no puede ir en dos envíos.
  const grupoDeCaja = new Map<string, string>();
  const duplicadas: string[] = [];
  for (const e of envios) {
    for (const c of e.cajas) {
      const antes = grupoDeCaja.get(c.codigo);
      if (antes && antes !== e.grupo) duplicadas.push(`${c.modelo} ${c.color} ${c.talla}`);
      grupoDeCaja.set(c.codigo, e.grupo);
    }
  }
  puntos.push(
    duplicadas.length
      ? { ok: false, texto: `La misma caja aparece en dos envíos: ${duplicadas.slice(0, 4).join(", ")}.` }
      : { ok: true, texto: "Ninguna caja está repetida entre envíos." },
  );

  // 3. Cuadre: los pares del envío == la suma de sus SKUs.
  const descuadrados = envios.filter(
    (e) => Math.abs(e.totalPares - e.porSku.reduce((a, s) => a + s.pares, 0)) > 0,
  );
  puntos.push(
    descuadrados.length
      ? {
          ok: false,
          texto: `Los pares no cuadran en: ${descuadrados.map((e) => e.nombre).join(", ")}.`,
        }
      : { ok: true, texto: "Los pares de cada envío cuadran con su detalle por SKU." },
  );

  // 4. Contra lo ya apartado: si un SKU del plan también viene en un envío
  //    pendiente de la bodega, puede ser el MISMO envío contado dos veces.
  if (pendientesMeli.length) {
    const enPendientes = new Map<string, string>();
    for (const p of pendientesMeli) {
      for (const f of p.filas) enPendientes.set(f.sku, p.id);
    }
    const solapados: string[] = [];
    for (const e of envios) {
      for (const s of e.porSku) {
        const id = enPendientes.get(s.sku);
        if (id) solapados.push(`${s.sku} (pendiente ${id})`);
      }
    }
    puntos.push(
      solapados.length
        ? {
            ok: false,
            texto: `Ojo: estos SKUs también van en un envío pendiente de la bodega — revisa que no se duplique: ${[...new Set(solapados)].slice(0, 5).join(", ")}.`,
          }
        : { ok: true, texto: "Nada del plan se solapa con los envíos pendientes de la bodega." },
    );
  }

  return puntos;
}
