import { clienteAdmin } from "./supabase/server";
import type { Evento } from "./tipos";

export interface EventoConCupo extends Evento {
  ocupados: number;
  disponibles: number;
  pagados: number;
}

function normalizar(e: Record<string, unknown>): Evento {
  return { ...(e as unknown as Evento), precio: Number(e.precio) };
}

export async function listarEventos(soloActivos: boolean): Promise<EventoConCupo[]> {
  const db = clienteAdmin();
  let q = db.from("ev_eventos").select("*").order("fecha", { ascending: true });
  if (soloActivos) q = q.eq("activo", true);
  const { data: eventos, error } = await q;
  if (error) throw error;

  const { data: pedidos } = await db
    .from("ev_pedidos")
    .select("evento_id, cantidad, estado")
    .neq("estado", "cancelado");

  return (eventos ?? []).map((raw) => {
    const e = normalizar(raw);
    const mios = (pedidos ?? []).filter((p) => p.evento_id === e.id);
    const ocupados = mios.reduce((s, p) => s + p.cantidad, 0);
    const pagados = mios.filter((p) => p.estado === "pagado").reduce((s, p) => s + p.cantidad, 0);
    return { ...e, ocupados, pagados, disponibles: Math.max(0, e.capacidad - ocupados) };
  });
}

export async function obtenerEvento(id: string): Promise<EventoConCupo | null> {
  const todos = await listarEventos(false);
  return todos.find((e) => e.id === id) ?? null;
}

export interface DatosEvento {
  nombre: string;
  descripcion: string | null;
  lugar: string | null;
  fecha: string;
  precio: number;
  capacidad: number;
  maximo_por_pedido: number;
  datos_transferencia: string;
  activo: boolean;
}

export async function guardarEvento(id: string | null, datos: DatosEvento): Promise<string> {
  const db = clienteAdmin();
  if (id) {
    const { error } = await db.from("ev_eventos").update(datos).eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await db.from("ev_eventos").insert(datos).select("id").single();
  if (error) throw error;
  return data.id as string;
}
