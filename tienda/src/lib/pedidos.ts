import "server-only";
import { config } from "./config";
import { avisarErp } from "./erp";
import { enviarCorreo, escapar } from "./correo";
import { db } from "./db";
import { leerPago, type PagoMP } from "./mercadopago";
import { pagoCuadra, pesos, type EstadoPedido } from "./tienda";

export interface PedidoCliente {
  id: number;
  folio: string;
  estado: EstadoPedido;
  email: string;
  nombre: string;
  telefono: string | null;
  direccion: Record<string, string>;
  subtotal: number;
  envio: number;
  total: number;
  token: string;
  mpPreferencia: string | null;
  guia: string | null;
  paqueteria: string | null;
  creadoEn: string;
  expiraEn: string | null;
  items: { titulo: string | null; color: string | null; talla: string | null; cantidad: number; precio: number; imagen: string | null }[];
}

const COLUMNAS =
  "id, folio, estado, email, nombre, telefono, direccion, subtotal, envio, total, token_publico, mp_preferencia, guia, paqueteria, creado_en, expira_en, pago_estado";

function aPedido(p: any, items: any[]): PedidoCliente {
  return {
    id: Number(p.id),
    folio: p.folio,
    estado: p.estado,
    email: p.email,
    nombre: p.nombre,
    telefono: p.telefono,
    direccion: p.direccion ?? {},
    subtotal: Number(p.subtotal),
    envio: Number(p.envio),
    total: Number(p.total),
    token: p.token_publico,
    mpPreferencia: p.mp_preferencia,
    guia: p.guia,
    paqueteria: p.paqueteria,
    creadoEn: p.creado_en,
    expiraEn: p.expira_en,
    items: items.map((i) => ({
      titulo: i.titulo,
      color: i.color,
      talla: i.talla,
      cantidad: Number(i.cantidad),
      precio: Number(i.precio),
      imagen: i.imagen,
    })),
  };
}

export async function pedidoPorFolio(folio: string): Promise<PedidoCliente | null> {
  const { data: p } = await db()
    .from("tienda_pedidos")
    .select(COLUMNAS)
    .eq("account_id", config.cuenta())
    .eq("folio", folio.toUpperCase())
    .maybeSingle();
  if (!p) return null;
  const { data: items } = await db()
    .from("tienda_pedido_items")
    .select("titulo, color, talla, cantidad, precio, imagen")
    .eq("pedido_id", (p as any).id)
    .order("id");
  return aPedido(p, items ?? []);
}

export async function pedidosDeCliente(clienteId: string, email: string): Promise<PedidoCliente[]> {
  const { data } = await db()
    .from("tienda_pedidos")
    .select(COLUMNAS)
    .eq("account_id", config.cuenta())
    .or(`cliente_id.eq.${clienteId},email.eq."${email.replace(/"/g, "")}"`)
    .order("id", { ascending: false })
    .limit(50);
  const pedidos = data ?? [];
  if (!pedidos.length) return [];
  const { data: items } = await db()
    .from("tienda_pedido_items")
    .select("pedido_id, titulo, color, talla, cantidad, precio, imagen")
    .in("pedido_id", pedidos.map((p: any) => p.id))
    .order("id");
  return pedidos.map((p: any) => aPedido(p, (items ?? []).filter((i: any) => i.pedido_id === p.id)));
}

/**
 * Lee el pago en Mercado Pago y lo aplica al pedido. Lo usan el aviso de
 * MP y la página de regreso (por si el aviso tarda). El pago tiene que ser
 * de ESTE pedido y cubrir su total; si no, no se toca nada.
 */
export async function aplicarPago(pagoId: string): Promise<{ estado: string | null; aviso?: string }> {
  let pago: PagoMP;
  try {
    pago = await leerPago(pagoId);
  } catch (err) {
    return { estado: null, aviso: (err as Error).message };
  }
  const pedidoId = Number(pago.external_reference);
  if (!Number.isFinite(pedidoId)) return { estado: null, aviso: "pago sin pedido" };
  const { data: pedido } = await db()
    .from("tienda_pedidos")
    .select("id, folio, total, estado, email, nombre, token_publico, account_id")
    .eq("id", pedidoId)
    .maybeSingle();
  if (!pedido || (pedido as any).account_id !== config.cuenta()) return { estado: null, aviso: "pedido ajeno" };
  if (pago.status === "approved" && !pagoCuadra(pago, { id: pedido.id, total: Number(pedido.total) })) {
    return { estado: pedido.estado, aviso: "el pago no cubre el total del pedido" };
  }

  const { data: r, error } = await db().rpc("tienda_marcar_pago", {
    p_pedido: pedido.id,
    p_estado_mp: pago.status,
    p_pago: String(pago.id),
    p_detalle: {
      status_detail: pago.status_detail ?? null,
      metodo: pago.payment_method_id ?? null,
      tipo: pago.payment_type_id ?? null,
      monto: pago.transaction_amount ?? null,
      aprobado: pago.date_approved ?? null,
    },
  });
  if (error) return { estado: pedido.estado, aviso: error.message };
  const res = r as { antes: string; estado: string };
  if (res.antes !== res.estado) {
    await avisarErp(`pago ${pago.status} ${pedido.folio}`);
    if (res.estado === "pagado") {
      await enviarCorreo(
        pedido.email,
        `Recibimos tu pago · pedido ${pedido.folio}`,
        `<p>Hola ${escapar(pedido.nombre)}:</p><p>Recibimos el pago de tu pedido <b>${pedido.folio}</b> por ${pesos(Number(pedido.total))}. ` +
          `Ya lo estamos preparando; cuando salga te mandamos la guía.</p>` +
          `<p><a href="${config.urlTienda()}/pedido/${pedido.folio}?t=${pedido.token_publico}">Ver mi pedido</a></p><p>GETAC</p>`,
      );
    }
  }
  return { estado: res.estado };
}
