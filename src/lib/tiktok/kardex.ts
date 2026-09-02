/**
 * El kardex del almacén de TikTok: aritmética pura, sin base de datos.
 *
 * Aquí vive la única regla que de verdad importa en este canal: CUÁNDO un
 * par deja de estar disponible para un comprador. En Full y en FBA esa
 * decisión la toma el marketplace; aquí la tomamos nosotros, y equivocarse
 * tiene dos formas caras:
 *
 *   · descontar de más -> se agota una publicación que sí tenía pares y
 *     se dejan de vender;
 *   · descontar de menos -> se vende algo que ya no existe, y eso en TikTok
 *     se paga con cancelaciones y con calificación de la tienda.
 *
 * Por eso la venta pagada NO descuenta: APARTA. El par sigue físicamente en
 * el almacén hasta que el envío se confirma, pero ya tiene dueño y no se le
 * puede ofrecer a nadie más. El saldo baja cuando el paquete sale.
 */

/** Los movimientos que puede tener un SKU en el almacén de TikTok. */
export type TipoMovimiento = "entrada" | "salida" | "devolucion" | "merma" | "ajuste";

export interface Movimiento {
  sku: string;
  tipo: TipoMovimiento;
  /** Siempre positiva. En un `ajuste` es el saldo OBJETIVO, no la diferencia. */
  cantidad: number;
  referencia?: string | null;
  fecha?: string;
}

/**
 * Cómo mueve el saldo cada tipo. El `ajuste` no suma: PISA el saldo, porque
 * es el resultado de un conteo físico y el conteo siempre gana.
 */
export function aplicarMovimiento(saldo: number, m: { tipo: TipoMovimiento; cantidad: number }): number {
  switch (m.tipo) {
    case "entrada":
    case "devolucion":
      return saldo + m.cantidad;
    case "salida":
    case "merma":
      return saldo - m.cantidad;
    case "ajuste":
      return m.cantidad;
  }
}

/**
 * El saldo de cada SKU después de correr toda su historia, en orden.
 *
 * Se ordena por fecha antes de sumar porque un `ajuste` pisa el saldo: si un
 * conteo del martes se aplicara después de una entrada del miércoles, la
 * entrada se perdería.
 */
export function saldosDesdeMovimientos(movs: Movimiento[]): Map<string, number> {
  const porSku = new Map<string, Movimiento[]>();
  for (const m of movs) {
    const lista = porSku.get(m.sku);
    if (lista) lista.push(m);
    else porSku.set(m.sku, [m]);
  }

  const saldos = new Map<string, number>();
  for (const [sku, lista] of porSku) {
    const enOrden = [...lista].sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? ""));
    let saldo = 0;
    for (const m of enOrden) saldo = aplicarMovimiento(saldo, m);
    saldos.set(sku, saldo);
  }
  return saldos;
}

// ---------------------------------------------------------------------------
// Estados de TikTok -> qué le hacen al inventario
// ---------------------------------------------------------------------------

/**
 * Qué significa para el almacén el estado de un renglón de pedido.
 *
 *   apartado -> pagado y todavía aquí: no se puede vender otra vez
 *   salida   -> ya salió del almacén: el saldo baja
 *   reversa  -> se canceló o regresó: si ya había salido, el saldo vuelve
 *   nada     -> ni siquiera está pagado
 */
export type EfectoInventario = "apartado" | "salida" | "reversa" | "nada";

/**
 * `AWAITING_COLLECTION` es la frontera: ahí el vendedor ya confirmó el envío
 * y le pegó la guía al paquete. Que el repartidor todavía no pase por él no
 * cambia nada para el inventario — ese par ya está empacado y no se vuelve a
 * vender.
 */
const ESTADOS_SALIDA = new Set([
  "AWAITING_COLLECTION",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
]);

const ESTADOS_APARTADO = new Set([
  "AWAITING_SHIPMENT",
  "PARTIALLY_SHIPPING",
  "ON_HOLD",
]);

