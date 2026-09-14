/**
 * El despacho de TikTok por CORTES.
 *
 * "Hacer corte" es la rutina de las 9 de la mañana: todo lo que está pagado
 * y sin salir se confirma en TikTok de un jalón, queda guardado como un
 * corte numerado, y de ese corte salen dos PDF que se pueden reimprimir
 * cuantas veces haga falta:
 *
 *   · las etiquetas de TikTok, en orden de modelo → color → talla, con
 *     "#n · SKU" estampado abajo a la derecha (lo demás intacto);
 *   · la lista de empaque, en el mismo orden y con los mismos números.
 *
 * TikTok no entrega la guía hasta que el envío está confirmado, así que
 * confirmar primero no es una decisión: es el único orden posible.
 */
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { traerTodo, type DB } from "../datos/repos";
import { conCacheApp } from "./cache-app";
import { codificar128 } from "../etiquetas/code128";
import { mapaAmazon } from "../etiquetas/resolver";
import { codigosMeliDeSku, indexarCodigosMeli, type IndiceCodigosMeli } from "../tiktok/codigos";
import { indexarAlias, resolverFnsku, type AliasColorAmazon } from "../tiktok/fnsku";
import { partirEnTandas, type PendienteConFecha } from "../tiktok/lunes";
import {
  enviarPaquete,
  etiquetaDePaquete,
  opcionesDeEntrega,
  paquetesDePedido,
  renglonesDelPaquete,
  type HorarioRecoleccion,
  type OpcionesEnvio,
} from "../tiktok/api";
import {
  agruparPorModelo,
  clavePaquete,
  codigoDeHoja,
  codigoDeOrden,
  numerosPreparados,
  renglonesDeEtiqueta,
  numerarPaquetes,
  type PaqueteDespacho,
  type PaqueteNumerado,
} from "../tiktok/despacho";
import { efectoDeEstado } from "../tiktok/kardex";
import { clienteDeCuenta, sincronizarPedidosPorId } from "./tiktok";
import { urlSalidasIndusther } from "./tiktok-3pl";
import { empujarSalidasAl3pl, registrarSalidasDeCorte } from "./tiktok-3pl";

/** Lo que entra en un corte: pagado sin salir, o ya salido pero sin corte. */
const ESTADOS_DESPACHABLES = new Set(["AWAITING_SHIPMENT", "PARTIALLY_SHIPPING", "AWAITING_COLLECTION"]);

export interface ResultadoCorte {
  corteId: number;
  numero: number;
  pedidos: number;
  pares: number;
  errores: { orderId: string; error: string }[];
  publicados: number;
  /** cómo le fue a la salida hacia el 3PL */
  al3pl: { mandadas: number; confirmadas: number; error: string | null; sinEndpoint: boolean };
}

/** Corre `fn` sobre `items` con a lo más `n` a la vez, en orden de arranque. */
async function enParalelo<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let siguiente = 0;
  const obreros = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      await fn(items[i], i);
    }
  });
  await Promise.all(obreros);
}

/** Las equivalencias de color TikTok → Amazon de la cuenta, ya indexadas. */
export async function aliasAmazonDeCuenta(db: DB, accountId: string): Promise<Map<string, string>> {
  const filas = await traerTodo<any>(db, "tiktok_alias_amazon", "modelo, color_tiktok, color_amazon", (q) =>
    q.eq("account_id", accountId),
  );
  const alias: AliasColorAmazon[] = (filas ?? []).map((f: any) => ({
    modelo: String(f.modelo),
    colorTikTok: String(f.color_tiktok),
    colorAmazon: String(f.color_amazon),
  }));
  return indexarAlias(alias);
}

/** Clave y frescura del catálogo de códigos Full masticado. */
const CLAVE_CODIGOS_FULL = "codigos-full";
const TTL_CODIGOS_FULL = 30 * 60_000;

/** Los pares (SKU, código Full) de los DOS catálogos de MELI, tal cual. */
async function paresCodigosFull(db: DB, accountId: string): Promise<[string, string][]> {
  const vacio = () => [] as any[];
  const [calzado, fundas] = await Promise.all([
    traerTodo<any>(db, "skus", "sku, inventory_id", (q) =>
      q.eq("account_id", accountId).not("inventory_id", "is", null),
    ).catch(vacio),
    traerTodo<any>(db, "yz_skus", "sku, inventory_id", (q) => q.not("inventory_id", "is", null)).catch(vacio),
  ]);
  return [...(calzado ?? []), ...(fundas ?? [])]
    .filter((f: any) => f?.sku && f?.inventory_id)
    .map((f: any) => [String(f.sku), String(f.inventory_id)] as [string, string]);
}

/**
 * Los códigos Full de MELI de los dos catálogos: el de calzado (`skus`, de
 * esta cuenta) y el de fundas (`yz_skus`). Son la OTRA etiqueta que puede
 * traer pegada la caja, así que la estación de preparar también los acepta.
 *
 * Los DOS catálogos entran COMPLETOS y con los tres amarres del ERP
 * (canónico, ordenado y aplastado): cómo esté escrito el SKU en cada cuenta
 * no tiene por qué importar, lo que importa es que el código sea de ese
 * producto. Como son ~17 mil variantes entre las dos, el catálogo se mastica
 * y se guarda (`app_cache`, clave `codigos-full`, media hora): la pantalla
 * lee un renglón. Si el caché o alguna tabla falla, se calcula al vuelo y,
 * en el peor caso, se escanea el FNSKU como siempre.
 */
export async function codigosMeliDeCuenta(db: DB, accountId: string): Promise<IndiceCodigosMeli> {
  let pares: [string, string][] = [];
  try {
    pares = await conCacheApp(db, accountId, CLAVE_CODIGOS_FULL, TTL_CODIGOS_FULL, () =>
      paresCodigosFull(db, accountId),
    );
  } catch {
    pares = await paresCodigosFull(db, accountId).catch(() => []);
  }
  return indexarCodigosMeli(pares.map(([sku, inventoryId]) => ({ sku, inventoryId })));
}

/** Bucket privado donde se guardan las guías (una por paquete) y el PDF del corte. */
export const BUCKET_GUIAS = "tiktok-guias";

/** El primer horario que todavía no pasó; si todos pasaron, el último. */
export function primerHorario(horarios: HorarioRecoleccion[]): HorarioRecoleccion | null {
  if (!horarios.length) return null;
  const ahora = Math.floor(Date.now() / 1000);
  const ordenados = [...horarios].sort((a, b) => a.inicio - b.inicio);
  return ordenados.find((h) => h.fin > ahora) ?? ordenados[ordenados.length - 1];
}

/** Los pedidos que entrarían en el siguiente corte, con la fecha en que se vendieron. */
export async function pendientesDeCorte(db: DB, accountId: string): Promise<PendienteConFecha[]> {
  const filas = await traerTodo<any>(db, "tiktok_ordenes", "order_id, estado, corte_id, fecha_creacion", (q) =>
    q.eq("account_id", accountId).is("corte_id", null),
  );
  return (filas ?? [])
    .filter((o: any) => ESTADOS_DESPACHABLES.has(String(o.estado).toUpperCase()))
    .map((o: any) => ({ orderId: o.order_id, estado: o.estado, creadoEn: o.fecha_creacion ?? null }));
}

