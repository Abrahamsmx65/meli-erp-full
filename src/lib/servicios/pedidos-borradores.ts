/**
 * NUEVO PEDIDO a China desde la lista del dueño (11-oct-2026: «quiero
 * mandarte una lista así y que se haga solo todo […] que me salga borrador,
 * confirmo y se manda a mi correo, al de mi papá y al de Joanne; después de
 * que se confirma me lo sumas a pedidos pendientes»).
 *
 *   1. Se pega la lista → UN BORRADOR con todo lo pegado y su IN consecutivo
 *      (el último fuera del ERP fue IN10183: `pedidos_ajustes.ultimo_in`).
 *      Hasta el 20-oct-2026 salía uno por modelo («cada modelo se pide en
 *      diferente Excel siempre»); ese día el dueño pegó GT180 y GT181 juntos
 *      («es un solo pedido y el sistema me lo generó en dos»): lo que se pega
 *      junto es un pedido. Para dos pedidos, se pegan dos veces. El IN se
 *      puede corregir a mano en el borrador.
 *   2. Fábrica, moneda, precios por talla, pares por caja y medidas salen
 *      del último pedido del modelo (`pedidos-china/armar.ts`); lo que falte
 *      se captura en el borrador. Mientras es borrador NO cuenta para nada.
 *   3. Confirmar → se da de alta como pedido (`guardarProforma`, origen
 *      «sistema»: cuenta como en camino y entra a Pendientes por enviar) y
 *      el Excel EN EL FORMATO DE LA FÁBRICA se manda por correo.
 *   4. Cuando la fábrica regresa la proforma firmada con ese IN y se sube en
 *      Órdenes de compra, reemplaza los renglones (si nada está en barco).
 */
import { canonizar } from "../importar/sku";
import type { LineaProforma, Moneda, Proforma } from "../importar/proforma";
import { porTandas, traerTodo, type DB } from "../datos/repos";
import { armarBorrador, armarBorradorFamilia, faltantesDeBorrador, totalesDeBorrador, type BorradorArmado, type LineaBorrador, type LineaHistoria } from "../pedidos-china/armar";
import { familiaDe, nombreDeFamilia, type MapaFamilias } from "../pedidos-china/familias";
import { cargarFamilias } from "./familias-modelos";
import { excelDePedido, nombreArchivoPedido, type PedidoPI } from "../pedidos-china/excel";
import { FABRICAS, perfilDeClave, perfilDeProveedor, SIN_FABRICA } from "../pedidos-china/fabricas";
import { leerLista, type ModeloLista } from "../pedidos-china/lista";
import { guardarProforma } from "./pedidos";
import { zipEtiquetasDePedido } from "./etiquetas-pedido";
import { enviarCorreo } from "./correo";
import { escaparHtml, plantillaCorreo, TONO, URL_ERP } from "./correo-marca";

export const ULTIMO_IN_OMISION = 10183;

export interface Borrador {
  id: string;
  pedido: string;
  modelo: string;
  fabrica: string | null;
  proveedor: string | null;
  moneda: Moneda | null;
  descripcion: string;
  lineas: LineaBorrador[];
  texto: string;
  avisos: string[];
  estado: "borrador" | "confirmado" | "descartado";
  pedidoId: string | null;
  correo: {
    enviado: boolean;
    para: string[];
    motivo?: string;
    en: string;
    /** si el ZIP de etiquetas no se pudo armar, por qué (el correo sale igual) */
    etiquetas?: string;
  } | null;
  creadoEn: string;
  confirmadoEn: string | null;
  /** lo que falta para poder confirmar */
  faltantes: string[];
  totales: ReturnType<typeof totalesDeBorrador>;
}

export interface AjustesPedidos {
  destinatarios: string[];
  ultimoIn: number;
}

export interface OpcionFabrica {
  clave: string;
  nombre: string;
  moneda: Moneda | null;
  /** tiene formato propio de proforma (si no, el sencillo) */
  formatoPropio: boolean;
}

const COLUMNAS =
  "id, pedido, modelo, fabrica, proveedor, moneda, descripcion, lineas, texto, avisos, estado, pedido_id, correo, creado_en, confirmado_en";

