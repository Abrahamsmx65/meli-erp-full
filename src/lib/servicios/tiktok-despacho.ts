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
import { contarSinTiempo, corteQueContinua, ERROR_SIN_TIEMPO, erroresAlUnir, ordenarPorAntiguedad, partirEnTandas, type PendienteConFecha } from "../tiktok/lunes";
import { diaMx } from "../tiktok/ventas";
import { anotarExito, anotarFallo, anotarSalto, avisoDeGuardia, crearGuardia, debePreguntar } from "../tiktok/recoleccion";
import {
  cancelarRenglones,
  MOTIVOS_SIN_STOCK,
  motivosDeCancelacion,
  motivosDeVendedor,
  motivosUsadosEnCancelaciones,
  motivoSinStock,
  esErrorDeParcial,
  enviarPaquete,
  etiquetaDePaquete,
  opcionesDeEntrega,
  paquetesDePedido,
  renglonesDelPaquete,
  type HorarioRecoleccion,
  type OpcionesEnvio,
} from "../tiktok/api";
import { autoBloqueos, decidirPedido, esBloqueoAutomatico, type RenglonBloqueable, type RenglonConPedido, type StockFisico } from "../tiktok/bloqueos";
import type { Cancelacion } from "../tiktok/api";
import { avisarParcialesSinCancelar, destinatarioFaltantes, type PedidoParcialSinCancelar } from "./tiktok-faltantes-correo";
import { estadoSalidas3pl } from "./tiktok-3pl";
import { leerEstanteTikTok } from "./tiktok-bodega";
import {
  agruparPorModelo,
  clavePaquete,
  faltantesDePaquetes,
  yaSeEnvio,
  cambiosDeRelectura,
  codigoDeHoja,
  codigoDeOrden,
  necesitaFranja,
  numerosPreparados,
  renglonesDeEtiqueta,
  numerarPaquetes,
  ORDEN_ACTUAL,
  type OrdenPaquetes,
  type PaqueteDespacho,
  type PaqueteNumerado,
} from "../tiktok/despacho";
import { efectoDeEstado } from "../tiktok/kardex";
import { clienteDeCuenta, sincronizarPedidosPorId } from "./tiktok";
import { urlSalidasIndusther } from "./tiktok-3pl";
import { empujarSalidasAl3pl, registrarSalidasDeCorte } from "./tiktok-3pl";

/**
 * El stock FÍSICO por SKU para la defensa automática del corte: el kardex
 * (saldo, con lo apartado adentro), el estante del 3PL y las salidas que
 * el 3PL aún no descuenta. `paresFisicos` en `tiktok/bloqueos.ts` los
 * junta con la misma regla con la que se publica: gana el menor.
 */
async function stockFisicoDeCuenta(admin: any, accountId: string): Promise<Map<string, StockFisico>> {
  const [inv, estante, salidas] = await Promise.all([
    traerTodo<any>(admin, "tiktok_inventario", "sku, saldo", (q) => q.eq("account_id", accountId)),
    leerEstanteTikTok(admin, accountId).catch(() => ({ pares: null, contadosDespues: new Set<string>() })),
    estadoSalidas3pl(admin, accountId).catch(() => ({ pendientes: new Map<string, number>(), confirmadas: new Map<string, number>() })),
  ]);
  const stock = new Map<string, StockFisico>();
  for (const r of inv ?? []) {
    const sku = String(r.sku);
    stock.set(sku, {
      sku,
      saldo: Number(r.saldo ?? 0),
      estante: estante.pares ? (estante.pares.get(sku) ?? 0) : null,
      salidasPendientes: salidas.pendientes.get(sku) ?? 0,
      contadoDespues: estante.contadosDespues.has(sku),
    });
  }
  return stock;
}

/**
 * Los renglones de los pedidos con su fecha de venta, y los bloqueos que
 * la defensa automática decide sobre ellos. Devuelve los renglones YA con
 * `bloqueado` puesto (lo de a mano y lo automático) y la lista de lo
 * automático, para dejarle constancia en la base.
 */
async function renglonesConDefensa(
  admin: any,
  accountId: string,
  pendientes: PendienteConFecha[],
  /** true = corte SIN defensa: no se bloquea nada por stock y lo bloqueado solo se libera (decisión del dueño por corte) */
  sinDefensa = false,
): Promise<{
  porPedido: Map<string, RenglonConPedido[]>;
  automaticos: ReturnType<typeof autoBloqueos>;
  /** renglones con stock EN DUDA (la bodega dejó de reportar el SKU y el kardex aún tiene pares): el pedido se queda fuera, sin cancelar */
  enDuda: ReturnType<typeof autoBloqueos>;
  /** renglones que estaban bloqueados solos y ya no hace falta: llegó stock */
  liberados: string[];
}> {
  const ids = pendientes.map((p) => p.orderId);
  const porPedido = new Map<string, RenglonConPedido[]>();
  if (!ids.length) return { porPedido, automaticos: [], enDuda: [], liberados: [] };
  const fechaDe = new Map(pendientes.map((p) => [p.orderId, p.creadoEn]));
  const [filas, stock] = await Promise.all([
    traerTodo<any>(
      admin,
      "tiktok_orden_items",
      "order_id, line_item_id, sku_id, sku_interno, seller_sku, cantidad, estado, bloqueado_en, bloqueo_motivo, bloqueo_resuelto_en",
      (q) => q.eq("account_id", accountId).in("order_id", ids),
    ),
    stockFisicoDeCuenta(admin, accountId),
  ]);
  // Un bloqueo AUTOMÁTICO vigente no se hereda: se vuelve a decidir con el
  // stock de hoy (si llegó mercancía, el pedido sale). Uno a mano sí se queda.
  const autoPrevio = new Set<string>(
    (filas ?? [])
      .filter((i: any) => i.bloqueado_en && !i.bloqueo_resuelto_en && esBloqueoAutomatico(i.bloqueo_motivo))
      .map((i: any) => String(i.line_item_id)),
  );
  const todos: RenglonConPedido[] = (filas ?? []).map((i: any) => ({
    orderId: String(i.order_id),
    creadoEn: fechaDe.get(String(i.order_id)) ?? null,
    lineItemId: String(i.line_item_id),
    skuId: i.sku_id ? String(i.sku_id) : null,
    sku: String(i.sku_interno ?? i.seller_sku ?? "(sin SKU)"),
    cantidad: Number(i.cantidad ?? 1),
    estado: i.estado ?? null,
    bloqueado: Boolean(i.bloqueado_en) && !i.bloqueo_resuelto_en && !esBloqueoAutomatico(i.bloqueo_motivo),
  }));
  // Sin defensa, el dueño decidió confirmar aunque el stock diga cero (los
  // pares suelen estar: un estante que Industher dejó de reportar, una
  // caja que ya llegó): ningún bloqueo automático nuevo y los vigentes se
  // liberan. Los bloqueos a mano se respetan igual.
  const decididos = sinDefensa ? [] : autoBloqueos(todos, stock);
  // Lo EN DUDA no se bloquea (bloquear = cancelar en TikTok): el pedido
  // entero se queda fuera del corte y se declara. Ver `stockEnDuda`.
  const enDuda = decididos.filter((a) => a.enDuda);
  const automaticos = decididos.filter((a) => !a.enDuda);
  const auto = new Set(automaticos.map((a) => a.lineItemId));
  for (const r of todos) {
    if (auto.has(r.lineItemId)) r.bloqueado = true;
    const l = porPedido.get(r.orderId) ?? [];
    l.push(r);
    porPedido.set(r.orderId, l);
  }
  const liberados = [...autoPrevio].filter((id) => !auto.has(id));
  return { porPedido, automaticos, enDuda, liberados };
}