const ESTADOS_REVERSA = new Set([
  "CANCEL",
  "CANCELLED",
  "RETURNED",
  "WILL_RETURN",
]);

export function efectoDeEstado(estado: string | null | undefined): EfectoInventario {
  const e = String(estado ?? "").trim().toUpperCase();
  if (ESTADOS_SALIDA.has(e)) return "salida";
  if (ESTADOS_APARTADO.has(e)) return "apartado";
  if (ESTADOS_REVERSA.has(e)) return "reversa";
  return "nada";
}

// ---------------------------------------------------------------------------
// De los pedidos al kardex
// ---------------------------------------------------------------------------

export interface RenglonPedido {
  orderId: string;
  /** SKU del ERP ya amarrado. Sin esto el renglón no puede mover el kardex. */
  skuInterno: string | null;
  cantidad: number;
  /** Estado del RENGLÓN, que en un pedido parcial no es el del pedido. */
  estado: string | null;
  fecha?: string | null;
}

export interface MovimientoNuevo {
  sku: string;
  tipo: Extract<TipoMovimiento, "salida" | "devolucion">;
  cantidad: number;
  referencia: string;
  motivo: string;
  fecha: string;
}

/**
 * Qué movimientos faltan por registrar, vistos los pedidos de TikTok y lo
 * que el kardex ya tiene.
 *
 * La idempotencia no se confía a la memoria: `yaRegistrados` trae las llaves
 * `tipo|referencia|sku` que ya existen, y la base además tiene un índice
 * único sobre esas tres columnas. Sincronizar dos veces el mismo pedido no
 * puede descontar dos veces ni aunque dos corridas se encimen.
 *
 * Un renglón sin `skuInterno` NO mueve nada: se reporta aparte para que
 * aparezca en Pendientes. Adivinar el SKU sería peor que no descontar —
 * descontaría del par equivocado y dejaría dos publicaciones mal.
 */
export function movimientosPendientes(
  renglones: RenglonPedido[],
  yaRegistrados: Set<string>,
): { movimientos: MovimientoNuevo[]; sinAmarre: RenglonPedido[] } {
  const movimientos: MovimientoNuevo[] = [];
  const sinAmarre: RenglonPedido[] = [];

  // Un pedido puede traer varios renglones del mismo SKU (dos pares de la
  // misma talla en líneas distintas). Se juntan: el kardex guarda UNA salida
  // por pedido y SKU, que es lo que el índice único permite.
  const juntos = new Map<string, { r: RenglonPedido; efecto: EfectoInventario; cantidad: number }>();

  for (const r of renglones) {
    const efecto = efectoDeEstado(r.estado);
    if (efecto === "nada" || efecto === "apartado") continue;

    if (!r.skuInterno) {
      sinAmarre.push(r);
      continue;
    }

    const clave = `${r.orderId}|${r.skuInterno}|${efecto}`;
    const previo = juntos.get(clave);
    if (previo) previo.cantidad += r.cantidad;
    else juntos.set(clave, { r, efecto, cantidad: r.cantidad });
  }

  for (const { r, efecto, cantidad } of juntos.values()) {
    if (cantidad <= 0) continue;
    const sku = r.skuInterno as string;
    const fecha = r.fecha ?? new Date().toISOString();

    if (efecto === "salida") {
      if (yaRegistrados.has(`salida|${r.orderId}|${sku}`)) continue;
      movimientos.push({
        sku,
        tipo: "salida",
        cantidad,
        referencia: r.orderId,
        motivo: "Envío confirmado en TikTok Shop",
        fecha,
      });
      continue;
    }

    // Reversa: solo devuelve al almacén lo que de verdad salió. Cancelar un
    // pedido que nunca se envió no mueve el saldo — solo suelta el apartado,
    // y el apartado no es un movimiento del kardex.
    if (!yaRegistrados.has(`salida|${r.orderId}|${sku}`)) continue;
    if (yaRegistrados.has(`devolucion|${r.orderId}|${sku}`)) continue;
    movimientos.push({
      sku,
      tipo: "devolucion",
      cantidad,
      referencia: r.orderId,
      motivo: "Pedido cancelado o devuelto en TikTok Shop",
      fecha,
    });
  }

  return { movimientos, sinAmarre };
}

