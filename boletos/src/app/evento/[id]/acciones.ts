"use server";

import { redirect } from "next/navigation";
import { leerCarrito } from "@/lib/carrito";
import { obtenerEvento } from "@/lib/eventos";
import { crearPedido, esquemaComprador } from "@/lib/pedidos";

export interface EstadoFormulario {
  error?: string;
  campos?: Record<string, string>;
}

export async function accionCrearPedido(_prev: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const crudo = {
    evento_id: String(form.get("evento_id") ?? ""),
    nombre: String(form.get("nombre") ?? ""),
    correo: String(form.get("correo") ?? ""),
    telefono: String(form.get("telefono") ?? ""),
  };
  const campos: Record<string, string> = { ...crudo };
  for (const [k, v] of form.entries()) if (k.startsWith("tipo_") || k === "donativos") campos[k] = String(v);

  const r = esquemaComprador.safeParse(crudo);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los datos.", campos };

  const evento = await obtenerEvento(r.data.evento_id);
  if (!evento) return { error: "Ese evento ya no existe.", campos };
  const carrito = leerCarrito(form, evento.tipos);

  let pedidoId: string;
  try {
    const pedido = await crearPedido(r.data, carrito);
    pedidoId = pedido.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo registrar el pedido.", campos };
  }
  redirect(`/pedido/${pedidoId}?nuevo=1`);
}