function aBorrador(r: Record<string, unknown>): Borrador {
  const lineas = (r.lineas as LineaBorrador[]) ?? [];
  const base = {
    fabrica: (r.fabrica as string) ?? null,
    moneda: (r.moneda as Moneda) ?? null,
    lineas,
  };
  return {
    id: r.id as string,
    pedido: r.pedido as string,
    modelo: r.modelo as string,
    proveedor: (r.proveedor as string) ?? null,
    descripcion: (r.descripcion as string) ?? "",
    texto: (r.texto as string) ?? "",
    avisos: (r.avisos as string[]) ?? [],
    estado: r.estado as Borrador["estado"],
    pedidoId: (r.pedido_id as string) ?? null,
    correo: (r.correo as Borrador["correo"]) ?? null,
    creadoEn: r.creado_en as string,
    confirmadoEn: (r.confirmado_en as string) ?? null,
    ...base,
    faltantes: faltantesDeBorrador(base),
    totales: totalesDeBorrador(lineas),
  };
}

// --- Ajustes ---------------------------------------------------------------

export async function leerAjustes(db: DB, accountId: string): Promise<AjustesPedidos> {
  const { data } = await db.from("pedidos_ajustes").select("destinatarios, ultimo_in").eq("account_id", accountId).maybeSingle();
  return {
    destinatarios: (data?.destinatarios as string[]) ?? [],
    ultimoIn: (data?.ultimo_in as number) ?? ULTIMO_IN_OMISION,
  };
}

export async function guardarAjustes(db: DB, accountId: string, a: Partial<AjustesPedidos>): Promise<AjustesPedidos> {
  const actual = await leerAjustes(db, accountId);
  const destinatarios = (a.destinatarios ?? actual.destinatarios)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  for (const d of destinatarios) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d)) throw new Error(`«${d}» no parece un correo.`);
  }
  const ultimoIn = a.ultimoIn ?? actual.ultimoIn;
  if (!Number.isInteger(ultimoIn) || ultimoIn < 10000) throw new Error("El último IN debe ser un número como 10183.");
  const { error } = await db.from("pedidos_ajustes").upsert(
    { account_id: accountId, destinatarios: [...new Set(destinatarios)], ultimo_in: ultimoIn, actualizado_en: new Date().toISOString() },
    { onConflict: "account_id" },
  );
  if (error) throw new Error(`No se pudieron guardar los ajustes: ${error.message}`);
  return { destinatarios: [...new Set(destinatarios)], ultimoIn };
}