/** Los pares pagados que todavía no salen, por SKU. */
export function apartadosPorSku(renglones: RenglonPedido[]): Map<string, number> {
  const apartados = new Map<string, number>();
  for (const r of renglones) {
    if (!r.skuInterno) continue;
    if (efectoDeEstado(r.estado) !== "apartado") continue;
    apartados.set(r.skuInterno, (apartados.get(r.skuInterno) ?? 0) + r.cantidad);
  }
  return apartados;
}

// ---------------------------------------------------------------------------
// Lo que ve el comprador
// ---------------------------------------------------------------------------

/**
 * El número que se publica en TikTok.
 *
 * Nunca es negativo: un saldo en rojo significa que el kardex se quedó atrás
 * (se vendió algo que no estaba capturado como entrada), y eso se resuelve
 * capturando la entrada o contando, no publicándole un absurdo a TikTok. El
 * saldo negativo sí se conserva tal cual en el kardex, porque es justo la
 * señal de que algo falta por capturar.
 */
export function disponibleParaCompradores(saldo: number, apartado: number): number {
  return Math.max(0, saldo - apartado);
}

export interface RenglonInventarioTikTok {
  sku: string;
  saldo: number;
  apartado: number;
  disponible: number;
  /** Lo último que TikTok confirmó tener publicado; null si nunca se empujó. */
  publicado: number | null;
}

export interface CambioAPublicar {
  sku: string;
  de: number | null;
  a: number;
}

/**
 * Qué SKUs hay que empujarle a TikTok. Solo los que cambiaron: mandar los
 * mil cada vez quemaría la cuota del API en la primera hora y tardaría más
 * que la ventana de la función.
 */
export function cambiosAPublicar(renglones: RenglonInventarioTikTok[]): CambioAPublicar[] {
  const cambios: CambioAPublicar[] = [];
  for (const r of renglones) {
    if (r.publicado === r.disponible) continue;
    cambios.push({ sku: r.sku, de: r.publicado, a: r.disponible });
  }
  return cambios;
}

// ---------------------------------------------------------------------------
// Reconciliar contra lo que TikTok DICE tener, no contra lo que escribimos
// ---------------------------------------------------------------------------

export interface PublicacionTikTok {
  skuId: string;
  productId: string;
  skuInterno: string;
  /** lo que TikTok reporta en su catálogo; null si no lo dijo */
  cantidadTikTok: number | null;
}

export interface EscrituraTikTok {
  skuId: string;
  productId: string;
  skuInterno: string;
  de: number | null;
  a: number;
}

/**
 * Qué publicaciones hay que escribir para que TikTok diga lo mismo que el
 * kardex. Se compara publicación por publicación contra el número REAL que
 * TikTok reporta —no contra lo último que el ERP escribió— porque cualquiera
 * puede editar el stock en el Seller Center y el ERP tiene que corregirlo,
 * no ignorarlo. Solo se consideran los SKUs que el kardex conoce y que
 * alguna vez se contaron: a los demás no se les toca su número.
 */
export function escriturasContraTikTok(
  publicaciones: PublicacionTikTok[],
  disponibles: Map<string, number>,
): EscrituraTikTok[] {
  const salida: EscrituraTikTok[] = [];
  for (const p of publicaciones) {
    const objetivo = disponibles.get(p.skuInterno);
    if (objetivo === undefined) continue;
    if (p.cantidadTikTok === objetivo) continue;
    salida.push({
      skuId: p.skuId,
      productId: p.productId,
      skuInterno: p.skuInterno,
      de: p.cantidadTikTok,
      a: objetivo,
    });
  }
  return salida;
}
