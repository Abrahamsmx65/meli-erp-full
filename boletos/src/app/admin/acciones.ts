"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { liberarBoleto, usarBoleto } from "@/lib/boletos";
import { borrarTipo, guardarEvento, guardarTipo, type DatosEvento, type DatosTipo } from "@/lib/eventos";
import { cancelarPedido, confirmarPago, enviarBoletos, guardarNotas, reactivarPedido } from "@/lib/pedidos";
import { clienteServidor } from "@/lib/supabase/server";
import type { Escaneo } from "@/lib/tipos";

export interface Resultado {
  ok?: string;
  error?: string;
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : "Algo salió mal.";
}

export async function accionSalir(): Promise<void> {
  const supabase = await clienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function accionConfirmarPago(pedidoId: string): Promise<Resultado> {
  try {
    const admin = await exigirAdmin();
    await confirmarPago(pedidoId, admin.correo);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath("/admin");
  revalidatePath(`/admin/pedidos/${pedidoId}`);
  return { ok: "Pago confirmado. Los boletos se emitieron y se enviaron por correo." };
}

export async function accionReenviarBoletos(pedidoId: string): Promise<Resultado> {
  try {
    await exigirAdmin();
    const enviado = await enviarBoletos(pedidoId);
    if (!enviado) return { error: "No se pudo enviar el correo (¿está configurado Resend? ¿el pedido está pagado?)." };
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/admin/pedidos/${pedidoId}`);
  return { ok: "Boletos reenviados por correo." };
}

export async function accionCancelarPedido(pedidoId: string, notas: string): Promise<Resultado> {
  try {
    await exigirAdmin();
    await cancelarPedido(pedidoId, notas || null);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath("/admin");
  revalidatePath(`/admin/pedidos/${pedidoId}`);
  return { ok: "Pedido cancelado; sus boletos ya no entran." };
}

export async function accionReactivarPedido(pedidoId: string): Promise<Resultado> {
  try {
    await exigirAdmin();
    await reactivarPedido(pedidoId);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath("/admin");
  revalidatePath(`/admin/pedidos/${pedidoId}`);
  return { ok: "Pedido reactivado como pendiente de pago." };
}

export async function accionGuardarNotas(pedidoId: string, notas: string): Promise<Resultado> {
  try {
    await exigirAdmin();
    await guardarNotas(pedidoId, notas);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/admin/pedidos/${pedidoId}`);
  return { ok: "Notas guardadas." };
}

export async function accionEscanear(texto: string): Promise<Escaneo | { error: string }> {
  try {
    const admin = await exigirAdmin();
    return await usarBoleto(texto, admin.correo);
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export async function accionLiberarBoleto(boletoId: string): Promise<Resultado> {
  try {
    await exigirAdmin();
    await liberarBoleto(boletoId);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath("/admin/asistentes");
  return { ok: "El boleto vuelve a estar sin usar." };
}

function texto(form: FormData, campo: string): string | null {
  return String(form.get(campo) ?? "").trim() || null;
}

export async function accionGuardarEvento(id: string | null, form: FormData): Promise<Resultado> {
  const fechaLocal = String(form.get("fecha") ?? "");
  // El input datetime-local no trae zona: se interpreta en hora de México.
  const fecha = fechaLocal ? new Date(`${fechaLocal}:00-06:00`) : null;
  const montoDonativo = Number(form.get("donativo_monto") || 0);
  const datos: DatosEvento = {
    nombre: String(form.get("nombre") ?? "").trim(),
    descripcion: texto(form, "descripcion"),
    lugar: texto(form, "lugar"),
    fecha: fecha && !Number.isNaN(fecha.getTime()) ? fecha.toISOString() : "",
    capacidad: Number(form.get("capacidad")),
    maximo_por_pedido: Number(form.get("maximo_por_pedido") || 10),
    datos_transferencia: String(form.get("datos_transferencia") ?? "").trim(),
    activo: form.get("activo") === "on",
    imagen_url: texto(form, "imagen_url"),
    informes: texto(form, "informes"),
    donativo_nombre: montoDonativo > 0 ? texto(form, "donativo_nombre") ?? "Donativo" : null,
    donativo_monto: montoDonativo > 0 ? montoDonativo : null,
    donativo_descripcion: montoDonativo > 0 ? texto(form, "donativo_descripcion") : null,
  };
  if (!datos.nombre) return { error: "El evento necesita nombre." };
  if (!datos.fecha) return { error: "Captura la fecha del evento." };
  if (!(datos.capacidad > 0)) return { error: "La capacidad (límite de boletos) debe ser mayor a cero." };
  if (!(datos.maximo_por_pedido > 0)) return { error: "El máximo por pedido debe ser mayor a cero." };

  let nuevoId: string;
  try {
    await exigirAdmin();
    nuevoId = await guardarEvento(id, datos);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath("/admin/eventos");
  revalidatePath("/");
  redirect(`/admin/eventos/${nuevoId}?guardado=1`);
}

export async function accionGuardarTipo(eventoId: string, tipoId: string | null, form: FormData): Promise<Resultado> {
  const limite = Number(form.get("limite") || 0);
  const datos: DatosTipo = {
    nombre: String(form.get("nombre") ?? "").trim(),
    descripcion: texto(form, "descripcion"),
    precio: Number(form.get("precio")),
    limite: limite > 0 ? limite : null,
    orden: Number(form.get("orden") || 0),
    activo: form.get("activo") === "on",
  };
  if (!datos.nombre) return { error: "El tipo de boleto necesita nombre." };
  if (!(datos.precio >= 0)) return { error: "El precio no es válido." };
  try {
    await exigirAdmin();
    await guardarTipo(eventoId, tipoId, datos);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/admin/eventos/${eventoId}`);
  revalidatePath(`/evento/${eventoId}`);
  return { ok: "Tipo de boleto guardado." };
}

export async function accionBorrarTipo(eventoId: string, tipoId: string): Promise<Resultado> {
  let r: "borrado" | "desactivado";
  try {
    await exigirAdmin();
    r = await borrarTipo(tipoId);
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/admin/eventos/${eventoId}`);
  revalidatePath(`/evento/${eventoId}`);
  return { ok: r === "borrado" ? "Tipo de boleto eliminado." : "Ya tenía pedidos: se desactivó en vez de borrarse." };
}