/** El siguiente IN: después del mayor entre pedidos, borradores vivos y el último dado a mano. */
export async function siguienteIn(db: DB, accountId: string): Promise<number> {
  const [aj, pedidos, borradores] = await Promise.all([
    leerAjustes(db, accountId),
    traerTodo<{ pedido: string }>(db, "pedidos", "id, pedido", (q) => q.eq("account_id", accountId)),
    traerTodo<{ pedido: string }>(db, "pedidos_borradores", "id, pedido", (q) => q.eq("account_id", accountId).neq("estado", "descartado")),
  ]);
  let max = aj.ultimoIn;
  for (const p of [...pedidos, ...borradores]) {
    const m = p.pedido.toUpperCase().match(/^IN(\d{4,})$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// --- Historia ----------------------------------------------------------------

/** Los renglones de pedidos anteriores de esos modelos, con las medidas de su caja. */
export async function historiaDeModelos(db: DB, accountId: string, modelos: string[]): Promise<LineaHistoria[]> {
  if (!modelos.length) return [];
  const claves = new Set(modelos.map(canonizar));
  const pedidos = await traerTodo<{ id: string; pedido: string; proveedor: string | null; moneda: Moneda | null }>(
    db,
    "pedidos",
    "id, pedido, proveedor, moneda",
    (q) => q.eq("account_id", accountId),
  );
  const porId = new Map(pedidos.map((p) => [p.id, p]));
  const lineas = await porTandas(
    pedidos.map((p) => p.id),
    200,
    (ids) =>
      traerTodo<{
        id: string;
        pedido_id: string;
        modelo: string;
        color: string;
        talla: string | null;
        tallas: Record<string, number>;
        pares_por_caja: number;
        precio_unitario: number | null;
        precios_talla: Record<string, number> | null;
        descripcion: string | null;
        cbm_caja: number | null;
      }>(
        db,
        "pedido_lineas",
        "id, pedido_id, modelo, color, talla, tallas, pares_por_caja, precio_unitario, precios_talla, descripcion, cbm_caja",
        (q) => q.in("pedido_id", ids),
      ),
  );
  const delModelo = lineas.filter((l) => claves.has(canonizar(l.modelo)));

  const medidas = await porTandas(
    delModelo.map((l) => l.id),
    200,
    (ids) =>
      traerTodo<{ id: string; pedido_linea_id: string; largo_cm: number | null; ancho_cm: number | null; alto_cm: number | null }>(
        db,
        "contenedor_lineas",
        "id, pedido_linea_id, largo_cm, ancho_cm, alto_cm",
        (q) => q.in("pedido_linea_id", ids).not("largo_cm", "is", null),
      ),
  );
  const medidaDe = new Map<string, { largoCm: number; anchoCm: number; altoCm: number }>();
  for (const m of medidas) {
    if (m.largo_cm && m.ancho_cm && m.alto_cm) {
      medidaDe.set(m.pedido_linea_id, { largoCm: Number(m.largo_cm), anchoCm: Number(m.ancho_cm), altoCm: Number(m.alto_cm) });
    }
  }

  return delModelo.map((l) => {
    const p = porId.get(l.pedido_id);
    return {
      pedido: p?.pedido ?? "",
      proveedor: p?.proveedor ?? null,
      moneda: p?.moneda ?? null,
      modelo: l.modelo,
      color: l.color,
      talla: l.talla ?? "",
      tallas: l.tallas ?? {},
      paresPorCaja: Number(l.pares_por_caja) || 0,
      precio: l.precio_unitario == null ? null : Number(l.precio_unitario),
      preciosTalla: l.precios_talla ?? null,
      descripcion: l.descripcion,
      medidas: medidaDe.get(l.id) ?? null,
      cbmCaja: l.cbm_caja == null ? null : Number(l.cbm_caja),
    };
  });
}

/** Las fábricas para elegir: las de formato propio y las que ya aparecen en pedidos. */
export async function opcionesDeFabrica(db: DB, accountId: string): Promise<OpcionFabrica[]> {
  const pedidos = await traerTodo<{ proveedor: string | null; moneda: Moneda | null }>(db, "pedidos", "id, proveedor, moneda", (q) =>
    q.eq("account_id", accountId),
  );
  const opciones = new Map<string, OpcionFabrica>();
  for (const f of FABRICAS) opciones.set(f.clave, { clave: f.clave, nombre: f.nombre, moneda: f.moneda, formatoPropio: f.formato !== "sencillo" });
  for (const p of pedidos) {
    const perfil = perfilDeProveedor(p.proveedor);
    if (!perfil || opciones.has(perfil.clave)) continue;
    opciones.set(perfil.clave, { clave: perfil.clave, nombre: perfil.nombre, moneda: p.moneda ?? null, formatoPropio: false });
  }
  return [...opciones.values()].sort((a, b) => Number(b.formatoPropio) - Number(a.formatoPropio) || a.nombre.localeCompare(b.nombre));
}

// --- Borradores ----------------------------------------------------------------

export async function listarBorradores(db: DB, accountId: string): Promise<Borrador[]> {
  const desde = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("pedidos_borradores")
    .select(COLUMNAS)
    .eq("account_id", accountId)
    .or(`estado.eq.borrador,and(estado.eq.confirmado,confirmado_en.gte.${desde})`)
    .order("pedido", { ascending: false });
  if (error) throw new Error(`No se pudieron leer los borradores: ${error.message}`);
  return (data ?? []).map(aBorrador);
}

async function leerBorrador(db: DB, accountId: string, id: string): Promise<Borrador> {
  const { data, error } = await db.from("pedidos_borradores").select(COLUMNAS).eq("account_id", accountId).eq("id", id).maybeSingle();
  if (error || !data) throw new Error("No encontré ese borrador.");
  return aBorrador(data);
}

/** Moneda de una fábrica sin perfil: la de su último pedido. */
async function monedaConocida(db: DB, accountId: string, armado: BorradorArmado): Promise<Moneda | null> {
  if (armado.moneda || !armado.fabrica) return armado.moneda;
  const perfil = perfilDeClave(armado.fabrica);
  if (!perfil) return null;
  const { data } = await db.from("pedidos").select("proveedor, moneda, pedido").eq("account_id", accountId).not("moneda", "is", null);
  const delMismo = (data ?? [])
    .filter((p) => perfil.reconoce.test(String(p.proveedor ?? "")))
    .sort((a, b) => String(b.pedido).localeCompare(String(a.pedido), "en", { numeric: true }));
  return (delMismo[0]?.moneda as Moneda) ?? null;
}

/**
 * Arma el borrador de un grupo de la lista: un modelo, o una FAMILIA (varios
 * modelos que se piden juntos: un solo IN y un solo Excel).
 */
function armarGrupo(nombre: string, familia: string | null, listas: ModeloLista[], historia: LineaHistoria[], fabrica?: string | null): BorradorArmado {
  if (!familia && listas.length === 1) return armarBorrador(listas[0], historia, fabrica);
  return armarBorradorFamilia(nombre, listas, historia, fabrica);
}

/**
 * Con qué nombre se enseña un borrador de varios modelos: el de la familia
 * si todos son de la misma; si no, los modelos separados por coma.
 */
export function nombreDeBorrador(modelos: string[], familias: MapaFamilias | null): string {
  const unicos = [...new Set(modelos.map((m) => m.toUpperCase()))];
  if (unicos.length === 1) return unicos[0];
  const fams = new Set(unicos.map((m) => familiaDe(familias, m)));
  if (fams.size === 1 && !fams.has(null)) return [...fams][0] as string;
  return unicos.length <= 6 ? unicos.join(", ") : nombreDeFamilia(unicos);
}

/**
 * Pega la lista y arma UN borrador con todo lo pegado, con su IN (dueño,
 * 20-oct-2026: «cuando pego un texto junto es porque es un solo pedido y el
 * sistema me lo generó en dos»; hasta ese día salía un borrador por
 * modelo). Un pedido de varios modelos lleva el modelo en cada renglón y
 * sale en UN Excel.
 */
export async function crearBorradores(
  db: DB,
  accountId: string,
  texto: string,
): Promise<{ creados: Borrador[]; sinEntender: string[] }> {
  const lista = leerLista(texto);
  if (!lista.modelos.length) {
    throw new Error("No encontré ningún modelo en la lista. Cada bloque empieza con el modelo (GT179, MY2307…).");
  }
  const [historia, familias] = await Promise.all([
    historiaDeModelos(db, accountId, lista.modelos.map((m) => m.modelo)),
    cargarFamilias(db, accountId).catch(() => new Map()),
  ]);
  let numero = await siguienteIn(db, accountId);

  const creados: Borrador[] = [];
  const nombre = nombreDeBorrador(lista.modelos.map((m) => m.modelo), familias);
  const grupos = [{ nombre, familia: lista.modelos.length > 1 ? nombre : null, elementos: lista.modelos }];
  for (const g of grupos) {
    const armado = armarGrupo(g.nombre, g.familia, g.elementos, historia);
    armado.moneda = await monedaConocida(db, accountId, armado);
    const fila = {
      account_id: accountId,
      modelo: armado.modelo,
      fabrica: armado.fabrica,
      proveedor: armado.proveedor,
      moneda: armado.moneda,
      descripcion: armado.descripcion,
      lineas: armado.lineas,
      texto: texto.trim(),
      avisos: armado.avisos,
    };
    // El IN es único entre los vivos: si otro clic lo tomó, el siguiente.
    let intento = 0;
    for (;;) {
      const { data, error } = await db
        .from("pedidos_borradores")
        .insert({ ...fila, pedido: `IN${numero}` })
        .select(COLUMNAS)
        .single();
      numero++;
      if (!error && data) {
        creados.push(aBorrador(data));
        break;
      }
      if (error?.code !== "23505" || ++intento > 5) throw new Error(`No se pudo guardar el borrador de ${g.nombre}: ${error?.message}`);
    }
  }
  return { creados, sinEntender: lista.sinEntender };
}

function validarLineas(lineas: unknown): LineaBorrador[] {
  if (!Array.isArray(lineas)) throw new Error("Los renglones vienen mal formados.");
  return lineas.map((x, i) => {
    const l = x as Partial<LineaBorrador>;
    const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
    const cajas = Number(l.cajas);
    const porCaja = Number(l.paresPorCaja);
    if (!Number.isInteger(cajas) || cajas < 0) throw new Error(`Renglón ${i + 1}: cajas inválidas.`);
    if (!Number.isInteger(porCaja) || porCaja < 0) throw new Error(`Renglón ${i + 1}: pares por caja inválidos.`);
    const precio = num(l.precio);
    if (precio != null && !(precio > 0)) throw new Error(`Renglón ${i + 1}: precio inválido.`);
    const corrida: Record<string, number> = {};
    for (const [t, n] of Object.entries(l.corrida ?? {})) if (Number(n) > 0) corrida[String(t)] = Number(n);
    const preciosTalla: Record<string, number> = {};
    for (const [t, n] of Object.entries(l.preciosTalla ?? {})) if (Number(n) > 0) preciosTalla[String(t)] = Number(n);
    return {
      ...(l.modelo ? { modelo: String(l.modelo).trim().toUpperCase() } : {}),
      ...(l.colorNuevo ? { colorNuevo: true } : {}),
      color: String(l.color ?? "").trim().toUpperCase(),
      unitalla: l.unitalla ? String(l.unitalla) : null,
      corrida,
      paresPorCaja: l.unitalla ? porCaja : Object.values(corrida).reduce((a, b) => a + b, 0) || porCaja,
      cajas,
      precio,
      preciosTalla: Object.keys(preciosTalla).length ? preciosTalla : null,
      medidas: l.medidas ?? null,
      cbmCaja: num(l.cbmCaja),
      precioDe: l.precioDe ?? null,
    };
  });
}

/**
 * Cambios del dueño al borrador. Cambiar la FÁBRICA vuelve a armar el
 * borrador desde la lista: los precios de la otra fábrica ya no sirven.
 */
export async function actualizarBorrador(
  db: DB,
  accountId: string,
  id: string,
  cambios: { fabrica?: string | null; moneda?: Moneda | null; descripcion?: string; lineas?: unknown; proveedor?: string; pedido?: string },
): Promise<Borrador> {
  const b = await leerBorrador(db, accountId, id);
  if (b.estado !== "borrador") throw new Error("Ese pedido ya no es borrador.");
  const fila: Record<string, unknown> = { actualizado_en: new Date().toISOString() };

  // El número de pedido se puede corregir a mano (dueño, 20-oct-2026):
  // forma IN + número y que no lo tenga ya un pedido cargado ni otro
  // borrador vivo (el índice único lo cuida; aquí se contesta con palabras).
  if (cambios.pedido !== undefined) {
    const nuevo = String(cambios.pedido).trim().toUpperCase().replace(/\s+/g, "");
    if (!/^IN\d{4,6}$/.test(nuevo)) throw new Error("El número de pedido va como IN10186.");
    if (nuevo !== b.pedido) {
      const { data: existente } = await db.from("pedidos").select("id").eq("account_id", accountId).ilike("pedido", nuevo).limit(1);
      if (existente?.length) throw new Error(`El ${nuevo} ya está cargado en Órdenes de compra.`);
      const { data: vivo } = await db
        .from("pedidos_borradores")
        .select("id")
        .eq("account_id", accountId)
        .eq("pedido", nuevo)
        .neq("estado", "descartado")
        .neq("id", id)
        .limit(1);
      if (vivo?.length) throw new Error(`Ya hay otro borrador con el ${nuevo}.`);
      fila.pedido = nuevo;
    }
  }

  if (cambios.fabrica !== undefined && cambios.fabrica !== b.fabrica) {
    const listas = leerLista(b.texto).modelos;
    if (!listas.length) throw new Error("No se pudo volver a leer la lista de este borrador.");
    const historia = await historiaDeModelos(db, accountId, listas.map((m) => m.modelo));
    const familia = listas.length > 1 || b.lineas.some((l) => l.modelo) ? b.modelo : null;
    const armado = armarGrupo(b.modelo, familia, listas, historia, cambios.fabrica);
    armado.moneda = await monedaConocida(db, accountId, armado);
    Object.assign(fila, {
      fabrica: armado.fabrica,
      proveedor: armado.proveedor,
      moneda: armado.moneda,
      lineas: armado.lineas,
      avisos: armado.avisos,
      descripcion: b.descripcion || armado.descripcion,
    });
  } else {
    if (cambios.moneda !== undefined) {
      if (cambios.moneda !== null && cambios.moneda !== "USD" && cambios.moneda !== "RMB") throw new Error("Moneda inválida.");
      fila.moneda = cambios.moneda;
    }
    if (cambios.lineas !== undefined) fila.lineas = validarLineas(cambios.lineas);
  }
  if (cambios.descripcion !== undefined) fila.descripcion = String(cambios.descripcion).trim().slice(0, 200);

  const { data, error } = await db.from("pedidos_borradores").update(fila).eq("account_id", accountId).eq("id", id).select(COLUMNAS).single();
  if (error?.code === "23505") throw new Error(`Ya hay otro borrador con el ${fila.pedido}.`);
  if (error || !data) throw new Error(`No se pudo guardar: ${error?.message ?? "sin detalle"}`);
  return aBorrador(data);
}

export async function descartarBorrador(db: DB, accountId: string, id: string): Promise<void> {
  const { error } = await db
    .from("pedidos_borradores")
    .update({ estado: "descartado", actualizado_en: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("id", id)
    .eq("estado", "borrador");
  if (error) throw new Error(`No se pudo descartar: ${error.message}`);
}

function hoyMx(): string {
  return new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
}

export function pedidoPIDe(b: Borrador): PedidoPI {
  // Sin fábrica: Excel sencillo.
  const perfil = perfilDeClave(b.fabrica) ?? SIN_FABRICA;
  return {
    pedido: b.pedido,
    fecha: b.confirmadoEn ? b.confirmadoEn.slice(0, 10) : hoyMx(),
    perfil,
    moneda: b.moneda,
    renglones: b.lineas.map((l) => ({ ...l, modelo: l.modelo || b.modelo, descripcion: b.descripcion, nuevo: Boolean(l.colorNuevo) })),
  };
}

export async function excelDeBorrador(db: DB, accountId: string, id: string): Promise<{ nombre: string; contenido: Buffer }> {
  const b = await leerBorrador(db, accountId, id);
  const pi = pedidoPIDe(b);
  return { nombre: nombreArchivoPedido(b.pedido, pi.renglones), contenido: await excelDePedido(pi) };
}

/** El pedido como proforma ya leída, para darlo de alta igual que una de la fábrica. */
export function proformaDeBorrador(b: Borrador): Proforma {
  const lineas: LineaProforma[] = b.lineas.map((l) => ({
    modelo: l.modelo || b.modelo,
    color: l.color,
    colorCrudo: l.color,
    descripcion: l.colorNuevo ? `${b.descripcion} (NEW COLOR)`.trim() : b.descripcion,
    tallas: l.unitalla ? { [l.unitalla]: l.paresPorCaja } : { ...l.corrida },
    paresPorCaja: l.paresPorCaja,
    cajas: l.cajas,
    pares: l.cajas * l.paresPorCaja,
    precioUnitario: l.precio,
    cuadra: true,
    unitalla: l.unitalla,
    preciosTalla: l.unitalla ? null : l.preciosTalla ?? null,
    cbmCaja: l.cbmCaja ?? (l.medidas ? Number(((l.medidas.largoCm * l.medidas.anchoCm * l.medidas.altoCm) / 1e6).toFixed(5)) : null),
  }));
  return {
    pedido: b.pedido,
    proveedor: b.proveedor ?? perfilDeClave(b.fabrica)?.nombre ?? null,
    moneda: b.moneda,
    lineas,
    totales: { cajas: b.totales.cajas, pares: b.totales.pares, importe: b.totales.importe },
    tallasDetectadas: [],
    avisos: [],
  };
}

function dinero(n: number | null, m: Moneda | null): string {
  if (n == null) return "—";
  return `${m === "RMB" ? "¥" : "$"}${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${m ? ` ${m}` : ""}`;
}

export function correoDeBorrador(
  b: Borrador,
  etiquetas?: { adjuntas: boolean; sinCodigo: number },
): { asunto: string; html: string; texto: string } {
  const e = escaparHtml;
  const t = b.totales;
  const fab = b.proveedor || perfilDeClave(b.fabrica)?.nombre || "Sin fábrica";
  const familia = b.lineas.some((l) => l.modelo);
  const filas = b.lineas
    .map((l) => {
      const que = l.unitalla
        ? `Talla ${l.unitalla}`
        : Object.entries(l.corrida)
            .map(([talla, n]) => `${talla}×${n}`)
            .join(" ");
      const precio = l.preciosTalla
        ? [...new Set(Object.values(l.preciosTalla))].map((p) => dinero(p, null)).join(" / ")
        : dinero(l.precio, null);
      return (
        `<tr>${familia ? `<td style="padding:7px 8px;border-bottom:1px solid ${TONO.borde}">${e(l.modelo ?? "")}</td>` : ""}` +
        `<td style="padding:7px 8px;border-bottom:1px solid ${TONO.borde}">${e(l.color)}${l.colorNuevo ? ` <span style="font-size:10px;font-weight:700;color:${TONO.tinta2}">NUEVO</span>` : ""}</td>` +
        `<td style="padding:7px 8px;border-bottom:1px solid ${TONO.borde}">${e(que)}</td>` +
        `<td style="padding:7px 8px;border-bottom:1px solid ${TONO.borde};text-align:right">${l.cajas}</td>` +
        `<td style="padding:7px 8px;border-bottom:1px solid ${TONO.borde};text-align:right">${l.paresPorCaja}</td>` +
        `<td style="padding:7px 8px;border-bottom:1px solid ${TONO.borde};text-align:right">${(l.cajas * l.paresPorCaja).toLocaleString("es-MX")}</td>` +
        `<td style="padding:7px 8px;border-bottom:1px solid ${TONO.borde};text-align:right">${e(precio)}</td></tr>`
      );
    })
    .join("");
  const th = (x: string, der = false) =>
    `<th style="padding:7px 8px;border-bottom:2px solid ${TONO.borde};font-size:11px;text-transform:uppercase;color:${TONO.tinta2};text-align:${der ? "right" : "left"}">${x}</th>`;
  const cifra = (titulo: string, valor: string) =>
    `<td class="g-cifra" style="padding:12px 14px;background:${TONO.suave};border:1px solid ${TONO.borde};border-radius:8px;width:33%">` +
    `<div style="font-size:11px;text-transform:uppercase;color:${TONO.tenue}">${titulo}</div>` +
    `<div style="font-size:20px;font-weight:700;margin-top:4px">${valor}</div></td>`;
  const cuerpo =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0"><tr>` +
    cifra("Cajas", t.cajas.toLocaleString("es-MX")) +
    cifra("Pares", t.pares.toLocaleString("es-MX")) +
    cifra("Importe", e(dinero(t.importe, b.moneda))) +
    `</tr></table>` +
    `<p style="font-size:13px;color:${TONO.tinta2};margin:14px 0">${e(fab)}${t.cbm != null ? ` · ≈ ${t.cbm.toFixed(2)} CBM` : ""}${b.descripcion ? ` · ${e(b.descripcion)}` : ""}</p>` +
    `<table class="g-t" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;border-collapse:collapse">` +
    `<tr>${familia ? th("Modelo") : ""}${th("Color")}${th("Talla / corrida")}${th("Cajas", true)}${th("Pares x caja", true)}${th("Pares", true)}${th("Precio", true)}</tr>` +
    filas +
    `</table>` +
    `<p style="font-size:12px;color:${TONO.tenue};margin-top:14px">Va adjunto el Excel ${
      perfilDeClave(b.fabrica)?.formato && perfilDeClave(b.fabrica)?.formato !== "sencillo" ? "en el formato de la fábrica" : "del pedido"
    }${
      etiquetas?.adjuntas
        ? ` y el ZIP con las etiquetas (PDF de cada talla y de la caja)${
            etiquetas.sinCodigo ? `; a ${etiquetas.sinCodigo} variantes les falta código y vienen en FALTANTES.txt` : ""
          }`
        : ""
    }.</p>`;
  const asunto = `Pedido ${b.pedido} · ${b.modelo} · ${fab}`;
  const html = plantillaCorreo({
    preencabezado: `${b.pedido} ${b.modelo}: ${t.cajas} cajas, ${t.pares} pares`,
    ceja: "Pedido a China confirmado",
    titulo: `${b.pedido} · ${b.modelo}`,
    subtitulo: fab,
    cuerpo,
    boton: { texto: "Ver pedidos pendientes por enviar", url: `${URL_ERP}/pedidos/pendientes` },
  });
  const texto =
    `${asunto}\n${t.cajas} cajas · ${t.pares} pares · ${dinero(t.importe, b.moneda)}\n\n` +
    b.lineas
      .map((l) => `${l.modelo ? `${l.modelo} ` : ""}${l.color} ${l.unitalla ? `talla ${l.unitalla}` : "corrida"}: ${l.cajas} cajas de ${l.paresPorCaja}`)
      .join("\n");
  return { asunto, html, texto };
}

/**
 * Confirma el borrador: lo da de alta como pedido (cuenta como en camino y
 * entra a Pendientes por enviar) y manda el Excel por correo. Un correo que
 * no sale NO deshace el pedido: se guarda el motivo y se puede reenviar.
 */
export async function confirmarBorrador(db: DB, accountId: string, id: string): Promise<Borrador> {
  const b = await leerBorrador(db, accountId, id);
  if (b.estado !== "borrador") throw new Error("Ese pedido ya no es borrador.");
  if (b.faltantes.length) throw new Error(`Falta ${b.faltantes.join(", ")} antes de confirmar.`);

  const ahora = new Date().toISOString();
  const pi = pedidoPIDe({ ...b, confirmadoEn: ahora });
  const archivo = nombreArchivoPedido(b.pedido, pi.renglones);
  const r = await guardarProforma(db, accountId, proformaDeBorrador(b), { archivo, origen: "sistema", fechaPi: ahora.slice(0, 10) });

  // Sin correo el pedido igual queda: se declara y se puede reenviar.
  const { error } = await db
    .from("pedidos_borradores")
    .update({ estado: "confirmado", pedido_id: r.pedidoId, confirmado_en: ahora, actualizado_en: ahora })
    .eq("id", id);
  if (error) throw new Error(`El pedido se creó pero el borrador no se marcó: ${error.message}`);

  await mandarCorreo(db, accountId, id).catch(() => null);
  return leerBorrador(db, accountId, id);
}

/** Manda (o vuelve a mandar) el correo del pedido confirmado con su Excel. */
export async function mandarCorreo(db: DB, accountId: string, id: string): Promise<Borrador> {
  const b = await leerBorrador(db, accountId, id);
  if (b.estado !== "confirmado") throw new Error("Solo se manda por correo un pedido confirmado.");
  const { destinatarios } = await leerAjustes(db, accountId);
  const pi = pedidoPIDe(b);
  const contenido = await excelDePedido(pi);
  const adjuntos = [{ nombre: nombreArchivoPedido(b.pedido, pi.renglones), contenido }];

  // El ZIP de etiquetas (el mismo de Órdenes de compra). Si no se puede
  // armar, el correo sale con el Excel y se anota por qué.
  let etiquetas: { adjuntas: boolean; sinCodigo: number } = { adjuntas: false, sinCodigo: 0 };
  let motivoEtiquetas: string | undefined;
  if (b.pedidoId) {
    try {
      const zip = await zipEtiquetasDePedido(db, accountId, b.pedidoId);
      adjuntos.push({ nombre: `${b.pedido} etiquetas.zip`, contenido: zip.contenido });
      etiquetas = { adjuntas: true, sinCodigo: zip.sinCodigo.length };
    } catch (err) {
      motivoEtiquetas = (err as Error).message;
    }
  } else {
    motivoEtiquetas = "El borrador no tiene pedido dado de alta.";
  }

  const c = correoDeBorrador(b, etiquetas);
  const res = destinatarios.length
    ? await enviarCorreo({ para: destinatarios, asunto: c.asunto, html: c.html, texto: c.texto, adjuntos })
    : { enviado: false, motivo: "No hay correos en «Mandar a»." };
  const correo = {
    enviado: res.enviado,
    para: destinatarios,
    motivo: res.motivo,
    en: new Date().toISOString(),
    ...(motivoEtiquetas ? { etiquetas: motivoEtiquetas } : {}),
  };
  await db.from("pedidos_borradores").update({ correo }).eq("id", id);
  return { ...b, correo };
}
