import { z } from "zod";
import { generarCodigoBoleto, generarReferencia, formatearFolio, urlBoleto } from "./codigos";
import { enviarCorreo, escapar, plantilla } from "./correo";
import { fechaLarga, pesos } from "./formato";
import { qrPng } from "./qr";
import { clienteAdmin } from "./supabase/server";
import type { Boleto, Evento, Pedido } from "./tipos";

export const esquemaPedido = z.object({
  evento_id: z.string().uuid(),
  nombre: z.string().trim().min(3, "Escribe tu nombre completo").max(120),
  correo: z.string().trim().toLowerCase().email("Correo no válido").max(200),
  telefono: z.string().trim().max(30).optional().or(z.literal("")),
  cantidad: z.coerce.number().int().min(1).max(50),
});

export type DatosPedido = z.infer<typeof esquemaPedido>;

const MENSAJES_RPC: Record<string, string> = {
  EVENTO_NO_EXISTE: "Ese evento ya no existe.",
  EVENTO_INACTIVO: "La venta de este evento está cerrada.",
  CANTIDAD_INVALIDA: "Esa cantidad de boletos no está permitida.",
  SIN_LUGARES: "Ya no hay suficientes lugares para esa cantidad.",
};

export function traducirErrorRpc(mensaje: string): string {
  for (const clave of Object.keys(MENSAJES_RPC)) {
    if (mensaje.includes(clave)) return MENSAJES_RPC[clave];
  }
  return "No se pudo registrar el pedido. Intenta de nuevo.";
}

function normalizarPedido(p: Record<string, unknown>): Pedido {
  return { ...(p as unknown as Pedido), total: Number(p.total) };
}

/**
 * Registra el pedido (la base cuida la capacidad) y manda el correo con
 * las instrucciones de transferencia.
 */
export async function crearPedido(datos: DatosPedido): Promise<Pedido> {
  const db = clienteAdmin();

  // La referencia es única: si por azar choca, se intenta otra.
  let pedido: Pedido | null = null;
  let ultimoError = "";
  for (let intento = 0; intento < 5 && !pedido; intento++) {
    const { data, error } = await db.rpc("ev_crear_pedido", {
      p_evento: datos.evento_id,
      p_referencia: generarReferencia(),
      p_nombre: datos.nombre,
      p_correo: datos.correo,
      p_telefono: datos.telefono || null,
      p_cantidad: datos.cantidad,
    });
    if (!error) {
      pedido = normalizarPedido(data as Record<string, unknown>);
      break;
    }
    ultimoError = error.message;
    // 23505 = referencia repetida: se genera otra y se reintenta.
    if (error.code !== "23505") throw new Error(traducirErrorRpc(error.message));
  }
  if (!pedido) throw new Error(traducirErrorRpc(ultimoError));

  const { data: evento } = await db.from("ev_eventos").select("*").eq("id", pedido.evento_id).single();
  if (evento) {
    await enviarCorreo({
      para: pedido.correo,
      copia: process.env.CORREO_ORGANIZADOR || undefined,
      asunto: `Tu pedido ${pedido.referencia} · ${evento.nombre}`,
      html: correoInstrucciones(pedido, { ...evento, precio: Number(evento.precio) }),
    });
  }
  return pedido;
}

export function correoInstrucciones(pedido: Pedido, evento: Evento): string {
  const base = (process.env.NEXT_PUBLIC_URL_BASE ?? "").replace(/\/+$/, "");
  const enlace = `${base}/pedido/${pedido.id}`;
  return plantilla(
    `Recibimos tu pedido, ${pedido.nombre.split(" ")[0]}`,
    `<p>Apartamos <strong>${pedido.cantidad} boleto${pedido.cantidad === 1 ? "" : "s"}</strong> para
      <strong>${escapar(evento.nombre)}</strong> (${escapar(fechaLarga(evento.fecha))}).</p>
     <p>Para confirmarlos, transfiere <strong>${pesos(pedido.total)}</strong> con esta referencia
      como concepto:</p>
     <p style="font-size:28px;letter-spacing:2px;text-align:center;background:#f4f1ea;padding:12px;border-radius:10px">
      <strong>${pedido.referencia}</strong></p>
     <pre style="white-space:pre-wrap;background:#f9f7f2;padding:12px;border-radius:10px;font-family:inherit">${escapar(evento.datos_transferencia)}</pre>
     <p>Cuando hayas transferido, entra aquí y avísanos (puedes subir tu comprobante):</p>
     <p style="text-align:center"><a href="${enlace}" style="display:inline-block;background:#1d6f63;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Ver mi pedido y avisar que pagué</a></p>
     <p style="color:#7a8589;font-size:13px">En cuanto confirmemos el pago te llegan tus boletos con código QR a este mismo correo.</p>`,
  );
}

