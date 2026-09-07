import { clienteAdmin } from "./supabase/server";
import type { Evento, TipoBoleto } from "./tipos";

export interface TipoConCupo extends TipoBoleto {
  ocupados: number;
  /** null = sin límite propio (solo el del evento). */
  disponibles: number | null;
}

export interface EventoConCupo extends Evento {
  ocupados: number;
  disponibles: number;
  pagados: number;
  tipos: TipoConCupo[];
}

function normalizarEvento(e: Record<string, unknown>): Evento {
  return {
    ...(e as unknown as Evento),
    precio: Number(e.precio ?? 0),
    donativo_monto: e.donativo_monto == null ? null : Number(e.donativo_monto),
  };
}

function normalizarTipo(t: Record<string, unknown>): TipoBoleto {
  return { ...(t as unknown as TipoBoleto), precio: Number(t.precio) };
}

export async function listarEventos(soloActivos: boolean): Promise<EventoConCupo[]> {
  const db = clienteAdmin();
  let q = db.from("ev_eventos").select("*").order("fecha", { ascending: true });
  if (soloActivos) q = q.eq("activo", true);
  const { data: eventos, error } = await q;
  if (error) throw error;

  const [{ data: pedidos }, { data: tipos }, { data: renglones }] = await Promise.all([
    db.from("ev_pedidos").select("id, evento_id, cantidad, estado").neq("estado", "cancelado"),
    db.from("ev_tipos_boleto").select("*").order("orden").order("creado_en"),
    db.from("ev_pedido_renglones").select("tipo_id, cantidad, ev_pedidos!inner(estado)").neq("ev_pedidos.estado", "cancelado"),
  ]);

  const porTipo = new Map<string, number>();
  for (const r of renglones ?? []) porTipo.set(r.tipo_id, (porTipo.get(r.tipo_id) ?? 0) + r.cantidad);

  return (eventos ?? []).map((raw) => {
    const e = normalizarEvento(raw);
    const mios = (pedidos ?? []).filter((p) => p.evento_id === e.id);
    const ocupados = mios.reduce((s, p) => s + p.cantidad, 0);
    const pagados = mios.filter((p) => p.estado === "pagado").reduce((s, p) => s + p.cantidad, 0);
    const disponibles = Math.max(0, e.capacidad - ocupados);
    const tiposDelEvento = (tipos ?? [])
      .filter((t) => t.evento_id === e.id)
      .map((raw) => {
        const t = normalizarTipo(raw);
        const oc = porTipo.get(t.id) ?? 0;
        return { ...t, ocupados: oc, disponibles: t.limite == null ? null : Math.max(0, t.limite - oc) };
      });
    return { ...e, ocupados, pagados, disponibles, tipos: tiposDelEvento };
  });
}

export async function obtenerEvento(id: string): Promise<EventoConCupo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const todos = await listarEventos(false);
  return todos.find((e) => e.id === id) ?? null;
}

export interface DatosEvento {
  nombre: string;
  descripcion: string | null;
  lugar: string | null;
  fecha: string;
  capacidad: number;
  maximo_por_pedido: number;
  datos_transferencia: string;
  activo: boolean;
  imagen_url: string | null;
  informes: string | null;
  donativo_nombre: string | null;
  donativo_monto: number | null;
  donativo_descripcion: string | null;
}

export async function guardarEvento(id: string | null, datos: DatosEvento): Promise<string> {
  const db = clienteAdmin();
  if (id) {
    const { error } = await db.from("ev_eventos").update(datos).eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await db.from("ev_eventos").insert({ ...datos, precio: 0 }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export interface DatosTipo {
  nombre: string;
  descripcion: string | null;
  precio: number;
  limite: number | null;
  orden: number;
  activo: boolean;
}

export async function guardarTipo(eventoId: string, tipoId: string | null, datos: DatosTipo): Promise<void> {
  const db = clienteAdmin();
  if (tipoId) {
    const { error } = await db.from("ev_tipos_boleto").update(datos).eq("id", tipoId).eq("evento_id", eventoId);
    if (error) throw error;
  } else {
    const { error } = await db.from("ev_tipos_boleto").insert({ ...datos, evento_id: eventoId });
    if (error) throw error;
  }
}

/** Solo se borra un tipo que nadie ha pedido; si ya tiene pedidos, se desactiva. */
export async function borrarTipo(tipoId: string): Promise<"borrado" | "desactivado"> {
  const db = clienteAdmin();
  const { count } = await db.from("ev_pedido_renglones").select("id", { count: "exact", head: true }).eq("tipo_id", tipoId);
  if (count && count > 0) {
    const { error } = await db.from("ev_tipos_boleto").update({ activo: false }).eq("id", tipoId);
    if (error) throw error;
    return "desactivado";
  }
  const { error } = await db.from("ev_tipos_boleto").delete().eq("id", tipoId);
  if (error) throw error;
  return "borrado";
}
