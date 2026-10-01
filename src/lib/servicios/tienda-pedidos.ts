/**
 * Pedidos de la tienda en línea de GETAC, del lado del ERP (pantalla
 * `/tiktok/tienda`). La tienda (`tienda/`) crea el pedido y aparta en la
 * base; aquí se despacha, se cancela y se le avisa a TikTok.
 *
 * El par de un pedido de la tienda sale del MISMO almacén que TikTok
 * (la bodega TikTok de Industher), así que su envío hace lo mismo que un
 * corte: SALIDA en el kardex con referencia = folio (GW000123), salida al
 * 3PL (`tiktok_salidas_3pl`, order_id = folio) y el apartado de la tienda
 * se suelta en el mismo acto (`tienda_recalcular_apartado`).
 */
import { traerTodo, type DB } from "../datos/repos";
import { registrarMovimientos, sincronizarTikTok } from "./tiktok";
import { empujarSalidasAl3pl } from "./tiktok-3pl";
import { NOMBRE_ESTADO, type EstadoTienda, type ItemPedidoTienda, type PedidoTienda } from "../tienda/estados";

export { NOMBRE_ESTADO, type EstadoTienda, type ItemPedidoTienda, type PedidoTienda };

export async function listarPedidosTienda(db: DB, accountId: string, dias = 30): Promise<PedidoTienda[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const pedidos = await traerTodo<any>(
    db,
    "tienda_pedidos",
    "id, folio, estado, creado_en, pagado_en, enviado_en, nombre, email, telefono, direccion, subtotal, envio, total, pago_estado, mp_pago, guia, paqueteria, nota",
    (q) => q.eq("account_id", accountId).gte("creado_en", desde).order("id", { ascending: false }),
  );
  // Lo que sigue pendiente de enviar no se esconde aunque sea viejo.
  const { data: viejos } = await db
    .from("tienda_pedidos")
    .select("id, folio, estado, creado_en, pagado_en, enviado_en, nombre, email, telefono, direccion, subtotal, envio, total, pago_estado, mp_pago, guia, paqueteria, nota")
    .eq("account_id", accountId)
    .in("estado", ["pagado", "sin_stock"])
    .lt("creado_en", desde)
    .order("id", { ascending: false });
  const todos = [...(pedidos ?? []), ...(viejos ?? [])];
  if (!todos.length) return [];

  const ids = todos.map((p) => p.id);
  const items: any[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db
      .from("tienda_pedido_items")
      .select("pedido_id, sku_interno, titulo, color, talla, cantidad, precio, imagen")
      .in("pedido_id", ids.slice(i, i + 300))
      .order("id", { ascending: true });
    items.push(...(data ?? []));
  }
  const porPedido = new Map<number, ItemPedidoTienda[]>();
  for (const it of items) {
    const lista = porPedido.get(it.pedido_id) ?? [];
    lista.push({
      skuInterno: it.sku_interno,
      titulo: it.titulo,
      color: it.color,
      talla: it.talla,
      cantidad: Number(it.cantidad),
      precio: Number(it.precio),
      imagen: it.imagen,
    });
    porPedido.set(it.pedido_id, lista);
  }

  return todos.map((p) => ({
    id: Number(p.id),
    folio: p.folio,
    estado: p.estado,
    creadoEn: p.creado_en,
    pagadoEn: p.pagado_en,
    enviadoEn: p.enviado_en,
    nombre: p.nombre,
    email: p.email,
    telefono: p.telefono,
    direccion: p.direccion ?? {},
    subtotal: Number(p.subtotal),
    envio: Number(p.envio),
    total: Number(p.total),
    pagoEstado: p.pago_estado,
    mpPago: p.mp_pago,
    guia: p.guia,
    paqueteria: p.paqueteria,
    nota: p.nota,
    items: porPedido.get(Number(p.id)) ?? [],
  }));
}

/** Pares por SKU de un pedido (dos renglones del mismo SKU se juntan: una salida por pedido y SKU). */
export function paresPorSku(items: { skuInterno: string; cantidad: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) if (it.skuInterno && it.cantidad > 0) m.set(it.skuInterno, (m.get(it.skuInterno) ?? 0) + it.cantidad);
  return m;
}

async function cargarPedido(admin: any, accountId: string, id: number) {
  const { data: p } = await admin
    .from("tienda_pedidos")
    .select("id, folio, estado, mp_pago, total")
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (!p) throw new Error("Ese pedido no existe.");
  const { data: items } = await admin
    .from("tienda_pedido_items")
    .select("sku_interno, cantidad")
    .eq("pedido_id", id);
  return {
    pedido: p as { id: number; folio: string; estado: EstadoTienda; mp_pago: string | null; total: number },
    items: (items ?? []).map((i: any) => ({ skuInterno: String(i.sku_interno), cantidad: Number(i.cantidad) })),
  };
}

async function recalcularApartado(admin: any, accountId: string, skus: string[]) {
  const { error } = await admin.rpc("tienda_recalcular_apartado", { p_account: accountId, p_skus: skus });
  if (error) throw new Error(`Apartado de la tienda: ${error.message}`);
}

/**
 * Le avisa a TikTok que el disponible cambió. Siempre pasando por
 * `sincronizarTikTok` con `soloPedidos`: NUNCA se le escribe sin antes leer
 * sus pedidos recientes (regla de oro del kardex).
 */
export async function avisarCambioInventario(admin: any, accountId: string): Promise<string[]> {
  try {
    const r = await sincronizarTikTok(admin, accountId, { soloPedidos: true, limiteMs: 120_000 });
    return r.avisos;
  } catch (err) {
    return [`TikTok: ${(err as Error).message}`];
  }
}

export interface ResultadoAccion {
  ok: true;
  estado: EstadoTienda;
  avisos: string[];
}