export async function obtenerPedido(id: string): Promise<{ pedido: Pedido; evento: Evento; boletos: Boleto[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = clienteAdmin();
  const { data: p } = await db.from("ev_pedidos").select("*").eq("id", id).maybeSingle();
  if (!p) return null;
  const { data: e } = await db.from("ev_eventos").select("*").eq("id", p.evento_id).single();
  const { data: b } = await db.from("ev_boletos").select("*").eq("pedido_id", id).order("folio");
  return {
    pedido: normalizarPedido(p),
    evento: { ...(e as Evento), precio: Number(e!.precio) },
    boletos: (b ?? []) as Boleto[],
  };
}

const TIPOS_COMPROBANTE = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);
const MAX_COMPROBANTE = 8 * 1024 * 1024;

/** El comprador avisa que ya transfirió; el comprobante es opcional. */
export async function avisarPago(pedidoId: string, archivo: File | null): Promise<void> {
  const db = clienteAdmin();
  const { data: p } = await db.from("ev_pedidos").select("id, estado").eq("id", pedidoId).maybeSingle();
  if (!p) throw new Error("Pedido no encontrado.");
  if (p.estado === "cancelado") throw new Error("Este pedido está cancelado.");
  if (p.estado === "pagado") return;

  let ruta: string | null = null;
  if (archivo && archivo.size > 0) {
    if (archivo.size > MAX_COMPROBANTE) throw new Error("El comprobante pesa más de 8 MB.");
    if (!TIPOS_COMPROBANTE.has(archivo.type)) throw new Error("Sube una imagen (JPG, PNG) o un PDF.");
    const ext = archivo.type === "application/pdf" ? "pdf" : archivo.type.split("/")[1];
    ruta = `${pedidoId}/${Date.now()}.${ext}`;
    const { error } = await db.storage
      .from("ev-comprobantes")
      .upload(ruta, Buffer.from(await archivo.arrayBuffer()), { contentType: archivo.type, upsert: true });
    if (error) throw new Error("No se pudo guardar el comprobante.");
  }

  const cambios: Record<string, unknown> = { estado: "por_confirmar", aviso_pago_en: new Date().toISOString() };
  if (ruta) cambios.comprobante_ruta = ruta;
  const { error } = await db.from("ev_pedidos").update(cambios).eq("id", pedidoId);
  if (error) throw error;
}

export async function urlComprobante(ruta: string | null): Promise<string | null> {
  if (!ruta) return null;
  const { data } = await clienteAdmin().storage.from("ev-comprobantes").createSignedUrl(ruta, 60 * 30);
  return data?.signedUrl ?? null;
}

/**
 * El organizador confirma que llegó la transferencia: se emiten los
 * boletos (si no existían) y se mandan por correo con su QR.
 */
export async function confirmarPago(pedidoId: string, quien: string): Promise<void> {
  const db = clienteAdmin();
  const { data: p } = await db.from("ev_pedidos").select("*").eq("id", pedidoId).single();
  if (!p) throw new Error("Pedido no encontrado.");
  if (p.estado === "cancelado") throw new Error("El pedido está cancelado; reactívalo primero.");

  const { data: existentes } = await db.from("ev_boletos").select("id").eq("pedido_id", pedidoId);
  if (!existentes || existentes.length === 0) {
    const filas = Array.from({ length: p.cantidad }, () => ({
      pedido_id: p.id,
      evento_id: p.evento_id,
      codigo: generarCodigoBoleto(),
    }));
    const { error } = await db.from("ev_boletos").insert(filas);
    if (error) throw error;
  }

  if (p.estado !== "pagado") {
    const { error } = await db
      .from("ev_pedidos")
      .update({ estado: "pagado", pagado_en: new Date().toISOString(), confirmado_por: quien })
      .eq("id", pedidoId);
    if (error) throw error;
  }

  await enviarBoletos(pedidoId);
}

/** Manda (o re-manda) el correo con los boletos y sus QR. */
export async function enviarBoletos(pedidoId: string): Promise<boolean> {
  const datos = await obtenerPedido(pedidoId);
  if (!datos || datos.pedido.estado !== "pagado" || datos.boletos.length === 0) return false;
  const { pedido, evento, boletos } = datos;

  const adjuntos = await Promise.all(
    boletos.map(async (b) => ({
      filename: `boleto-${formatearFolio(b.folio).slice(1)}.png`,
      content: await qrPng(b.codigo),
    })),
  );

  const enviado = await enviarCorreo({
    para: pedido.correo,
    asunto: `Tus boletos para ${evento.nombre} · ${pedido.referencia}`,
    html: correoBoletos(pedido, evento, boletos),
    adjuntos,
  });

  if (enviado.enviado) {
    await clienteAdmin()
      .from("ev_pedidos")
      .update({ correo_enviado_en: new Date().toISOString() })
      .eq("id", pedidoId);
  }
  return enviado.enviado;
}

