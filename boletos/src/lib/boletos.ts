import { extraerCodigo } from "./codigos";
import { clienteAdmin } from "./supabase/server";
import type { Boleto, Escaneo, Evento, Pedido } from "./tipos";

/** Escaneo en la puerta: marca el boleto como usado si procede. */
export async function usarBoleto(texto: string, usuario: string): Promise<Escaneo> {
  const codigo = extraerCodigo(texto);
  if (!codigo) {
    return {
      resultado: "no_existe",
      boleto_id: null, folio: null, nombre: null, correo: null,
      cantidad: null, evento: null, usado_en: null, usado_por: null,
    };
  }
  const { data, error } = await clienteAdmin().rpc("ev_usar_boleto", { p_codigo: codigo, p_usuario: usuario });
  if (error) throw error;
  const fila = (Array.isArray(data) ? data[0] : data) as Escaneo | undefined;
  if (!fila) throw new Error("La base no contestó.");
  return fila;
}

export interface BoletoCompleto {
  boleto: Boleto;
  pedido: Pedido;
  evento: Evento;
}

export async function obtenerBoleto(codigo: string): Promise<BoletoCompleto | null> {
  const c = extraerCodigo(codigo);
  if (!c) return null;
  const db = clienteAdmin();
  const { data: b } = await db.from("ev_boletos").select("*").eq("codigo", c).maybeSingle();
  if (!b) return null;
  const { data: p } = await db.from("ev_pedidos").select("*").eq("id", b.pedido_id).single();
  const { data: e } = await db.from("ev_eventos").select("*").eq("id", b.evento_id).single();
  return {
    boleto: b as Boleto,
    pedido: { ...(p as Pedido), total: Number(p!.total) },
    evento: { ...(e as Evento), precio: Number(e!.precio) },
  };
}

/** Deshace un escaneo (se escaneó por error). */
export async function liberarBoleto(boletoId: string): Promise<void> {
  const { error } = await clienteAdmin()
    .from("ev_boletos")
    .update({ estado: "valido", usado_en: null, usado_por: null })
    .eq("id", boletoId)
    .eq("estado", "usado");
  if (error) throw error;
}

export interface BoletoConPersona extends Boleto {
  nombre: string;
  correo: string;
  referencia: string;
  estado_pedido: string;
}

export async function listarBoletos(eventoId?: string, busqueda?: string): Promise<BoletoConPersona[]> {
  const db = clienteAdmin();
  let q = db
    .from("ev_boletos")
    .select("*, ev_pedidos!inner(nombre, correo, referencia, estado)")
    .order("folio", { ascending: true })
    .limit(2000);
  if (eventoId) q = q.eq("evento_id", eventoId);
  if (busqueda) {
    const t = busqueda.replace(/[%,()]/g, " ").trim();
    if (t) q = q.or(`nombre.ilike.%${t}%,correo.ilike.%${t}%,referencia.ilike.%${t}%`, { referencedTable: "ev_pedidos" });
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((fila) => {
    const { ev_pedidos, ...b } = fila as Boleto & {
      ev_pedidos: { nombre: string; correo: string; referencia: string; estado: string };
    };
    return { ...b, nombre: ev_pedidos.nombre, correo: ev_pedidos.correo, referencia: ev_pedidos.referencia, estado_pedido: ev_pedidos.estado };
  });
}

export interface EscaneoReciente {
  id: number;
  codigo: string;
  resultado: string;
  usuario: string | null;
  creado_en: string;
  folio: number | null;
  nombre: string | null;
}

export async function escaneosRecientes(limite = 30): Promise<EscaneoReciente[]> {
  const db = clienteAdmin();
  const { data } = await db
    .from("ev_escaneos")
    .select("id, codigo, resultado, usuario, creado_en, ev_boletos(folio, ev_pedidos(nombre))")
    .order("creado_en", { ascending: false })
    .limit(limite);
  return (data ?? []).map((f) => {
    const b = f.ev_boletos as unknown as { folio: number; ev_pedidos: { nombre: string } | null } | null;
    return {
      id: f.id, codigo: f.codigo, resultado: f.resultado, usuario: f.usuario, creado_en: f.creado_en,
      folio: b?.folio ?? null, nombre: b?.ev_pedidos?.nombre ?? null,
    };
  });
}
