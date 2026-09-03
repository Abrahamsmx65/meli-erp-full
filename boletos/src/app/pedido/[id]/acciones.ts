"use server";

import { revalidatePath } from "next/cache";
import { avisarPago } from "@/lib/pedidos";

export interface EstadoAviso {
  error?: string;
  listo?: boolean;
}

export async function accionAvisarPago(_prev: EstadoAviso, form: FormData): Promise<EstadoAviso> {
  const id = String(form.get("pedido_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Pedido no válido." };
  const archivo = form.get("comprobante");
  try {
    await avisarPago(id, archivo instanceof File ? archivo : null);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo registrar el aviso." };
  }
  revalidatePath(`/pedido/${id}`);
  return { listo: true };
}