/** Envía un pedido pagado: salida en el kardex, salida al 3PL y se suelta el apartado. */
export async function enviarPedidoTienda(
  admin: any,
  accountId: string,
  id: number,
  datos: { guia: string; paqueteria: string },
  usuario: string | null,
): Promise<ResultadoAccion> {
  const guia = datos.guia.trim();
  if (!guia) throw new Error("Falta el número de guía.");
  const { pedido, items } = await cargarPedido(admin, accountId, id);
  if (pedido.estado !== "pagado") throw new Error(`El pedido ${pedido.folio} está «${NOMBRE_ESTADO[pedido.estado] ?? pedido.estado}»: solo se envía uno pagado.`);

  const pares = paresPorSku(items);
  const ahora = new Date().toISOString();
  // 1. Primero el kardex (baja el saldo) y DESPUÉS se suelta el apartado: al
  //    revés habría un momento en que el par se ofrece otra vez.
  await registrarMovimientos(
    admin,
    accountId,
    [...pares].map(([sku, cantidad]) => ({
      sku,
      tipo: "salida" as const,
      cantidad,
      referencia: pedido.folio,
      motivo: "Envío de la tienda en línea",
      fecha: ahora,
    })),
    usuario,
  );
  const { error: errorSalidas } = await admin.from("tiktok_salidas_3pl").upsert(
    [...pares].map(([sku, cantidad]) => ({ account_id: accountId, corte_id: null, order_id: pedido.folio, sku, pares: cantidad })),
    { onConflict: "account_id,order_id,sku", ignoreDuplicates: true },
  );
  if (errorSalidas) throw new Error(`tiktok_salidas_3pl: ${errorSalidas.message}`);

  const { error } = await admin
    .from("tienda_pedidos")
    .update({ estado: "enviado", guia, paqueteria: datos.paqueteria.trim() || null, enviado_en: ahora, actualizado_en: ahora })
    .eq("id", id)
    .eq("estado", "pagado");
  if (error) throw new Error(`No se pudo marcar enviado: ${error.message}`);
  await recalcularApartado(admin, accountId, [...pares.keys()]);

  const avisos: string[] = [];
  try {
    const r = await empujarSalidasAl3pl(admin, accountId);
    if (r.error) avisos.push(`3PL: ${r.error} (el cron lo reintenta)`);
  } catch (err) {
    avisos.push(`3PL: ${(err as Error).message} (el cron lo reintenta)`);
  }
  return { ok: true, estado: "enviado", avisos };
}

export async function marcarEntregado(admin: any, accountId: string, id: number): Promise<ResultadoAccion> {
  const { pedido } = await cargarPedido(admin, accountId, id);
  if (pedido.estado !== "enviado") throw new Error("Solo un pedido enviado se marca entregado.");
  await admin
    .from("tienda_pedidos")
    .update({ estado: "entregado", actualizado_en: new Date().toISOString() })
    .eq("id", id);
  return { ok: true, estado: "entregado", avisos: [] };
}

/** Devuelve el dinero en Mercado Pago (completo). Sin llave, se declara y se hace a mano. */
export async function reembolsarMercadoPago(pagoId: string, idempotencia: string): Promise<string | null> {
  const token = (process.env.MP_ACCESS_TOKEN ?? "").trim();
  if (!token) return "Falta MP_ACCESS_TOKEN en el ERP: devuelve el dinero a mano en Mercado Pago.";
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagoId)}/refunds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencia,
    },
    body: "{}",
  });
  if (res.ok) return null;
  const texto = await res.text().catch(() => "");
  return `Mercado Pago no devolvió el dinero (${res.status}): ${texto.slice(0, 200)}`;
}

/**
 * Cancela un pedido que no ha salido. Suelta su apartado y, si estaba
 * pagado, devuelve el dinero en Mercado Pago. Lo soltado se le publica a
 * TikTok (es causa de subida: `causasDeSubida`).
 */
export async function cancelarPedidoTienda(admin: any, accountId: string, id: number, nota: string | null): Promise<ResultadoAccion> {
  const { pedido, items } = await cargarPedido(admin, accountId, id);
  if (!["pendiente_pago", "pagado", "sin_stock"].includes(pedido.estado)) {
    throw new Error(`El pedido ${pedido.folio} ya está «${NOMBRE_ESTADO[pedido.estado] ?? pedido.estado}»: no se cancela.`);
  }
  const avisos: string[] = [];
  if ((pedido.estado === "pagado" || pedido.estado === "sin_stock") && pedido.mp_pago) {
    const fallo = await reembolsarMercadoPago(pedido.mp_pago, `reembolso-${pedido.folio}`);
    if (fallo) avisos.push(fallo);
  }
  const ahora = new Date().toISOString();
  const { error } = await admin
    .from("tienda_pedidos")
    .update({ estado: "cancelado", cancelado_en: ahora, actualizado_en: ahora, nota: nota?.trim() || null })
    .eq("id", id)
    .eq("estado", pedido.estado);
  if (error) throw new Error(`No se pudo cancelar: ${error.message}`);
  await recalcularApartado(admin, accountId, [...paresPorSku(items).keys()]);
  avisos.push(...(await avisarCambioInventario(admin, accountId)));
  return { ok: true, estado: "cancelado", avisos };
}

/** Caduca lo que no se pagó a tiempo (cron de TikTok). Devuelve cuántos SKUs se soltaron. */
export async function expirarPedidosTienda(admin: any, accountId: string): Promise<number> {
  const { data, error } = await admin.rpc("tienda_expirar", { p_account: accountId });
  if (error) throw new Error(`tienda_expirar: ${error.message}`);
  return Array.isArray(data) ? data.length : 0;
}