/** Lo que entra en un corte: pagado sin salir, o ya salido pero sin corte. */
const ESTADOS_DESPACHABLES = new Set(["AWAITING_SHIPMENT", "PARTIALLY_SHIPPING", "AWAITING_COLLECTION"]);

export interface ResultadoCorte {
  /** null cuando NINGÚN pedido entró: no se guarda un corte vacío */
  corteId: number | null;
  numero: number | null;
  pedidos: number;
  pares: number;
  /** pedidos que NO entraron al corte, con el motivo; un `orderId` vacío es un aviso del corte entero */
  errores: { orderId: string; error: string }[];
  publicados: number;
  /** paquetes que salieron como entrega en paquetería aunque se pidió recolección */
  dropOff: number;
  /** renglones bloqueados que TikTok canceló (defensa): pedido, SKU y pares; `completo` si se canceló todo el pedido */
  cancelados: { orderId: string; sku: string; pares: number; completo: boolean }[];
  /** cómo le fue a la salida hacia el 3PL */
  al3pl: { mandadas: number; confirmadas: number; error: string | null; sinEndpoint: boolean };
  /** true si este corte se UNIÓ a uno de hoy que había dejado pedidos por tiempo (no se abrió otro) */
  unido?: boolean;
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
  // Lo más viejo primero: si el corte se queda sin tiempo, lo que sobra es
  // lo más reciente, nunca lo que ya casi cumple las 48 horas.
  return ordenarPorAntiguedad(
    (filas ?? [])
      .filter((o: any) => ESTADOS_DESPACHABLES.has(String(o.estado).toUpperCase()))
      .map((o: any) => ({ orderId: o.order_id, estado: o.estado, creadoEn: o.fecha_creacion ?? null })),
  );
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
    /** confirmar TODO aunque no haya stock físico: sin bloqueos automáticos (decisión del dueño, 21-sep-2026) */
    sinDefensa?: boolean;
  },
): Promise<ResultadoCorte> {
  const cliente = await clienteDeCuenta(admin, accountId, opciones.msDisponibles ?? 240_000);
  if (!cliente || !cliente.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");

  const todos = await pendientesDeCorte(admin, accountId);
  const filtro = opciones.soloPedidos ? new Set(opciones.soloPedidos) : null;
  const pendientes = filtro ? todos.filter((p) => filtro.has(p.orderId)) : todos;
  if (!pendientes.length) throw new Error("No hay pedidos por despachar.");

  const errores: { orderId: string; error: string }[] = [];

  // Los renglones de cada pedido ANTES de confirmar, ya con la DEFENSA
  // AUTOMÁTICA aplicada: un SKU sin stock físico para todos los pedidos
  // que lo piden se bloquea solo (los más nuevos primero), se cancela en
  // TikTok y se confirma lo demás. De aquí salen también los pares del
  // corte y las salidas al 3PL, ya sin lo cancelado.
  const { porPedido: renglonesPorPedido, automaticos, enDuda, liberados } = await renglonesConDefensa(
    admin,
    accountId,
    pendientes,
    Boolean(opciones.sinDefensa),
  );
  if (opciones.sinDefensa) {
    // Constancia en el corte: se confirmó sin mirar el stock.
    errores.push({
      orderId: "",
      error: liberados.length
        ? `Corte SIN defensa: se confirmó todo aunque no hubiera stock físico; ${liberados.length} ${liberados.length === 1 ? "renglón bloqueado se liberó" : "renglones bloqueados se liberaron"}.`
        : "Corte SIN defensa: se confirmó todo sin mirar el stock físico.",
    });
  }
  if (automaticos.length) {
    // Constancia del bloqueo automático, con su motivo, antes de tocar TikTok.
    for (const a of automaticos) {
      await admin
        .from("tiktok_orden_items")
        .update({ bloqueado_en: new Date().toISOString(), bloqueo_motivo: a.motivo, bloqueo_resultado: null, bloqueo_resuelto_en: null })
        .eq("account_id", accountId)
        .eq("line_item_id", a.lineItemId);
    }
  }
  if (liberados.length) {
    // Llegó stock: el bloqueo de la vez pasada ya no aplica y el pedido entra.
    await admin
      .from("tiktok_orden_items")
      .update({
        bloqueo_resultado: opciones.sinDefensa ? "liberado: corte sin defensa (decisión del dueño)" : "liberado: ya hay stock",
        bloqueo_resuelto_en: new Date().toISOString(),
      })
      .eq("account_id", accountId)
      .in("line_item_id", liberados);
  }
  const filasRenglones = [...renglonesPorPedido.values()].flat();
  /** lo que queda vivo de cada pedido confirmado (sin lo cancelado) */
  const vivosPorPedido = new Map<string, RenglonBloqueable[]>();
  const cancelados: ResultadoCorte["cancelados"] = [];
  /** pedidos cancelados completos: se releen para que el kardex los revierta */
  const canceladosCompletos: string[] = [];
  // El motivo de cancelación se le pregunta a TikTok POR PEDIDO (aftersale
  // eligibility); las claves fijas de su documentación quedan de respaldo
  // por si no contesta nada. La primera respuesta cruda se guarda en la
  // bitácora: su forma exacta no está documentada en ningún SDK público.
  // Los motivos que TikTok ya aceptó en esta tienda van PRIMERO: son la
  // única lista fiable para el mercado (ver `motivosUsadosEnCancelaciones`).
  // Las claves fijas de la documentación quedan al final, de respaldo.
  let aprendidos: string[] = [];
  if (automaticos.length || filasRenglones.some((r) => r.bloqueado)) {
    try {
      aprendidos = motivosDeVendedor(await motivosUsadosEnCancelaciones(cliente));
    } catch {
      aprendidos = [];
    }
  }
  const motivos = [...new Set([...aprendidos, ...MOTIVOS_SIN_STOCK])];
  let elegibilidadCruda: { orderId: string; crudo: unknown } | null = null;
  /** pedidos grandes que TikTok no dejó cancelar parcial: se avisan por correo a quien despacha */
  const parciales: PedidoParcialSinCancelar[] = [];
  const constancia = async (lineItemIds: string[], resultado: string) => {
    if (!lineItemIds.length) return;
    await admin
      .from("tiktok_orden_items")
      .update({ bloqueo_resultado: resultado.slice(0, 300), bloqueo_resuelto_en: resultado === "cancelado" ? new Date().toISOString() : null })
      .eq("account_id", accountId)
      .in("line_item_id", lineItemIds);
  };

  let dropOff = 0;
  const confirmados: string[] = [];
  // Si TikTok no da horarios, se rinde a tiempo y confirma sin él (ver
  // `tiktok/recoleccion.ts`): el 15-sep-2026 preguntar 52 veces en vano dejó
  // 203 pedidos sin confirmar.
  const guardia = crearGuardia();

  // Con 200 pedidos, uno por uno no cabe en el tiempo de Vercel: se
  // confirman VARIOS a la vez (cada pedido son 2 o 3 llamadas a TikTok).
  // El orden de `confirmados` no importa: el corte se numera después.
  // Stock EN DUDA por pedido: la bodega dejó de reportar el SKU y el kardex
  // aún tiene pares. Ni se confirma ni se cancela: fuera del corte,
  // declarado, hasta un conteo o que Industher lo regrese.
  const dudaPorPedido = new Map<string, Set<string>>();
  for (const d of enDuda) {
    const l = dudaPorPedido.get(d.orderId) ?? new Set<string>();
    l.add(d.sku);
    dudaPorPedido.set(d.orderId, l);
  }

  await enParalelo(pendientes, 4, async (p) => {
    if (cliente.msRestantes() < 30_000) {
      errores.push({ orderId: p.orderId, error: ERROR_SIN_TIEMPO });
      return;
    }
    const renglones = renglonesPorPedido.get(p.orderId) ?? [];
    const duda = dudaPorPedido.get(p.orderId);
    if (duda?.size && efectoDeEstado(p.estado) !== "salida") {
      errores.push({
        orderId: p.orderId,
        error:
          `Stock en duda de ${[...duda].join(", ")}: la bodega dejó de reportarlo y el kardex aún tiene pares. ` +
          `Se queda fuera (ni se confirma ni se cancela) hasta un conteo o que Industher lo regrese; o corte sin defensa.`,
      });
      return;
    }
    // Lo que ya salió (sin corte) no se vuelve a confirmar: solo se agrupa.
    if (efectoDeEstado(p.estado) === "salida") {
      confirmados.push(p.orderId);
      vivosPorPedido.set(p.orderId, renglones.filter((r) => efectoDeEstado(r.estado) !== "reversa"));
      return;
    }
    try {
      // DEFENSA: lo bloqueado se cancela en TikTok ANTES de confirmar. Si
      // TikTok no acepta la cancelación, el pedido entero se queda fuera
      // del corte: confirmar un par que no existe es el error caro.
      const decision = decidirPedido(renglones);
      if (decision.sinSkuId.length) {
        throw new Error(
          `Bloqueado sin sku_id de TikTok (${decision.sinSkuId.map((r) => r.sku).join(", ")}): cancélalo en el Seller Center; el pedido se queda fuera.`,
        );
      }
      if (decision.cancelar.length) {
        const ids = decision.cancelar.flatMap((c) => c.lineItemIds);
        let r: Cancelacion;
        try {
          let motivosPedido = motivos;
          try {
            const e = await motivosDeCancelacion(cliente, p.orderId);
            if (!elegibilidadCruda) elegibilidadCruda = { orderId: p.orderId, crudo: e.crudo };
            const preferido = motivoSinStock(e.motivos);
            if (preferido) motivosPedido = [preferido, ...motivos.filter((m) => m !== preferido)];
          } catch (err) {
            if (!elegibilidadCruda) elegibilidadCruda = { orderId: p.orderId, crudo: { error: (err as Error).message } };
          }
          r = await cancelarRenglones(
            cliente,
            p.orderId,
            motivosPedido,
            decision.todoBloqueado ? undefined : decision.cancelar.map((c) => ({ skuId: c.skuId, cantidad: c.cantidad })),
          );
        } catch (err) {
          // Con el mensaje REAL de TikTok: un error tragado dejó cuatro
          // cortes diciendo «no dio motivo» sin que nadie supiera por qué.
          const m = (err as Error).message;
          await constancia(ids, m);
          if (!decision.todoBloqueado && esErrorDeParcial(err)) {
            // TikTok MX no cancela parcial por API: esto lo arregla una
            // persona en el Seller Center, y hay que decírselo.
            parciales.push({
              orderId: p.orderId,
              sinStock: decision.cancelar.map((c) => ({ sku: c.sku, pares: c.cantidad })),
              vivos: decision.quedan.map((q) => ({ sku: q.sku, pares: q.cantidad })),
              error: m,
            });
            throw new Error(`Pedido grande con un renglón sin stock: TikTok no deja cancelar parcial por API; se avisó por correo para cancelarlo a mano en el Seller Center (${m}).`);
          }
          throw new Error(`Bloqueado y TikTok no aceptó cancelarlo (${m}); el pedido se queda fuera del corte.`);
        }
        if (!r.aceptada) {
          // TikTok la dejó pendiente (del comprador): el par sigue vendido y
          // confirmarlo sería mandar lo que no hay.
          const m = `TikTok dejó la cancelación pendiente (${r.estado}); el pedido se queda fuera hasta que se resuelva.`;
          await constancia(ids, m);
          throw new Error(`Bloqueado y ${m}`);
        }
        await constancia(ids, "cancelado");
        for (const c of decision.cancelar) cancelados.push({ orderId: p.orderId, sku: c.sku, pares: c.cantidad, completo: decision.todoBloqueado });
        if (decision.todoBloqueado) {
          canceladosCompletos.push(p.orderId);
          return;
        }
      }
      vivosPorPedido.set(p.orderId, decision.quedan);

      const paquetes = await paquetesDePedido(cliente, p.orderId);
      if (!paquetes.length) throw new Error("TikTok no tiene paquete para este pedido.");
      for (const pk of paquetes) {
        // Recolección: hay que decirle a TikTok CUÁNDO. Sin horario acepta
        // la petición pero la vuelve drop-off, que es justo lo que pasó en
        // el primer corte. Se toma el primer horario que ofrezca.
        let horario: HorarioRecoleccion | null = null;
        let handover = opciones.handover;
        if (opciones.handover === "PICKUP") {
          if (!debePreguntar(guardia)) {
            // TikTok lleva varios paquetes seguidos sin contestar el
            // horario: ya no se le pregunta en este corte. Sale como
            // recolección sin hora fija (así está la tienda) y se declara
            // UNA vez al final.
            anotarSalto(guardia);
          } else {
            try {
              const e = await opcionesDeEntrega(cliente, pk.id);
              anotarExito(guardia);
              horario = primerHorario(e.horarios);
              if (!horario && e.puedeRecoleccion === false) {
                // TikTok dice que en este paquete NO hay recolección. Se
                // manda como drop-off A PROPÓSITO y se cuenta, en vez de
                // mandar PICKUP a ciegas y que TikTok lo convierta en silencio.
                handover = "DROP_OFF";
                dropOff++;
              }
              // Sin horario pero con recolección posible: la tienda tiene
              // recolección sin hora fija; se manda PICKUP sin horario.
            } catch (err) {
              // TikTok no contestó el horario (su error, no del pedido). El
              // paquete sale como lo pidió el dueño —recolección sin hora
              // fija— y el motivo se declara una sola vez para todo el corte.
              anotarFallo(guardia, (err as Error).message);
            }
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

  // Un solo aviso por lo de los horarios, no uno por paquete: los pedidos
  // SÍ entraron al corte; lo que falló fue TikTok con su horario.
  const avisoHorarios = avisoDeGuardia(guardia);
  if (avisoHorarios) errores.push({ orderId: "", error: avisoHorarios });

  if (parciales.length) {
    const aviso = await avisarParcialesSinCancelar(admin, accountId, parciales);
    if (aviso.correo && !aviso.correo.enviado) {
      errores.push({ orderId: "", error: `No se pudo mandar el correo de los pedidos grandes a ${destinatarioFaltantes()}: ${aviso.correo.motivo ?? "sin detalle"}.` });
    } else if (aviso.avisados) {
      errores.push({ orderId: "", error: `Se avisó por correo a ${destinatarioFaltantes()} de ${aviso.avisados} ${aviso.avisados === 1 ? "pedido grande" : "pedidos grandes"} que hay que cancelar a mano en el Seller Center.` });
    }
  }

  if (elegibilidadCruda) {
    await admin
      .from("tiktok_sync_log")
      .insert({
        account_id: accountId,
        tarea: "diagnostico-cancelacion",
        inicio: new Date().toISOString(),
        fin: new Date().toISOString(),
        estado: "ok",
        detalle: elegibilidadCruda,
      })
      .then(() => undefined, () => undefined);
  }

  // Sin un solo pedido confirmado NO se guarda un corte: uno vacío solo
  // estorba en la lista (el 18-sep-2026 se guardaron dos seguidos con 0
  // pedidos porque los 16 pendientes estaban bloqueados y la cancelación
  // fallaba). Lo cancelado sí se relee para que el kardex libere lo
  // apartado, y el resultado dice con nombre por qué nadie entró.
  if (!confirmados.length) {
    const releerSinCorte = [...new Set([...canceladosCompletos, ...cancelados.map((c) => c.orderId)])];
    let publicadosSinCorte = 0;
    if (releerSinCorte.length) publicadosSinCorte = (await sincronizarPedidosPorId(admin, accountId, releerSinCorte)).publicados;
    return {
      corteId: null,
      numero: null,
      pedidos: 0,
      pares: 0,
      errores,
      publicados: publicadosSinCorte,
      dropOff,
      cancelados,
      al3pl: { mandadas: 0, confirmadas: 0, error: null, sinEndpoint: false },
    };
  }

  // Pares del corte: lo VIVO de cada pedido confirmado (sin lo cancelado
  // ni lo que ya venía revertido).
  const pares = confirmados.reduce(
    (a, id) => a + (vivosPorPedido.get(id) ?? []).reduce((b, r) => b + r.cantidad, 0),
    0,
  );

  // ¿Este corte CONTINÚA uno de hoy que se quedó sin tiempo? Entonces se le
  // une en vez de abrir otro (ver `corteQueContinua`).
  const unirA = await corteDeHoyQueContinua(admin, accountId, pendientes.map((p) => p.orderId));
  let corte: { id: number };
  let numero: number;
  let unido = false;
  if (unirA) {
    unido = true;
    numero = unirA.numero;
    corte = { id: unirA.id };
    const { error } = await admin
      .from("tiktok_cortes")
      .update({
        pedidos: (unirA.pedidos ?? 0) + confirmados.length,
        pares: (unirA.pares ?? 0) + pares,
        errores: erroresAlUnir(unirA.errores ?? [], errores, pendientes.map((p) => p.orderId)),
      })
      .eq("id", unirA.id);
    if (error) throw new Error(`No se pudo unir al corte #${numero}: ${error.message}`);
    // El PDF del corte ya armado quedó viejo: se rearma con los paquetes
    // nuevos (las guías de cada paquete siguen guardadas).
    await admin.storage
      .from(BUCKET_GUIAS)
      .remove([`${accountId}/corte-${unirA.id}-e${VERSION_ESTAMPA}.pdf`])
      .then(() => undefined, () => undefined);
  } else {
    // El número del corte: consecutivo por cuenta.
    const { data: ultimo } = await admin
      .from("tiktok_cortes")
      .select("numero")
      .eq("account_id", accountId)
      .order("numero", { ascending: false })
      .limit(1)
      .maybeSingle();
    numero = (ultimo?.numero ?? 0) + 1;

    const { data: nuevo, error } = await admin
      .from("tiktok_cortes")
      .insert({
        account_id: accountId,
        numero,
        creado_por: opciones.creadoPor ?? null,
        handover: opciones.handover,
        pedidos: confirmados.length,
        pares,
        errores,
        // Con qué orden nació: los cortes de antes se quedan con el suyo y se
        // vuelven a armar igual, porque sus hojas ya están impresas.
        orden_paquetes: ORDEN_ACTUAL,
      })
      .select("id")
      .single();
    if (error || !nuevo) throw new Error(`No se pudo guardar el corte: ${error?.message ?? "sin id"}`);
    corte = nuevo;
  }

  if (confirmados.length) {
    await admin
      .from("tiktok_ordenes")
      .update({ corte_id: corte.id })
      .eq("account_id", accountId)
      .in("order_id", confirmados);
  }

  // Una sola relectura para todos: TikTok ya los tiene en AWAITING_COLLECTION,
  // eso genera las salidas del kardex y republica el disponible. Los
  // cancelados (completos o por renglón) también se releen: su reversa
  // libera el apartado.
  let publicados = 0;
  const releer = [...new Set([...confirmados, ...canceladosCompletos, ...cancelados.map((c) => c.orderId)])];
  if (releer.length) {
    const r = await sincronizarPedidosPorId(admin, accountId, releer);
    publicados = r.publicados;
  }

  // Y las mismas salidas, al 3PL: que Industher también baje su número. Se
  // registran por (pedido, SKU) y se mandan; lo que no confirme se reintenta
  // en el cron. Un renglón sin SKU del ERP no se manda: el 3PL no lo conoce.
  const porPedidoYSku = new Map<string, { orderId: string; sku: string; pares: number }>();
  const conSkuDelErp = new Set(filasRenglones.filter((r) => !r.sku.startsWith("(")).map((r) => r.lineItemId));
  for (const id of confirmados) {
    for (const r of vivosPorPedido.get(id) ?? []) {
      if (!conSkuDelErp.has(r.lineItemId)) continue;
      const k = `${id}|${r.sku}`;
      const prev = porPedidoYSku.get(k) ?? { orderId: id, sku: r.sku, pares: 0 };
      prev.pares += r.cantidad;
      porPedidoYSku.set(k, prev);
    }
  }
  await registrarSalidasDeCorte(admin, accountId, corte.id, [...porPedidoYSku.values()]);
  const al3pl = await empujarSalidasAl3pl(admin, accountId, corte.id);

  return { corteId: corte.id, numero, pedidos: confirmados.length, pares, errores, publicados, dropOff, cancelados, al3pl, unido };
}

/**
 * El corte de HOY (México) al que este corte se une, si alguno de los
 * pedidos que se van a cortar quedó por tiempo en él y nadie le ha
 * preparado nada todavía. Lo demás es `corteQueContinua`.
 */
async function corteDeHoyQueContinua(
  admin: any,
  accountId: string,
  orderIds: string[],
): Promise<{ id: number; numero: number; pedidos: number; pares: number; errores: { orderId: string; error: string }[] } | null> {
  const ahora = new Date();
  // Desde las 00:00 de hoy en México (UTC−6 fijo, como `diaMx`).
  const desde = new Date(`${diaMx(ahora.toISOString())}T06:00:00Z`).toISOString();
  const { data } = await admin
    .from("tiktok_cortes")
    .select("id, numero, creado_en, pedidos, pares, errores")
    .eq("account_id", accountId)
    .gte("creado_en", desde)
    .order("id", { ascending: false })
    .limit(10);
  const cortes = (data ?? []) as any[];
  if (!cortes.length) return null;
  const preparados = new Map<number, number>();
  for (const c of cortes) {
    const { count } = await admin
      .from("tiktok_preparaciones")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("corte_id", c.id);
    preparados.set(c.id, count ?? 0);
  }
  const id = corteQueContinua(
    cortes.map((c) => ({ id: c.id, creadoEn: c.creado_en, errores: c.errores ?? [], preparados: preparados.get(c.id) ?? 0 })),
    orderIds,
    ahora,
  );
  if (id == null) return null;
  const c = cortes.find((x) => x.id === id);
  return c ? { id: c.id, numero: c.numero, pedidos: c.pedidos ?? 0, pares: c.pares ?? 0, errores: c.errores ?? [] } : null;
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
 * El lunes se despacha lo del viernes, sábado y domingo (y lo que venga de
 * más atrás). Regla del dueño (20-sep-2026): PRIMERO un corte completo con
 * TODO lo pendiente hasta el domingo a las 23:59 de México —sale con su
 * etiqueta, su lista y su surtido, y se empaca de una vez— y luego un
 * segundo corte solo con lo del lunes, que todavía tiene tiempo.
 *
 * Si el primero se come el rato disponible, el segundo NO se hace a medias:
 * se dice cuántos pedidos quedaron y el botón normal de "Hacer corte" los
 * toma completos (son, exactamente, los que sobraron).
 */
export async function hacerCorteLunes(
  admin: any,
  accountId: string,
  opciones: { handover: OpcionesEnvio["handover"]; creadoPor?: string | null; sinDefensa?: boolean },
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
        ? "Todo lo pendiente era de antes de hoy: se hizo un solo corte."
        : "No hay pedidos de días anteriores: se hizo un solo corte.",
    };
  }

  // Primero lo atrasado, con TODO el rato si hace falta: lo de días
  // anteriores nunca se queda sin corte por culpa de lo de hoy. El
  // 21-sep-2026 la primera tanda tenía ~800 pedidos, con la mitad del
  // rato solo confirmó 294, y la segunda se llevó los 205 del lunes de
  // todos modos: lo de hoy salió antes que 485 del fin de semana.
  const primero = await hacerCorte(admin, accountId, {
    ...opciones,
    soloPedidos: urgentes.map((p) => p.orderId),
    msDisponibles: MS_CORTE_LUNES,
  });

  const sinTiempo = contarSinTiempo(primero.errores);
  if (sinTiempo > 0) {
    return {
      cortes: [primero],
      pendientes: sinTiempo + resto.length,
      aviso:
        `Ya salió un corte con ${primero.pedidos} pedidos de días anteriores, pero ${sinTiempo} de esos días se quedaron ` +
        `por tiempo: la pantalla vuelve a lanzar el corte sola (toma lo más viejo primero) hasta que no quede nada de antes de hoy; ` +
        `los ${resto.length} de hoy se cortan al final.`,
    };
  }

  const restante = MS_CORTE_LUNES - (Date.now() - arranque);
  if (restante < 45_000) {
    return {
      cortes: [primero],
      pendientes: resto.length,
      aviso:
        `Ya salió el corte de lo atrasado (${primero.pedidos} pedidos). No alcanzó el tiempo para el segundo: ` +
        `dale a "Hacer corte" y se lleva los ${resto.length} de hoy.`,
    };
  }

  const segundo = await hacerCorte(admin, accountId, {
    ...opciones,
    soloPedidos: resto.map((p) => p.orderId),
    msDisponibles: restante,
  });
  return { cortes: [primero, segundo], pendientes: contarSinTiempo(segundo.errores), aviso: null };
}

// ---------------------------------------------------------------------------
// El corte de AYER: solo lo de antes de hoy, para adelantar trabajo
// ---------------------------------------------------------------------------

/**
 * "Corte ayer": UN corte con todo lo pendiente hasta ayer a las 23:59 de
 * México (y lo más viejo, si hay); lo vendido HOY se queda sin corte.
 *
 * Pedido del dueño (22-sep-2026): «quiero una que se llame corte ayer, que
 * me haga corte de todo lo que entró ayer hasta las 12 de la noche, para
 * poder ir preparándolo si tengo tiempo adelantado un día antes». Es la
 * primera tanda del corte lunes, sola: mismo día de referencia
 * (`partirEnTandas`, hora de México), sin la segunda tanda. Lo de hoy sigue
 * entrando y se corta mañana con este mismo botón o cuando sea con "Hacer
 * corte".
 */
export async function hacerCorteAyer(
  admin: any,
  accountId: string,
  opciones: { handover: OpcionesEnvio["handover"]; creadoPor?: string | null; sinDefensa?: boolean },
): Promise<ResultadoCorteLunes> {
  const pendientes = await pendientesDeCorte(admin, accountId);
  if (!pendientes.length) throw new Error("No hay pedidos por despachar.");

  const { urgentes, resto, corte } = partirEnTandas(pendientes);
  if (!urgentes.length) {
    throw new Error(
      `No hay pedidos de ayer ni de antes: los ${resto.length} pendientes son de hoy. ` +
        `Se cortan mañana con "Corte ayer" o ahora con "Hacer corte".`,
    );
  }

  const unico = await hacerCorte(admin, accountId, {
    ...opciones,
    soloPedidos: urgentes.map((p) => p.orderId),
    msDisponibles: MS_CORTE_LUNES,
  });

  const sinTiempo = contarSinTiempo(unico.errores);
  const deHoy = resto.length ? ` Los ${resto.length} de hoy se quedan pendientes.` : "";
  if (sinTiempo > 0) {
    return {
      cortes: [unico],
      pendientes: sinTiempo + resto.length,
      aviso:
        `Corte ayer: ${unico.pedidos} pedidos hasta el ${corte} a las 23:59 (hora de México), pero ${sinTiempo} de esos ` +
        `días se quedaron por tiempo: la pantalla vuelve a lanzar el corte sola hasta que no quede nada de antes de hoy.${deHoy}`,
    };
  }
  return {
    cortes: [unico],
    pendientes: resto.length,
    aviso: `Corte ayer: todo lo pendiente hasta el ${corte} a las 23:59 (hora de México).${deHoy}`,
  };
}

// ---------------------------------------------------------------------------
// Los paquetes de un corte, ya ordenados y numerados
// ---------------------------------------------------------------------------

export interface CorteCargado {
  id: number;
  numero: number;
  creadoEn: string;
  /** con qué orden se numeró este corte; los viejos, "bodega" */
  orden: OrdenPaquetes;
  paquetes: PaqueteNumerado[];
}

export async function cargarCorte(admin: any, accountId: string, corteId: number): Promise<CorteCargado> {
  const { data: corte } = await admin
    .from("tiktok_cortes")
    .select("id, numero, creado_en, orden_paquetes")
    .eq("account_id", accountId)
    .eq("id", corteId)
    .maybeSingle();
  if (!corte) throw new Error("Ese corte no existe.");
  const orden: OrdenPaquetes = corte.orden_paquetes === "un-modelo" ? "un-modelo" : "bodega";

  const [ordenes, items] = await Promise.all([
    traerTodo<any>(admin, "tiktok_ordenes", "order_id, paquetes, detalle, paqueteria, estado", (q) =>
      q.eq("account_id", accountId).eq("corte_id", corteId),
    ),
    traerTodo<any>(admin, "tiktok_orden_items", "order_id, line_item_id, sku_interno, seller_sku, cantidad, estado, bloqueo_resultado", (q) =>
      q.eq("account_id", accountId),
    ),
  ]);
  const ordenIds = new Set((ordenes ?? []).map((o: any) => o.order_id));
  const itemsPorOrden = new Map<string, any[]>();
  for (const i of items ?? []) {
    if (!ordenIds.has(i.order_id)) continue;
    // Un renglón cancelado —en TikTok, o por el bloqueo del corte— no va
    // en la etiqueta ni en la lista: ese par no se manda.
    if (efectoDeEstado(i.estado) === "reversa" || i.bloqueo_resultado === "cancelado") continue;
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

    // Cancelado después del corte (el pedido entero, o todos sus renglones):
    // conserva su número, pero ya no falta por preparar.
    const cancelado = efectoDeEstado(o.estado) === "reversa" || renglones.length === 0;
    // Ya se fue con el repartidor (TikTok lo tiene en camino o entregado):
    // salió aunque no se haya escaneado.
    const enviado = yaSeEnvio(o.estado);

    if (ids.length <= 1) {
      paquetes.push({
        orderId: o.order_id,
        packageId: ids[0] ?? "",
        destinatario: o.detalle?.destinatario ?? null,
        paqueteria: o.paqueteria ?? null,
        pares: aPar(renglones),
        cancelado,
        enviado,
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
        paqueteria: o.paqueteria ?? null,
        pares: aPar(propios.length ? propios : renglones),
        cancelado,
        enviado,
      });
    }
  }

  return {
    id: corte.id,
    numero: corte.numero,
    creadoEn: corte.creado_en,
    orden,
    paquetes: numerarPaquetes(paquetes, orden),
  };
}

// ---------------------------------------------------------------------------
// PDF de etiquetas: las de TikTok, en orden, con "#n · SKU" abajo a la derecha
// ---------------------------------------------------------------------------

/** Tamaño A6 en puntos, por si la guía llega como imagen y hay que darle hoja. */
const A6: [number, number] = [297.64, 419.53];

/** Sube cuando cambia el estampado de la guía (invalida los PDF de corte guardados). */
const VERSION_ESTAMPA = 6;

/** Dónde va el estampado: abajo, pegado al borde (texto a la izquierda, código a la derecha). */
const ESTAMPA = { margen: 5, tamano: 7, barrasAlto: 16, barrasAnchoMax: 120, porColumna: 3 };

/**
 * La FRANJA que se le agrega abajo a una guía que no deja espacio (Cainiao
 * llena la hoja hasta el borde con su teléfono y su correo): lo justo para
 * el estampado, 34 pt ≈ 1.2 cm, un 8 % más de alto en una A6. La impresora
 * encoge la hoja ese poco y lo demás sigue legible; encimar el código del
 * pedido sobre el pie de la guía costaba el escaneo. Pedido del dueño el
 * 15-sep-2026: «cuando no sean de J&T… lo aumentes tú abajo, pero tampoco
 * mucho».
 */
const FRANJA_ESTAMPA = 34;

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
  // El FNSKU se escanea de la caja del zapato, no de la guía. En una guía
  // con franja (`necesitaFranja`) el estampado cae dentro de la franja: la
  // guía se dibuja arriba, completa, y abajo queda blanco para nosotros.
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

    const franja = necesitaFranja(p.paqueteria) ? FRANJA_ESTAMPA : 0;

    if (bytes && esPdf(bytes)) {
      if (!franja) {
        // J&T: la guía tal cual, el estampado cabe en su espacio en blanco.
        const origen = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const copias = await doc.copyPages(origen, origen.getPageIndices());
        for (const pagina of copias) {
          doc.addPage(pagina);
          estampar(pagina, p);
        }
        continue;
      }
      // Con franja: la guía se INCRUSTA completa en una hoja un poco más
      // alta, pegada arriba, y el estampado va en la franja de abajo.
      const origen = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const incrustadas = await doc.embedPdf(origen, origen.getPageIndices());
      for (const guia of incrustadas) {
        const pagina = doc.addPage([guia.width, guia.height + franja]);
        pagina.drawPage(guia, { x: 0, y: franja, width: guia.width, height: guia.height });
        estampar(pagina, p);
      }
      continue;
    }

    if (bytes && (esPng(bytes) || esJpg(bytes))) {
      const img = esPng(bytes) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const pagina = doc.addPage([A6[0], A6[1] + franja]);
      const escala = Math.min(A6[0] / img.width, A6[1] / img.height);
      const w = img.width * escala;
      const h = img.height * escala;
      pagina.drawImage(img, { x: (A6[0] - w) / 2, y: A6[1] + franja - h, width: w, height: h });
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
// PDF de la lista de empaque: por modelo, mismos números, sin códigos
// ---------------------------------------------------------------------------

/**
 * La lista de EMPAQUE del corte: la hoja que va en la mesa junto a las
 * guías. Mismo orden y mismos "#n" que las guías. Desde el 18-sep-2026 NO
 * lleva códigos de barras (decisión del dueño: «ya no me pongas el FNSKU
 * para escanear, solo el SKU y cantidades»): el escaneo en la estación se
 * hace con la GUÍA (código del pedido) y con la CAJA (FNSKU / código Full).
 * Un renglón por SKU COMPLETO (el dueño lo prefiere así, no partido en
 * color y talla), en 16 pt, con los paquetes INTERCALADOS gris y blanco
 * para no perder la línea en la que se va; la cantidad de más de un par
 * va en un recuadro sombreado para que no se pase, y un paquete con
 * varios renglones va dentro de un recuadro negro con su total.
 */
export async function pdfListaDelCorte(admin: any, accountId: string, corteId: number): Promise<Uint8Array> {
  const corte = await cargarCorte(admin, accountId, corteId);
  const grupos = agruparPorModelo(corte.paquetes, corte.orden);

  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Corte ${corte.numero} · lista de empaque`);

  const CARTA: [number, number] = [612, 792];
  const M = 36;
  const ANCHO = CARTA[0] - 2 * M;
  // Columnas: # | Pedido (texto) | SKU completo | Cant. | Destinatario | ☐
  const COL = [30, 118, 190, 44, ANCHO - 30 - 118 - 190 - 44 - 18, 18];
  const XS = COL.reduce<number[]>((acc, w, i) => [...acc, (acc[i - 1] ?? M) + (i ? COL[i - 1] : 0)], []);
  const FILA = 16;
  const negro = rgb(0, 0, 0);
  const gris = rgb(0.45, 0.45, 0.45);
  const linea = rgb(0.75, 0.75, 0.75);
  const fondoGris = rgb(0.9, 0.9, 0.9);
  const sombraCant = rgb(0.8, 0.8, 0.8);

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
  const texto = (t: string, x: number, size: number, f = normal, color = negro) =>
    pagina.drawText(t, { x, y, size, font: f, color });
  const recorta = (t: string, ancho: number, size: number, f = normal) => {
    let s = t;
    while (s.length > 1 && f.widthOfTextAtSize(s, size) > ancho - 4) s = s.slice(0, -1);
    return s === t ? t : s.slice(0, -1) + "…";
  };

  const encabezado = () => {
    const titulos = ["#", "Pedido", "SKU", "Cant.", "Destinatario", ""];
    titulos.forEach((t, i) => {
      const x = i === 3 ? XS[i] + (COL[i] - negrita.widthOfTextAtSize(t, 8)) / 2 : XS[i] + 2;
      pagina.drawText(t, { x, y, size: 8, font: negrita, color: gris });
    });
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
    if (y < M + FILA * 4) nuevaPagina();
    const titulo = g.revuelto ? `${g.modelo.toUpperCase()} (varios modelos en la misma caja)` : g.modelo;
    texto(`${titulo}  —  ${g.pares} ${g.pares === 1 ? "par" : "pares"} en ${g.paquetes.length} ${g.paquetes.length === 1 ? "paquete" : "paquetes"}`, M, 11, negrita);
    y -= 14;
    encabezado();

    g.paquetes.forEach((p, iPaquete) => {
      // Un renglón por SKU del paquete, ya en orden modelo → color → talla.
      const renglones = p.pares;
      const paresPaquete = renglones.reduce((a, r) => a + r.pares, 0);
      // El paquete completo cabe en la página o se pasa entero a la siguiente.
      if (y - FILA * (renglones.length - 1) < M) {
        nuevaPagina();
        encabezado();
      }
      const yArribaPaquete = y + FILA - 3;
      const varios = renglones.length > 1;

      // Fondo intercalado POR PAQUETE: todos los renglones de la misma caja
      // comparten el tono, para que el recuadro y la franja digan lo mismo.
      if (iPaquete % 2 === 0) {
        pagina.drawRectangle({
          x: M - 2,
          y: y - FILA * (renglones.length - 1) - 3,
          width: ANCHO + 4,
          height: FILA * renglones.length,
          color: fondoGris,
        });
      }

      renglones.forEach((r, i) => {
        const base = y + 4;
        if (i === 0) {
          pagina.drawText(`#${p.numero}`, { x: XS[0] + 2, y: base, size: 10, font: negrita });
          pagina.drawText(p.orderId, { x: XS[1] + 2, y: base, size: 8, font: normal, color: gris });
        }
        pagina.drawText(recorta(r.sku, COL[2], 9.5, negrita), { x: XS[2] + 2, y: base, size: 9.5, font: negrita });
        // La cantidad: la de más de un par va en un recuadro sombreado.
        const cant = String(r.pares);
        if (r.pares > 1) {
          pagina.drawRectangle({
            x: XS[3] + 3,
            y: y + 0.5,
            width: COL[3] - 6,
            height: FILA - 2,
            color: sombraCant,
            borderColor: negro,
            borderWidth: 0.8,
          });
        }
        pagina.drawText(cant, { x: XS[3] + (COL[3] - negrita.widthOfTextAtSize(cant, 10)) / 2, y: base, size: 10, font: negrita });
        if (i === 0) {
          pagina.drawText(recorta(p.destinatario ?? "", COL[4], 7.5), { x: XS[4] + 2, y: base, size: 7.5, font: normal, color: gris });
          pagina.drawRectangle({ x: XS[5] + 3, y: y + 1, width: 11, height: 11, borderColor: negro, borderWidth: 0.8, color: rgb(1, 1, 1) });
        }
        if (varios && i < renglones.length - 1) {
          pagina.drawLine({ start: { x: M + COL[0], y: y - 1 }, end: { x: M + ANCHO, y: y - 1 }, thickness: 0.3, color: linea });
        }
        y -= FILA;
      });

      // Un paquete con varios renglones va dentro de un recuadro negro con
      // su total: todo lo de adentro se empaca junto, en la misma caja.
      if (varios) {
        pagina.drawRectangle({
          x: M - 2,
          y: y + FILA - 3,
          width: ANCHO + 4,
          height: yArribaPaquete - (y + FILA - 3),
          borderColor: negro,
          borderWidth: 1.2,
        });
        pagina.drawText(`${paresPaquete} pares en la misma caja`, { x: XS[4] + 2, y: y + FILA + 4, size: 7, font: normal, color: gris });
      }
    });
    y -= 10;
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// Releer lo que sigue sin preparar en los cortes recientes
// ---------------------------------------------------------------------------

/** Cuántos días hacia atrás se releen los cortes; los mismos del correo de faltantes. */
export const DIAS_RELEER_CORTES = 3;
/** Tope de pedidos por corrida: TikTok contesta ~1 por llamada y esto corre de fondo. */
export const TOPE_RELEER = 80;

/**
 * Vuelve a leer en TikTok los pedidos de los cortes recientes que siguen
 * sin constancia de preparado y no están cancelados. Un pedido que se
 * canceló después del corte (en el Seller Center, o por el comprador) deja
 * de contar como faltante en cuanto se relee; sin esto dependía del aviso
 * de TikTok o de la ventana del cron, y el 586038646418343934 del corte
 * #20 siguió como faltante tres días. Corre de fondo después de cada corte
 * y antes del correo de faltantes de la mañana (pedido del dueño,
 * 18-sep-2026: «que se vaya actualizando cada vez que hago corte, también
 * los pasados»).
 */
export async function releerSinPrepararDeCortesRecientes(
  admin: any,
  accountId: string,
  opciones: { dias?: number; tope?: number } = {},
): Promise<ResultadoRelectura> {
  const dias = opciones.dias ?? DIAS_RELEER_CORTES;
  const tope = opciones.tope ?? TOPE_RELEER;
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const { data: cortes } = await admin
    .from("tiktok_cortes")
    .select("id")
    .eq("account_id", accountId)
    .gte("creado_en", desde);
  const ids = (cortes ?? []).map((c: any) => c.id as number);
  const nada: ResultadoRelectura = { releidos: 0, cortes: ids.length, enviados: [], cancelados: [], avisos: [] };
  if (!ids.length) return nada;

  const [ordenes, preparados] = await Promise.all([
    traerTodo<any>(admin, "tiktok_ordenes", "order_id, corte_id, estado", (q) =>
      q.eq("account_id", accountId).in("corte_id", ids),
    ),
    traerTodo<any>(admin, "tiktok_preparaciones", "order_id, id", (q) =>
      q.eq("account_id", accountId).in("corte_id", ids),
    ),
  ]);
  const hechos = new Set((preparados ?? []).map((p: any) => String(p.order_id)));
  // Lo cancelado y lo que ya se fue con el repartidor no cambia: no se relee.
  const antes = (ordenes ?? [])
    .filter((o: any) => !hechos.has(String(o.order_id)) && efectoDeEstado(o.estado) !== "reversa" && !yaSeEnvio(o.estado))
    .map((o: any) => ({ orderId: String(o.order_id), estado: o.estado as string | null }))
    .slice(0, tope);
  if (!antes.length) return nada;
  const pendientes = antes.map((a) => a.orderId);
  const r = await sincronizarPedidosPorId(admin, accountId, pendientes);
  const avisos = [...(r.avisos ?? [])];
  if (r.ocupado) avisos.push("Otra sincronización de TikTok estaba en curso; vuelve a intentar en un momento.");

  // Se vuelve a leer lo que TikTok dijo y se compara con lo de antes: eso es
  // lo que dejó de faltar.
  const { data: despuesRaw } = await admin
    .from("tiktok_ordenes")
    .select("order_id, estado")
    .eq("account_id", accountId)
    .in("order_id", pendientes);
  const despues = new Map<string, string | null>((despuesRaw ?? []).map((o: any) => [String(o.order_id), o.estado as string | null]));
  const cambios = cambiosDeRelectura(antes, despues);
  return { releidos: pendientes.length, cortes: ids.length, ...cambios, avisos };
}

export interface ResultadoRelectura {
  /** Pedidos que se le volvieron a pedir a TikTok. */
  releidos: number;
  /** Cortes de la ventana. */
  cortes: number;
  /** Pedidos que en esta relectura resultaron ya en camino o entregados. */
  enviados: string[];
  /** Pedidos que en esta relectura resultaron cancelados. */
  cancelados: string[];
  avisos: string[];
}

/** Ventana del botón «Actualizar» de Despacho: los cortes que la pantalla enseña. */
export const DIAS_RELEER_BOTON = 14;
export const TOPE_RELEER_BOTON = 200;

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
  /** paquetes del corte que siguen vivos (sin contar los cancelados después) */
  total: number;
  preparados: number;
  /** paquetes cancelados después del corte: conservan su número, no faltan */
  cancelados: number;
  /** paquetes que ya se fueron con el repartidor sin escanearse: resueltos, no faltan */
  enviados: number;
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
  const vivos = faltantesDePaquetes(corte.paquetes, yaNumerados);
  const faltantes: PaqueteFaltante[] = vivos.faltantes
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

  // Solo lo que de verdad se quedó fuera: un renglón sin pedido es un aviso
  // del corte entero, y uno cuyo pedido SÍ está en el corte es una nota
  // (por ejemplo, que salió como paquetería), no un rechazo.
  const enElCorte = new Set(corte.paquetes.map((p) => p.orderId));
  const errores = ((fila?.data?.errores ?? []) as { orderId: string; error: string }[]).filter(
    (e) => e && e.orderId && !enElCorte.has(e.orderId),
  );

  return {
    id: corte.id,
    numero: corte.numero,
    creadoEn: corte.creadoEn,
    total: vivos.total,
    preparados: yaNumerados.size,
    cancelados: vivos.cancelados,
    enviados: vivos.enviados,
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
    /** renglones bloqueados (defensa): se cancelan en TikTok, no se confirman */
    bloqueados: { sku: string; pares: number }[];
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
  // La misma defensa automática que aplicaría el corte, sin escribir nada.
  const { porPedido: renglonesSim, enDuda } = await renglonesConDefensa(admin, accountId, pendientes);
  const porOrden = new Map<string, Map<string, number>>();
  const bloqueadosPorOrden = new Map<string, Map<string, number>>();
  const dudaPorOrden = new Map<string, Set<string>>();
  for (const d of enDuda) {
    const l = dudaPorOrden.get(d.orderId) ?? new Set<string>();
    l.add(d.sku);
    dudaPorOrden.set(d.orderId, l);
  }
  for (const [orderId, lista] of renglonesSim) {
    for (const r of lista) {
      if (efectoDeEstado(r.estado) === "reversa") continue;
      const destino = r.bloqueado ? bloqueadosPorOrden : porOrden;
      const m = destino.get(orderId) ?? new Map<string, number>();
      m.set(r.sku, (m.get(r.sku) ?? 0) + r.cantidad);
      destino.set(orderId, m);
    }
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
    const bloqueados = [...(bloqueadosPorOrden.get(p.orderId) ?? new Map())].map(([sku, n]) => ({ sku, pares: n }));
    const duda = dudaPorOrden.get(p.orderId);
    if (duda?.size && efectoDeEstado(p.estado) !== "salida") {
      aviso = `Stock en duda de ${[...duda].join(", ")} (la bodega dejó de reportarlo y el kardex aún tiene pares): se queda fuera sin cancelar`;
    }
    if (bloqueados.length) {
      aviso = pares.length
        ? `Se cancela en TikTok ${bloqueados.map((b) => `${b.sku} ×${b.pares}`).join(", ")} y se confirma el resto`
        : "Todo el pedido está bloqueado: se cancela en TikTok, no se confirma";
    }
    salida.push({ orderId: p.orderId, estado: p.estado, paquetes, recoleccion, pares, bloqueados, aviso });
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