/**
 * Confirma en TikTok todos los envíos pendientes y los deja en un corte.
 * Un pedido que TikTok rechace se anota y se queda fuera del corte (entra
 * al siguiente cuando se arregle); los demás siguen.
 */
export async function hacerCorte(
  admin: any,
  accountId: string,
  opciones: {
    handover: OpcionesEnvio["handover"];
    creadoPor?: string | null;
    /** si viene, el corte se hace SOLO con estos pedidos (el corte del lunes) */
    soloPedidos?: string[];
    /** cuánto tiempo puede gastar con TikTok (el corte partido reparte el rato) */
    msDisponibles?: number;
  },
): Promise<ResultadoCorte> {
  const cliente = await clienteDeCuenta(admin, accountId, opciones.msDisponibles ?? 240_000);
  if (!cliente || !cliente.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");

  const todos = await pendientesDeCorte(admin, accountId);
  const filtro = opciones.soloPedidos ? new Set(opciones.soloPedidos) : null;
  const pendientes = filtro ? todos.filter((p) => filtro.has(p.orderId)) : todos;
  if (!pendientes.length) throw new Error("No hay pedidos por despachar.");

  const errores: { orderId: string; error: string }[] = [];

  let dropOff = 0;
  const confirmados: string[] = [];

  // Con 200 pedidos, uno por uno no cabe en el tiempo de Vercel: se
  // confirman VARIOS a la vez (cada pedido son 2 o 3 llamadas a TikTok).
  // El orden de `confirmados` no importa: el corte se numera después.
  await enParalelo(pendientes, 4, async (p) => {
    if (cliente.msRestantes() < 30_000) {
      errores.push({ orderId: p.orderId, error: "Se acabó el tiempo; entra al siguiente corte." });
      return;
    }
    // Lo que ya salió (sin corte) no se vuelve a confirmar: solo se agrupa.
    if (efectoDeEstado(p.estado) === "salida") {
      confirmados.push(p.orderId);
      return;
    }
    try {
      const paquetes = await paquetesDePedido(cliente, p.orderId);
      if (!paquetes.length) throw new Error("TikTok no tiene paquete para este pedido.");
      for (const pk of paquetes) {
        // Recolección: hay que decirle a TikTok CUÁNDO. Sin horario acepta
        // la petición pero la vuelve drop-off, que es justo lo que pasó en
        // el primer corte. Se toma el primer horario que ofrezca.
        let horario: HorarioRecoleccion | null = null;
        let handover = opciones.handover;
        if (opciones.handover === "PICKUP") {
          try {
            const e = await opcionesDeEntrega(cliente, pk.id);
            horario = primerHorario(e.horarios);
            if (!horario) {
              // Sin horario no hay recolección posible. Se manda como
              // drop-off A PROPÓSITO y se deja escrito por qué, en vez de
              // mandar PICKUP a ciegas y que TikTok lo convierta en silencio.
              // Es el modo normal de esta tienda (la paquetería no recoge en
              // esa dirección): no se anota como error, solo se cuenta.
              handover = "DROP_OFF";
              dropOff++;
            }
          } catch (err) {
            errores.push({ orderId: p.orderId, error: `Sin horario de recolección: ${(err as Error).message}. Se mandó como recolección sin horario.` });
          }
        }
        try {
          await enviarPaquete(cliente, pk.id, { handover, horario });
        } catch (err) {
          // Si TikTok dice que ya estaba enviado, no es error: es que alguien
          // lo confirmó a mano en el Seller Center.
          const m = (err as Error).message;
          if (!/already|ya .*enviad|shipped|SHIPPED/i.test(m)) throw err;
        }
      }
      confirmados.push(p.orderId);
    } catch (err) {
      errores.push({ orderId: p.orderId, error: (err as Error).message });
    }
  });

  // El número del corte: consecutivo por cuenta.
  const { data: ultimo } = await admin
    .from("tiktok_cortes")
    .select("numero")
    .eq("account_id", accountId)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();
  const numero = (ultimo?.numero ?? 0) + 1;

  // Pares del corte, de los renglones ya guardados.
  const items = confirmados.length
    ? await traerTodo<any>(admin, "tiktok_orden_items", "order_id, sku_interno, seller_sku, cantidad, estado", (q) =>
        q.eq("account_id", accountId).in("order_id", confirmados),
      )
    : [];
  const pares = (items ?? []).reduce((a: number, i: any) => a + (i.cantidad ?? 0), 0);

  const { data: corte, error } = await admin
    .from("tiktok_cortes")
    .insert({
      account_id: accountId,
      numero,
      creado_por: opciones.creadoPor ?? null,
      handover: opciones.handover,
      pedidos: confirmados.length,
      pares,
      errores,
    })
    .select("id")
    .single();
  if (error || !corte) throw new Error(`No se pudo guardar el corte: ${error?.message ?? "sin id"}`);

  if (confirmados.length) {
    await admin
      .from("tiktok_ordenes")
      .update({ corte_id: corte.id })
      .eq("account_id", accountId)
      .in("order_id", confirmados);
  }

  // Una sola relectura para todos: TikTok ya los tiene en AWAITING_COLLECTION,
  // eso genera las salidas del kardex y republica el disponible.
  let publicados = 0;
  if (confirmados.length) {
    const r = await sincronizarPedidosPorId(admin, accountId, confirmados);
    publicados = r.publicados;
  }

  // Y las mismas salidas, al 3PL: que Industher también baje su número. Se
  // registran por (pedido, SKU) y se mandan; lo que no confirme se reintenta
  // en el cron. Un renglón sin SKU del ERP no se manda: el 3PL no lo conoce.
  const porPedidoYSku = new Map<string, { orderId: string; sku: string; pares: number }>();
  for (const i of items ?? []) {
    if (!i.sku_interno || efectoDeEstado(i.estado) === "reversa") continue;
    const k = `${i.order_id}|${i.sku_interno}`;
    const prev = porPedidoYSku.get(k) ?? { orderId: i.order_id, sku: i.sku_interno, pares: 0 };
    prev.pares += i.cantidad ?? 0;
    porPedidoYSku.set(k, prev);
  }
  await registrarSalidasDeCorte(admin, accountId, corte.id, [...porPedidoYSku.values()]);
  const al3pl = await empujarSalidasAl3pl(admin, accountId, corte.id);

  return { corteId: corte.id, numero, pedidos: confirmados.length, pares, errores, publicados, al3pl };
}

// ---------------------------------------------------------------------------
// El corte del LUNES: primero lo atrasado, luego lo de ayer y hoy
// ---------------------------------------------------------------------------

export interface ResultadoCorteLunes {
  /** los cortes que se hicieron, en orden: primero el de lo atrasado */
  cortes: ResultadoCorte[];
  /** pedidos que se quedaron para el siguiente corte porque no alcanzó el tiempo */
  pendientes: number;
  aviso: string | null;
}

/** Tiempo total que se puede gastar en los dos cortes (el techo de Vercel es 300 s). */
const MS_CORTE_LUNES = 260_000;

/**
 * El corte del lunes, partido en dos.
 *
 * El lunes se despacha lo del viernes, sábado y domingo, y lo del viernes y
 * sábado ya casi cumple las 48 horas que da TikTok. Así que se hace PRIMERO
 * un corte completo con eso —sale con su etiqueta, su lista y su surtido, y
 * se empaca de una vez— y luego un segundo corte con lo del domingo y el
 * lunes, que todavía tiene tiempo.
 *
 * Si el primero se come el rato disponible, el segundo NO se hace a medias:
 * se dice cuántos pedidos quedaron y el botón normal de "Hacer corte" los
 * toma completos (son, exactamente, los que sobraron).
 */
export async function hacerCorteLunes(
  admin: any,
  accountId: string,
  opciones: { handover: OpcionesEnvio["handover"]; creadoPor?: string | null },
): Promise<ResultadoCorteLunes> {
  const arranque = Date.now();
  const pendientes = await pendientesDeCorte(admin, accountId);
  if (!pendientes.length) throw new Error("No hay pedidos por despachar.");

  const { urgentes, resto } = partirEnTandas(pendientes);

  // Sin nada atrasado (o con TODO atrasado) no hay nada que partir: un solo
  // corte, igual que el botón de siempre.
  if (!urgentes.length || !resto.length) {
    const unico = await hacerCorte(admin, accountId, { ...opciones, msDisponibles: MS_CORTE_LUNES });
    return {
      cortes: [unico],
      pendientes: 0,
      aviso: urgentes.length
        ? "Todo lo pendiente ya tenía dos días o más: se hizo un solo corte."
        : "No hay pedidos atrasados: se hizo un solo corte.",
    };
  }

  // Primero lo atrasado, con la mitad del rato: lo urgente nunca se queda
  // sin corte por culpa de lo que todavía tiene tiempo.
  const primero = await hacerCorte(admin, accountId, {
    ...opciones,
    soloPedidos: urgentes.map((p) => p.orderId),
    msDisponibles: Math.floor(MS_CORTE_LUNES / 2),
  });

  const restante = MS_CORTE_LUNES - (Date.now() - arranque);
  if (restante < 45_000) {
    return {
      cortes: [primero],
      pendientes: resto.length,
      aviso:
        `Ya salió el corte de lo atrasado (${primero.pedidos} pedidos). No alcanzó el tiempo para el segundo: ` +
        `dale otra vez a "Hacer corte" y se lleva los ${resto.length} del domingo y el lunes.`,
    };
  }

  const segundo = await hacerCorte(admin, accountId, {
    ...opciones,
    soloPedidos: resto.map((p) => p.orderId),
    msDisponibles: restante,
  });
  return { cortes: [primero, segundo], pendientes: 0, aviso: null };
}

// ---------------------------------------------------------------------------
// Los paquetes de un corte, ya ordenados y numerados
// ---------------------------------------------------------------------------

export interface CorteCargado {
  id: number;
  numero: number;
  creadoEn: string;
  paquetes: PaqueteNumerado[];
}

export async function cargarCorte(admin: any, accountId: string, corteId: number): Promise<CorteCargado> {
  const { data: corte } = await admin
    .from("tiktok_cortes")
    .select("id, numero, creado_en")
    .eq("account_id", accountId)
    .eq("id", corteId)
    .maybeSingle();
  if (!corte) throw new Error("Ese corte no existe.");

  const [ordenes, items] = await Promise.all([
    traerTodo<any>(admin, "tiktok_ordenes", "order_id, paquetes, detalle", (q) =>
      q.eq("account_id", accountId).eq("corte_id", corteId),
    ),
    traerTodo<any>(admin, "tiktok_orden_items", "order_id, line_item_id, sku_interno, seller_sku, cantidad", (q) =>
      q.eq("account_id", accountId),
    ),
  ]);
  const ordenIds = new Set((ordenes ?? []).map((o: any) => o.order_id));
  const itemsPorOrden = new Map<string, any[]>();
  for (const i of items ?? []) {
    if (!ordenIds.has(i.order_id)) continue;
    const l = itemsPorOrden.get(i.order_id) ?? [];
    l.push(i);
    itemsPorOrden.set(i.order_id, l);
  }

  // El FNSKU es el código de barras que ya trae la caja del zapato (las
  // etiquetas de Amazon se imprimen para todo). Es lo que se escanea.
  // El FNSKU es el que se imprime, pero la caja puede traer pegada la
  // etiqueta de Full de cualquiera de las dos cuentas de MELI: sus códigos
  // también valen para dar el par por bueno.
  const [amazon, alias, meli] = await Promise.all([
    mapaAmazon(admin),
    aliasAmazonDeCuenta(admin, accountId),
    codigosMeliDeCuenta(admin, accountId),
  ]);
  const fnskuDe = (sku: string) => resolverFnsku(amazon, alias, sku);

  const cliente = await clienteDeCuenta(admin, accountId, 120_000);
  const paquetes: PaqueteDespacho[] = [];

  for (const o of ordenes ?? []) {
    let ids: string[] = ((o.paquetes ?? []) as any[]).map((p) => String(p.id));
    if (!ids.length && cliente) {
      const desdeTikTok = await paquetesDePedido(cliente, o.order_id);
      ids = desdeTikTok.map((p) => p.id);
      if (ids.length) {
        await admin
          .from("tiktok_ordenes")
          .update({ paquetes: desdeTikTok })
          .eq("account_id", accountId)
          .eq("order_id", o.order_id);
      }
    }

    const renglones = itemsPorOrden.get(o.order_id) ?? [];
    const aPar = (lista: any[]) => {
      const porSku = new Map<string, number>();
      for (const r of lista) {
        const sku = r.sku_interno ?? r.seller_sku ?? "(sin SKU)";
        porSku.set(sku, (porSku.get(sku) ?? 0) + (r.cantidad ?? 1));
      }
      return [...porSku].map(([sku, pares]) => ({
        sku,
        pares,
        fnsku: fnskuDe(sku),
        codigos: codigosMeliDeSku(meli, sku),
      }));
    };

    if (ids.length <= 1) {
      paquetes.push({
        orderId: o.order_id,
        packageId: ids[0] ?? "",
        destinatario: o.detalle?.destinatario ?? null,
        pares: aPar(renglones),
      });
      continue;
    }

    // Varios paquetes: cada uno lleva sus propios renglones. Si TikTok no
    // dice cuáles, se estampan todos en cada etiqueta antes que adivinar.
    for (const id of ids) {
      let propios = renglones;
      try {
        const lineIds = cliente ? await renglonesDelPaquete(cliente, id) : [];
        if (lineIds.length) {
          const set = new Set(lineIds);
          propios = renglones.filter((r) => set.has(String(r.line_item_id)));
        }
      } catch {
        /* se estampan todos */
      }
      paquetes.push({
        orderId: o.order_id,
        packageId: id,
        destinatario: o.detalle?.destinatario ?? null,
        pares: aPar(propios.length ? propios : renglones),
      });
    }
  }

  return { id: corte.id, numero: corte.numero, creadoEn: corte.creado_en, paquetes: numerarPaquetes(paquetes) };
}

// ---------------------------------------------------------------------------
// PDF de etiquetas: las de TikTok, en orden, con "#n · SKU" abajo a la derecha
// ---------------------------------------------------------------------------

/** Tamaño A6 en puntos, por si la guía llega como imagen y hay que darle hoja. */
const A6: [number, number] = [297.64, 419.53];

/** Sube cuando cambia el estampado de la guía (invalida los PDF de corte guardados). */
const VERSION_ESTAMPA = 5;

/** Dónde va el estampado: abajo a la derecha, pegado al borde. */
const ESTAMPA = { margen: 6, tamano: 7, barrasAlto: 20, barrasAnchoMax: 120, porColumna: 3 };

/** Code 128 en pdf-lib: barras negras sobre lo que haya (las guías son blancas ahí). */
function dibujarBarras(page: PDFPage, texto: string, x: number, y: number, anchoTotal: number, alto: number) {
  const barras = codificar128(texto);
  const modulo = anchoTotal / barras.modulos;
  let cursor = x;
  let esBarra = true;
  for (const a of barras.anchos) {
    const ancho = a * modulo;
    if (esBarra) page.drawRectangle({ x: cursor, y, width: ancho, height: alto, color: rgb(0, 0, 0) });
    cursor += ancho;
    esBarra = !esBarra;
  }
}

/** Ancho natural de un Code 128 a ~0.75 pt por módulo, topado. */
function anchoBarras(texto: string, tope: number): number {
  return Math.min(tope, codificar128(texto).modulos * 0.75);
}

/** Lee un archivo del bucket de guías; null si no existe. */
async function leerGuia(admin: any, ruta: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(BUCKET_GUIAS).download(ruta);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function guardarGuia(admin: any, ruta: string, bytes: Uint8Array, contentType: string): Promise<string | null> {
  try {
    const { error } = await admin.storage.from(BUCKET_GUIAS).upload(ruta, bytes, { contentType, upsert: true });
    return error ? String(error.message ?? error) : null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * La guía de un paquete: primero del bucket (ya se bajó una vez), si no,
 * de TikTok, y se guarda para la próxima. Las URLs de TikTok caducan y
 * bajar 170 guías en cada impresión no cabe en el tiempo de Vercel.
 */
async function bytesDeGuia(admin: any, cliente: any, accountId: string, packageId: string): Promise<{ bytes: Uint8Array | null; error: string | null }> {
  const ruta = `${accountId}/${packageId}.pdf`;
  const guardada = await leerGuia(admin, ruta);
  if (guardada?.length) return { bytes: guardada, error: null };
  let error = "sin guía";
  // Dos intentos con pausa: TikTok limita las llamadas y la guía de un
  // paquete recién confirmado a veces tarda unos segundos en existir.
  for (let intento = 0; intento < 2; intento++) {
    try {
      const url = await etiquetaDePaquete(cliente, packageId);
      if (!url) throw new Error("TikTok no devolvió la guía");
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`descarga ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (esPdf(bytes) || esPng(bytes) || esJpg(bytes)) await guardarGuia(admin, ruta, bytes, r.headers.get("content-type") ?? "application/pdf");
      return { bytes, error: null };
    } catch (err) {
      error = (err as Error).message;
      if (intento === 0) await new Promise((res) => setTimeout(res, 2500));
    }
  }
  return { bytes: null, error };
}

export async function pdfEtiquetasDelCorte(admin: any, accountId: string, corteId: number): Promise<Uint8Array> {
  // El PDF del corte ya armado: reimprimir es leer un archivo. La versión
  // del estampado va en el nombre: si cambia lo que se imprime abajo a la
  // derecha, los cortes viejos se rearman con las guías ya guardadas.
  const rutaCorte = `${accountId}/corte-${corteId}-e${VERSION_ESTAMPA}.pdf`;
  const listo = await leerGuia(admin, rutaCorte);
  if (listo?.length) return listo;

  const corte = await cargarCorte(admin, accountId, corteId);
  const cliente = await clienteDeCuenta(admin, accountId, 240_000);
  if (!cliente || !cliente.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");

  // Todas las guías primero, varias a la vez; el armado va después, en orden.
  const guias = new Map<string, { bytes: Uint8Array | null; error: string | null }>();
  await enParalelo(corte.paquetes, 3, async (p) => {
    if (!p.packageId) {
      guias.set(`${p.orderId}|${p.packageId}`, { bytes: null, error: "sin paquete en TikTok" });
      return;
    }
    guias.set(`${p.orderId}|${p.packageId}`, await bytesDeGuia(admin, cliente, accountId, p.packageId));
  });

  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Corte ${corte.numero} · etiquetas TikTok`);

  // Abajo: a la IZQUIERDA los SKU del paquete ("#n · SKU ×cantidad", un
  // renglón por producto) y a la DERECHA el CÓDIGO DEL PEDIDO en barras (el
  // mismo que en la hoja: escanearlo en la estación enseña qué va adentro).
  // El FNSKU se escanea de la caja del zapato, no de la guía.
  const estampar = (pagina: PDFPage, p: PaqueteNumerado) => {
    const { width } = pagina.getSize();
    const derecha = width - ESTAMPA.margen;
    const renglones = renglonesDeEtiqueta(p, corte.numero);
    const codigoOrden = codigoDeOrden(p.orderId);
    const codigo = codigoOrden || codigoDeHoja(corte.numero, p.numero);
    const anchoCodigo = anchoBarras(codigo, ESTAMPA.barrasAnchoMax);
    dibujarBarras(pagina, codigo, Math.max(ESTAMPA.margen, derecha - anchoCodigo), ESTAMPA.margen + ESTAMPA.tamano + 2, anchoCodigo, ESTAMPA.barrasAlto);
    const numeroOrden = `Pedido ${p.orderId}`;
    pagina.drawText(numeroOrden, {
      x: Math.max(ESTAMPA.margen, derecha - fuente.widthOfTextAtSize(numeroOrden, 5.5)),
      y: ESTAMPA.margen,
      size: 5.5,
      font: fuente,
      color: rgb(0, 0, 0),
    });
    let y = ESTAMPA.margen;
    // Los renglones de texto a la izquierda, del primero (con el "#n") hacia arriba.
    for (const r of renglones) {
      pagina.drawText(r.texto, { x: ESTAMPA.margen, y, size: ESTAMPA.tamano, font: fuente, color: rgb(0, 0, 0) });
      y += ESTAMPA.tamano + 2;
    }
  };

  let sinGuia = 0;
  for (const p of corte.paquetes) {
    const g = guias.get(`${p.orderId}|${p.packageId}`) ?? { bytes: null, error: "sin guía" };
    const bytes = g.bytes;
    const error = g.error;
    if (!bytes) sinGuia++;

    if (bytes && esPdf(bytes)) {
      const origen = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copias = await doc.copyPages(origen, origen.getPageIndices());
      for (const pagina of copias) {
        doc.addPage(pagina);
        estampar(pagina, p);
      }
      continue;
    }

    if (bytes && (esPng(bytes) || esJpg(bytes))) {
      const img = esPng(bytes) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const pagina = doc.addPage(A6);
      const escala = Math.min(A6[0] / img.width, A6[1] / img.height);
      const w = img.width * escala;
      const h = img.height * escala;
      pagina.drawImage(img, { x: (A6[0] - w) / 2, y: A6[1] - h, width: w, height: h });
      estampar(pagina, p);
      continue;
    }

    // Sin guía: una hoja que lo diga, para que la numeración no se corra.
    const pagina = doc.addPage(A6);
    pagina.drawText(`SIN GUÍA — pedido ${p.orderId}`, { x: 20, y: A6[1] - 60, size: 12, font: fuente });
    pagina.drawText((error ?? "formato desconocido").slice(0, 90), { x: 20, y: A6[1] - 80, size: 7, font: fuente });
    pagina.drawText("Vuelve a pedir el PDF: solo se bajan las que faltan.", { x: 20, y: A6[1] - 96, size: 7, font: fuente });
    estampar(pagina, p);
  }

  const salida = await doc.save();
  // Solo se guarda el PDF del corte si salió completo: con una guía que
  // TikTok no dio, la siguiente impresión la vuelve a intentar.
  const errorGuardado = sinGuia ? null : await guardarGuia(admin, rutaCorte, salida, "application/pdf");

  // Bitácora: cuántas guías faltaron y por qué, y si el bucket falló. Es lo
  // que permite ver desde la base qué pasó con una impresión.
  const motivos = new Map<string, number>();
  for (const g of guias.values()) if (g.error) motivos.set(g.error, (motivos.get(g.error) ?? 0) + 1);
  await admin
    .from("tiktok_sync_log")
    .insert({
      account_id: accountId,
      tarea: "guias",
      inicio: new Date().toISOString(),
      fin: new Date().toISOString(),
      estado: sinGuia || errorGuardado ? "con avisos" : "ok",
      detalle: { corteId, paquetes: corte.paquetes.length, sinGuia, motivos: Object.fromEntries(motivos), errorGuardado },
    })
    .then(() => undefined, () => undefined);
  return salida;
}

function esPdf(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
}
function esPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}
function esJpg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

// ---------------------------------------------------------------------------
// PDF de la lista de empaque: por modelo, mismos números
// ---------------------------------------------------------------------------

export async function pdfListaDelCorte(admin: any, accountId: string, corteId: number): Promise<Uint8Array> {
  const corte = await cargarCorte(admin, accountId, corteId);
  const grupos = agruparPorModelo(corte.paquetes);

  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Corte ${corte.numero} · lista de empaque`);

  const CARTA: [number, number] = [612, 792];
  const M = 36;
  const ANCHO = CARTA[0] - 2 * M;
  // Columnas: # | PEDIDO en barras (se escanea primero) | SKU × cant. | FNSKU (barras: la caja) | destinatario | ☐
  const COL = [26, 128, 150, 128, ANCHO - 26 - 128 - 150 - 128 - 18, 18];
  const FILA = 34;
  const gris = rgb(0.45, 0.45, 0.45);
  const linea = rgb(0.75, 0.75, 0.75);

  let pagina = doc.addPage(CARTA);
  let y = CARTA[1] - M;

  const fecha = new Date(corte.creadoEn).toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const totalPares = grupos.reduce((a, g) => a + g.pares, 0);

  const nuevaPagina = () => {
    pagina = doc.addPage(CARTA);
    y = CARTA[1] - M;
  };
  const texto = (t: string, x: number, size: number, f = normal, color = rgb(0, 0, 0)) =>
    pagina.drawText(t, { x, y, size, font: f, color });
  const recorta = (t: string, ancho: number, size: number, f = normal) => {
    let s = t;
    while (s.length > 1 && f.widthOfTextAtSize(s, size) > ancho - 4) s = s.slice(0, -1);
    return s === t ? t : s.slice(0, -1) + "…";
  };

  const encabezado = () => {
    const xs = COL.reduce<number[]>((acc, w, i) => [...acc, (acc[i - 1] ?? M) + (i ? COL[i - 1] : 0)], []);
    const titulos = ["#", "1. Pedido (escanear)", "SKU × cant.", "2. Producto (FNSKU)", "Destinatario", ""];
    titulos.forEach((t, i) => pagina.drawText(t, { x: xs[i] + 2, y, size: 8, font: negrita, color: gris }));
    y -= 4;
    pagina.drawLine({ start: { x: M, y }, end: { x: M + ANCHO, y }, thickness: 0.8, color: linea });
    y -= FILA;
  };

  texto(`Corte #${corte.numero} · TikTok Shop · lista de empaque`, M, 15, negrita);
  y -= 16;
  texto(`${fecha}   ·   ${corte.paquetes.length} paquetes   ·   ${totalPares} pares`, M, 9, normal, gris);
  y -= 14;
  texto("Resumen: " + grupos.map((g) => `${g.modelo} ${g.pares}`).join("   ·   "), M, 9);
  y -= 22;

  for (const g of grupos) {
    if (y < M + FILA * 3) nuevaPagina();
    const titulo = g.revuelto ? `${g.modelo.toUpperCase()} (varios modelos en la misma caja)` : g.modelo;
    texto(`${titulo}  —  ${g.pares} ${g.pares === 1 ? "par" : "pares"} en ${g.paquetes.length} ${g.paquetes.length === 1 ? "paquete" : "paquetes"}`, M, 11, negrita);
    y -= 14;
    encabezado();

    for (const p of g.paquetes) {
      const renglones = renglonesDeEtiqueta(p, corte.numero);
      // El paquete completo cabe en la página o se pasa entero a la siguiente.
      if (y - FILA * (renglones.length - 1) < M) {
        nuevaPagina();
        encabezado();
      }
      const xs = COL.reduce<number[]>((acc, w, i) => [...acc, (acc[i - 1] ?? M) + (i ? COL[i - 1] : 0)], []);
      const yArribaPaquete = y + FILA - 4;

      // UN RENGLÓN POR PRODUCTO. En el primero va el NÚMERO DE PEDIDO en
      // barras (se escanea primero: elige ese paquete exacto aunque haya
      // veinte iguales); en cada renglón, el FNSKU en barras (el de la caja).
      const codigoOrden = codigoDeOrden(p.orderId);
      renglones.forEach((r, i) => {
        const arriba = y + FILA - 12;
        const etiquetaSku = r.pares > 1 ? `${r.sku} ×${r.pares}` : r.sku;
        if (i === 0) {
          pagina.drawText(`#${p.numero}`, { x: xs[0] + 2, y: arriba, size: 10, font: negrita });
          if (codigoOrden) {
            dibujarBarras(pagina, codigoOrden, xs[1] + 2, y + 9, anchoBarras(codigoOrden, COL[1] - 6), 18);
            pagina.drawText(p.orderId, { x: xs[1] + 2, y: y + 1, size: 6, font: normal, color: gris });
          }
        } else {
          pagina.drawText(`#${p.numero}`, { x: xs[0] + 2, y: arriba, size: 8, font: normal, color: gris });
        }
        pagina.drawText(recorta(etiquetaSku, COL[2], 9, negrita), { x: xs[2] + 2, y: arriba, size: 9, font: negrita });
        if (!r.esHoja) {
          dibujarBarras(pagina, r.codigo, xs[3] + 2, y + 9, anchoBarras(r.codigo, COL[3] - 6), 18);
          pagina.drawText(r.codigo, { x: xs[3] + 2, y: y + 1, size: 6, font: normal, color: gris });
        } else {
          pagina.drawText("sin FNSKU (Dar por bueno)", { x: xs[3] + 2, y: arriba, size: 7, font: normal, color: gris });
        }
        if (i === 0) {
          pagina.drawText(recorta(p.destinatario ?? "", COL[4], 7.5), { x: xs[4] + 2, y: arriba, size: 7.5, font: normal, color: gris });
          pagina.drawRectangle({ x: xs[5] + 3, y: y + 10, width: 11, height: 11, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
        }
        if (i < renglones.length - 1) {
          pagina.drawLine({ start: { x: M + COL[0], y: y - 2 }, end: { x: M + ANCHO, y: y - 2 }, thickness: 0.3, color: linea });
        }
        y -= FILA;
      });

      // Un paquete con varios productos va dentro de un recuadro negro:
      // todo lo de adentro se empaca junto, en la misma caja.
      if (renglones.length > 1) {
        pagina.drawRectangle({
          x: M - 2,
          y: y + FILA - 4,
          width: ANCHO + 4,
          height: yArribaPaquete - (y + FILA - 4),
          borderColor: rgb(0, 0, 0),
          borderWidth: 1.2,
        });
      } else {
        pagina.drawLine({ start: { x: M, y: y + FILA - 2 }, end: { x: M + ANCHO, y: y + FILA - 2 }, thickness: 0.4, color: linea });
      }
    }
    y -= 10;
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// PDF de la lista de surtido: cuántos pares de cada SKU, para jalar de bodega
// ---------------------------------------------------------------------------

/**
 * La lista de SURTIDO del corte: un renglón por SKU con sus pares totales,
 * en orden alfabético. Es la hoja con la que se jala la mercancía de la
 * bodega antes de empacar: no importa de qué pedido es cada par, solo
 * cuántos de cada uno hay que traer a la mesa.
 */
export async function pdfSurtidoDelCorte(admin: any, accountId: string, corteId: number): Promise<Uint8Array> {
  const corte = await cargarCorte(admin, accountId, corteId);

  const porSku = new Map<string, { pares: number; fnsku: string | null }>();
  for (const p of corte.paquetes) {
    for (const x of p.pares) {
      const prev = porSku.get(x.sku) ?? { pares: 0, fnsku: x.fnsku ?? null };
      prev.pares += x.pares;
      if (!prev.fnsku && x.fnsku) prev.fnsku = x.fnsku;
      porSku.set(x.sku, prev);
    }
  }
  const filas = [...porSku]
    .map(([sku, d]) => ({ sku, ...d }))
    .sort((a, b) => a.sku.localeCompare(b.sku, "es", { numeric: true }));
  const totalPares = filas.reduce((a, f) => a + f.pares, 0);

  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Corte ${corte.numero} · lista de surtido`);

  const CARTA: [number, number] = [612, 792];
  const M = 36;
  const ANCHO = CARTA[0] - 2 * M;
  const FILA = 22;
  const gris = rgb(0.45, 0.45, 0.45);
  const linea = rgb(0.75, 0.75, 0.75);
  // Columnas: SKU | FNSKU | pares | ☐
  const COL = [ANCHO - 130 - 70 - 18, 130, 70, 18];

  let pagina = doc.addPage(CARTA);
  let y = CARTA[1] - M;
  const xs = COL.reduce<number[]>((acc, w, i) => [...acc, (acc[i - 1] ?? M) + (i ? COL[i - 1] : 0)], []);

  const encabezado = () => {
    const titulos = ["SKU", "FNSKU", "Pares", ""];
    titulos.forEach((t, i) => pagina.drawText(t, { x: xs[i] + 2, y, size: 8, font: negrita, color: gris }));
    y -= 4;
    pagina.drawLine({ start: { x: M, y }, end: { x: M + ANCHO, y }, thickness: 0.8, color: linea });
    y -= FILA;
  };

  const fecha = new Date(corte.creadoEn).toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City",
  });
  pagina.drawText(`Corte #${corte.numero} · TikTok Shop · lista de surtido`, { x: M, y, size: 15, font: negrita });
  y -= 16;
  pagina.drawText(`${fecha}   ·   ${filas.length} SKU   ·   ${totalPares} pares`, { x: M, y, size: 9, font: normal, color: gris });
  y -= 20;
  encabezado();

  for (const f of filas) {
    if (y < M) {
      pagina = doc.addPage(CARTA);
      y = CARTA[1] - M;
      encabezado();
    }
    pagina.drawText(f.sku, { x: xs[0] + 2, y, size: 10, font: negrita });
    pagina.drawText(f.fnsku ?? "—", { x: xs[1] + 2, y, size: 8.5, font: normal, color: gris });
    pagina.drawText(String(f.pares), { x: xs[2] + 2, y, size: 11, font: negrita });
    pagina.drawRectangle({ x: xs[3] + 2, y: y - 2, width: 11, height: 11, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
    pagina.drawLine({ start: { x: M, y: y - 6 }, end: { x: M + ANCHO, y: y - 6 }, thickness: 0.4, color: linea });
    y -= FILA;
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// Los faltantes del corte: qué pedidos se quedaron sin preparar
// ---------------------------------------------------------------------------

export interface PaqueteFaltante {
  numero: number;
  orderId: string;
  packageId: string;
  destinatario: string | null;
  revuelto: boolean;
  pares: { sku: string; pares: number; fnsku: string | null }[];
}

export interface FaltantesCorte {
  id: number;
  numero: number;
  creadoEn: string;
  /** paquetes del corte */
  total: number;
  preparados: number;
  faltantes: PaqueteFaltante[];
  /** pares que se quedaron sin salir, sumados por SKU */
  pares: { sku: string; pares: number }[];
  /** los pedidos que TikTok no aceptó al hacer el corte: nunca entraron */
  rechazados: { orderId: string; error: string }[];
}

/**
 * Lo que falta por despachar de un corte: el pedido, sus productos y el
 * número con el que salió en la hoja. Un corte que se quedó a medias no
 * dice por sí solo QUÉ se quedó; esto lo dice, para buscarlo en la mesa o
 * volverlo a jalar de bodega.
 *
 * Aparte van los pedidos que TikTok RECHAZÓ al hacer el corte: esos nunca
 * llegaron a tener etiqueta, así que también faltan, pero por otro motivo.
 */
export async function faltantesDelCorte(
  admin: any,
  accountId: string,
  corteId: number,
): Promise<FaltantesCorte> {
  const [corte, hechos, fila] = await Promise.all([
    cargarCorte(admin, accountId, corteId),
    preparadosDelCorte(admin, accountId, corteId),
    admin
      .from("tiktok_cortes")
      .select("errores")
      .eq("account_id", accountId)
      .eq("id", corteId)
      .maybeSingle(),
  ]);

  const yaNumerados = new Set(numerosPreparados(corte.paquetes, hechos));
  const faltantes: PaqueteFaltante[] = corte.paquetes
    .filter((p) => !yaNumerados.has(p.numero))
    .map((p) => ({
      numero: p.numero,
      orderId: p.orderId,
      packageId: p.packageId,
      destinatario: p.destinatario,
      revuelto: p.revuelto,
      pares: p.pares.map((x) => ({ sku: x.sku, pares: x.pares, fnsku: x.fnsku ?? null })),
    }));

  const porSku = new Map<string, number>();
  for (const f of faltantes) {
    for (const x of f.pares) porSku.set(x.sku, (porSku.get(x.sku) ?? 0) + x.pares);
  }

  const errores = (fila?.data?.errores ?? []) as { orderId: string; error: string }[];

  return {
    id: corte.id,
    numero: corte.numero,
    creadoEn: corte.creadoEn,
    total: corte.paquetes.length,
    preparados: yaNumerados.size,
    faltantes,
    pares: [...porSku]
      .map(([sku, pares]) => ({ sku, pares }))
      .sort((a, b) => a.sku.localeCompare(b.sku, "es", { numeric: true })),
    rechazados: Array.isArray(errores) ? errores : [],
  };
}

/**
 * La hoja de faltantes: los pedidos del corte que no se prepararon, con el
 * mismo número que traen en la lista de empaque, el pedido en barras (se
 * escanea igual en la estación) y sus productos.
 */
export async function pdfFaltantesDelCorte(admin: any, accountId: string, corteId: number): Promise<Uint8Array> {
  const datos = await faltantesDelCorte(admin, accountId, corteId);

  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Corte ${datos.numero} · faltantes`);

  const CARTA: [number, number] = [612, 792];
  const M = 36;
  const ANCHO = CARTA[0] - 2 * M;
  const FILA = 30;
  const gris = rgb(0.45, 0.45, 0.45);
  const linea = rgb(0.75, 0.75, 0.75);
  // Columnas: # | pedido (barras) | SKU × cant. | destinatario | ☐
  const COL = [26, 140, 190, ANCHO - 26 - 140 - 190 - 18, 18];
  const xs = COL.reduce<number[]>((acc, w, i) => [...acc, (acc[i - 1] ?? M) + (i ? COL[i - 1] : 0)], []);

  let pagina = doc.addPage(CARTA);
  let y = CARTA[1] - M;

  const recorta = (t: string, ancho: number, size: number, f = normal) => {
    let x = t;
    while (x.length > 1 && f.widthOfTextAtSize(x, size) > ancho - 4) x = x.slice(0, -1);
    return x === t ? t : x.slice(0, -1) + "…";
  };
  const encabezado = () => {
    ["#", "Pedido (escanear)", "SKU × cant.", "Destinatario", ""].forEach((t, i) =>
      pagina.drawText(t, { x: xs[i] + 2, y, size: 8, font: negrita, color: gris }),
    );
    y -= 4;
    pagina.drawLine({ start: { x: M, y }, end: { x: M + ANCHO, y }, thickness: 0.8, color: linea });
    y -= FILA;
  };
  const nuevaPagina = () => {
    pagina = doc.addPage(CARTA);
    y = CARTA[1] - M;
    encabezado();
  };

  const fecha = new Date(datos.creadoEn).toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City",
  });
  const totalPares = datos.pares.reduce((a, x) => a + x.pares, 0);
  pagina.drawText(`Corte #${datos.numero} · TikTok Shop · faltantes`, { x: M, y, size: 15, font: negrita });
  y -= 16;
  pagina.drawText(
    `${fecha}   ·   ${datos.faltantes.length} de ${datos.total} paquetes sin preparar   ·   ${totalPares} pares`,
    { x: M, y, size: 9, font: normal, color: gris },
  );
  y -= 14;
  if (datos.pares.length) {
    pagina.drawText(
      recorta("Faltan: " + datos.pares.map((x) => `${x.sku} ×${x.pares}`).join("   ·   "), ANCHO, 9),
      { x: M, y, size: 9, font: normal },
    );
    y -= 14;
  }
  y -= 8;
  encabezado();

  for (const f of datos.faltantes) {
    const alto = FILA * Math.max(1, f.pares.length);
    if (y - alto < M) nuevaPagina();
    const arriba = y + FILA - 12;
    pagina.drawText(`#${f.numero}`, { x: xs[0] + 2, y: arriba, size: 10, font: negrita });
    const codigoOrden = codigoDeOrden(f.orderId);
    if (codigoOrden) {
      dibujarBarras(pagina, codigoOrden, xs[1] + 2, y + 9, anchoBarras(codigoOrden, COL[1] - 6), 18);
      pagina.drawText(f.orderId, { x: xs[1] + 2, y: y + 1, size: 6, font: normal, color: gris });
    } else {
      pagina.drawText(f.orderId, { x: xs[1] + 2, y: arriba, size: 8, font: normal });
    }
    pagina.drawText(recorta(f.destinatario ?? "", COL[3], 7.5), { x: xs[3] + 2, y: arriba, size: 7.5, font: normal, color: gris });
    pagina.drawRectangle({ x: xs[4] + 3, y: y + 10, width: 11, height: 11, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
    f.pares.forEach((x, i) => {
      const yy = arriba - i * FILA;
      const etiqueta = x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku;
      pagina.drawText(recorta(etiqueta, COL[2], 9.5, negrita), { x: xs[2] + 2, y: yy, size: 9.5, font: negrita });
      if (x.fnsku) {
        pagina.drawText(x.fnsku, { x: xs[2] + 2, y: yy - 9, size: 6.5, font: normal, color: gris });
      }
    });
    y -= alto;
    pagina.drawLine({ start: { x: M, y: y + FILA - 6 }, end: { x: M + ANCHO, y: y + FILA - 6 }, thickness: 0.4, color: linea });
  }

  if (!datos.faltantes.length) {
    pagina.drawText("Nada pendiente: el corte se preparó completo.", { x: M, y, size: 11, font: negrita });
    y -= FILA;
  }

  if (datos.rechazados.length) {
    if (y < M + FILA * 3) nuevaPagina();
    y -= 10;
    pagina.drawText("Pedidos que TikTok no aceptó en el corte (nunca tuvieron guía)", { x: M, y, size: 11, font: negrita });
    y -= 16;
    for (const r of datos.rechazados) {
      if (y < M) nuevaPagina();
      pagina.drawText(recorta(`${r.orderId} — ${r.error}`, ANCHO, 8.5), { x: M, y, size: 8.5, font: normal, color: gris });
      y -= 14;
    }
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// Preparar: la constancia de los tres escaneos
// ---------------------------------------------------------------------------

/**
 * Los paquetes que ya se prepararon en un corte, por su IDENTIDAD (pedido +
 * paquete), no por el "#n": el número es el lugar en la hoja de hoy y
 * cambia si cambia el orden del corte. `numerosPreparados` los traduce a
 * los números de la hoja que se está enseñando.
 */
export async function preparadosDelCorte(db: DB, accountId: string, corteId: number): Promise<Set<string>> {
  const filas = await traerTodo<any>(db, "tiktok_preparaciones", "order_id, package_id, id", (q) =>
    q.eq("account_id", accountId).eq("corte_id", corteId),
  );
  return new Set(
    (filas ?? []).map((f: any) => clavePaquete({ orderId: String(f.order_id), packageId: f.package_id ?? "" })),
  );
}

export async function marcarPreparado(
  db: DB,
  accountId: string,
  corteId: number,
  datos: { numero: number; orderId: string; packageId: string; escaneos: string[]; usuario?: string | null },
): Promise<void> {
  const { error } = await db.from("tiktok_preparaciones").upsert(
    {
      account_id: accountId,
      corte_id: corteId,
      order_id: datos.orderId,
      package_id: datos.packageId ?? "",
      numero: datos.numero,
      escaneos: datos.escaneos,
      preparado_en: new Date().toISOString(),
      preparado_por: datos.usuario ?? null,
    },
    { onConflict: "account_id,order_id,package_id" },
  );
  if (error) throw new Error(`No se pudo guardar la preparación: ${error.message}`);
}


/**
 * Da por preparados TODOS los paquetes pendientes de un corte, sin escanear.
 * Solo con la clave de supervisor (la valida la ruta): para cuando ya se
 * verificó de otra forma o el escáner no está. Cada paquete queda con
 * constancia SUPERVISOR, igual que el "sin escanear" individual.
 */
export async function prepararCorteCompleto(
  admin: any,
  accountId: string,
  corteId: number,
  usuario?: string | null,
): Promise<{ preparados: number; yaEstaban: number }> {
  const corte = await cargarCorte(admin, accountId, corteId);
  const hechos = await preparadosDelCorte(admin, accountId, corteId);
  const yaNumerados = new Set(numerosPreparados(corte.paquetes, hechos));
  const pendientes = corte.paquetes.filter((p) => !yaNumerados.has(p.numero));
  const ahora = new Date().toISOString();
  if (pendientes.length) {
    const { error } = await admin.from("tiktok_preparaciones").upsert(
      pendientes.map((p) => ({
        account_id: accountId,
        corte_id: corteId,
        order_id: p.orderId,
        package_id: p.packageId ?? "",
        numero: p.numero,
        escaneos: ["SUPERVISOR:corte completo sin escanear"],
        preparado_en: ahora,
        preparado_por: usuario ?? null,
      })),
      { onConflict: "account_id,order_id,package_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(`No se pudo preparar el corte: ${error.message}`);
  }
  return { preparados: pendientes.length, yaEstaban: hechos.size };
}

// ---------------------------------------------------------------------------
// Simular el corte: qué pasaría, sin tocar nada
// ---------------------------------------------------------------------------

export interface SimulacionCorte {
  pedidos: {
    orderId: string;
    estado: string;
    paquetes: number;
    /** true = TikTok ofrece recolección con horario; false = solo drop-off; null = no se pudo saber */
    recoleccion: boolean | null;
    pares: { sku: string; pares: number }[];
    aviso: string | null;
  }[];
  totalPares: number;
  /** cómo quedaría el corte del lunes: lo atrasado primero, lo de ayer y hoy después */
  tandas: { urgentes: number; resto: number; corte: string };
  /** lo que se le mandaría al 3PL */
  salidasAl3pl: { sku: string; pares: number }[];
  endpoint3pl: string | null;
}

export async function simularCorte(admin: any, accountId: string): Promise<SimulacionCorte> {
  const cliente = await clienteDeCuenta(admin, accountId, 120_000);
  if (!cliente || !cliente.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");

  const pendientes = await pendientesDeCorte(admin, accountId);
  const ids = pendientes.map((p) => p.orderId);
  const items = ids.length
    ? await traerTodo<any>(admin, "tiktok_orden_items", "order_id, sku_interno, seller_sku, cantidad, estado", (q) =>
        q.eq("account_id", accountId).in("order_id", ids),
      )
    : [];

  const porOrden = new Map<string, Map<string, number>>();
  for (const i of items ?? []) {
    if (efectoDeEstado(i.estado) === "reversa") continue;
    const m = porOrden.get(i.order_id) ?? new Map<string, number>();
    const sku = i.sku_interno ?? i.seller_sku ?? "(sin SKU)";
    m.set(sku, (m.get(sku) ?? 0) + (i.cantidad ?? 0));
    porOrden.set(i.order_id, m);
  }

  const salida: SimulacionCorte["pedidos"] = [];
  const al3pl = new Map<string, number>();

  for (const p of pendientes) {
    let paquetes = 0;
    let recoleccion: boolean | null = null;
    let aviso: string | null = null;
    if (cliente.msRestantes() > 15_000) {
      try {
        const pks = await paquetesDePedido(cliente, p.orderId);
        paquetes = pks.length;
        if (pks[0] && efectoDeEstado(p.estado) !== "salida") {
          const e = await opcionesDeEntrega(cliente, pks[0].id);
          recoleccion = e.puedeRecoleccion === true || e.horarios.length > 0 ? true : e.puedeRecoleccion === false ? false : null;
          if (recoleccion === false) aviso = "TikTok solo ofrece drop-off para este paquete";
        } else if (efectoDeEstado(p.estado) === "salida") {
          aviso = "Ya está confirmado en TikTok; solo entra al corte para etiqueta y lista";
        }
      } catch (err) {
        aviso = (err as Error).message;
      }
    }
    const pares = [...(porOrden.get(p.orderId) ?? new Map())].map(([sku, n]) => ({ sku, pares: n }));
    for (const x of pares) if (!x.sku.startsWith("(")) al3pl.set(x.sku, (al3pl.get(x.sku) ?? 0) + x.pares);
    salida.push({ orderId: p.orderId, estado: p.estado, paquetes, recoleccion, pares, aviso });
  }

  const tandas = partirEnTandas(pendientes);

  return {
    pedidos: salida,
    totalPares: salida.reduce((a, p) => a + p.pares.reduce((b, x) => b + x.pares, 0), 0),
    tandas: { urgentes: tandas.urgentes.length, resto: tandas.resto.length, corte: tandas.corte },
    salidasAl3pl: [...al3pl].map(([sku, pares]) => ({ sku, pares })).sort((a, b) => a.sku.localeCompare(b.sku, "es")),
    endpoint3pl: urlSalidasIndusther(),
  };
}
