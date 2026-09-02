"use server";

import { redirect } from "next/navigation";
import { crearPedido, esquemaPedido } from "@/lib/pedidos";

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
    cantidad: String(form.get("cantidad") ?? "1"),
  };
  const r = esquemaPedido.safeParse(crudo);
  if (!r.success) {
    return { error: r.error.issues[0]?.message ?? "Revisa los datos.", campos: crudo };
  }
  let pedidoId: string;
  try {
    const pedido = await crearPedido(r.data);
    pedidoId = pedido.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo registrar el pedido.", campos: crudo };
  }
  redirect(`/pedido/${pedidoId}?nuevo=1`);
}