export function correoBoletos(pedido: Pedido, evento: Evento, boletos: Boleto[]): string {
  const base = (process.env.NEXT_PUBLIC_URL_BASE ?? "").replace(/\/+$/, "");
  const lista = boletos
    .map(
      (b) => `<div style="border:1px dashed #b9b2a3;border-radius:12px;padding:14px;margin:10px 0;text-align:center">
        <div style="font-size:13px;color:#7a8589">Boleto ${formatearFolio(b.folio)}</div>
        <img src="${base}/api/qr/${b.codigo}" width="220" height="220" alt="QR del boleto ${formatearFolio(b.folio)}" style="display:block;margin:8px auto"/>
        <div style="font-family:monospace;font-size:13px;letter-spacing:1px">${b.codigo}</div>
        <a href="${urlBoleto(b.codigo)}" style="color:#1d6f63;font-size:13px">Abrir boleto</a>
      </div>`,
    )
    .join("");
  return plantilla(
    `¡Listo, ${pedido.nombre.split(" ")[0]}! Aquí están tus boletos`,
    `<p><strong>${escapar(evento.nombre)}</strong><br/>${escapar(fechaLarga(evento.fecha))}${
      evento.lugar ? `<br/>${escapar(evento.lugar)}` : ""
    }</p>
     <p>Presenta el código QR en la entrada (desde el celular o impreso). Cada QR sirve para <strong>una persona</strong> y se invalida al escanearse.</p>
     ${lista}
     <p style="color:#7a8589;font-size:13px">Los QR también van adjuntos como imagen. Pedido ${pedido.referencia}.</p>`,
  );
}

export async function cancelarPedido(pedidoId: string, notas: string | null): Promise<void> {
  const db = clienteAdmin();
  const cambios: Record<string, unknown> = { estado: "cancelado", cancelado_en: new Date().toISOString() };
  if (notas) cambios.notas = notas;
  const { error } = await db.from("ev_pedidos").update(cambios).eq("id", pedidoId);
  if (error) throw error;
  await db.from("ev_boletos").update({ estado: "cancelado" }).eq("pedido_id", pedidoId).eq("estado", "valido");
}

export async function reactivarPedido(pedidoId: string): Promise<void> {
  const db = clienteAdmin();
  const { error } = await db
    .from("ev_pedidos")
    .update({ estado: "pendiente", cancelado_en: null })
    .eq("id", pedidoId)
    .eq("estado", "cancelado");
  if (error) throw error;
  await db.from("ev_boletos").update({ estado: "valido" }).eq("pedido_id", pedidoId).eq("estado", "cancelado");
}

export async function guardarNotas(pedidoId: string, notas: string): Promise<void> {
  const { error } = await clienteAdmin().from("ev_pedidos").update({ notas: notas || null }).eq("id", pedidoId);
  if (error) throw error;
}

export interface FiltroPedidos {
  evento_id?: string;
  estado?: string;
  busqueda?: string;
}

export async function listarPedidos(filtro: FiltroPedidos): Promise<Pedido[]> {
  const db = clienteAdmin();
  let q = db.from("ev_pedidos").select("*").order("creado_en", { ascending: false }).limit(500);
  if (filtro.evento_id) q = q.eq("evento_id", filtro.evento_id);
  if (filtro.estado) q = q.eq("estado", filtro.estado);
  if (filtro.busqueda) {
    const t = filtro.busqueda.replace(/[%,()]/g, " ").trim();
    if (t) q = q.or(`nombre.ilike.%${t}%,correo.ilike.%${t}%,referencia.ilike.%${t}%,telefono.ilike.%${t}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(normalizarPedido);
}

export interface ResumenPedidos {
  total: number;
  pendientes: number;
  porConfirmar: number;
  pagados: number;
  cancelados: number;
  boletosPagados: number;
  boletosUsados: number;
  dinero: number;
}

export function resumir(pedidos: Pedido[], boletos: Pick<Boleto, "estado" | "pedido_id">[]): ResumenPedidos {
  const pagados = pedidos.filter((p) => p.estado === "pagado");
  const idsPagados = new Set(pagados.map((p) => p.id));
  return {
    total: pedidos.length,
    pendientes: pedidos.filter((p) => p.estado === "pendiente").length,
    porConfirmar: pedidos.filter((p) => p.estado === "por_confirmar").length,
    pagados: pagados.length,
    cancelados: pedidos.filter((p) => p.estado === "cancelado").length,
    boletosPagados: pagados.reduce((s, p) => s + p.cantidad, 0),
    boletosUsados: boletos.filter((b) => b.estado === "usado" && idsPagados.has(b.pedido_id)).length,
    dinero: pagados.reduce((s, p) => s + p.total, 0),
  };
}
