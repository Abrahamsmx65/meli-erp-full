import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import {
  actualizarBorrador,
  confirmarBorrador,
  crearBorradores,
  descartarBorrador,
  guardarAjustes,
  leerAjustes,
  listarBorradores,
  mandarCorreo,
  opcionesDeFabrica,
  siguienteIn,
} from "@/lib/servicios/pedidos-borradores";
import { invalidar } from "@/lib/servicios/cache";
import { invalidarInventario } from "@/lib/servicios/inventario";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function contexto() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No has iniciado sesión.", status: 401 as const };
  const c = await cuentaActiva(supabase);
  if (!c) return { error: "Conecta primero tu cuenta de Mercado Libre.", status: 400 as const };
  return { supabase, cuenta: c };
}

/** Borradores, ajustes (correos y último IN) y las fábricas para elegir. */
export async function GET() {
  const ctx = await contexto();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const [borradores, ajustes, fabricas, siguiente] = await Promise.all([
    listarBorradores(ctx.supabase, ctx.cuenta.id),
    leerAjustes(ctx.supabase, ctx.cuenta.id),
    opcionesDeFabrica(ctx.supabase, ctx.cuenta.id),
    siguienteIn(ctx.supabase, ctx.cuenta.id),
  ]);
  return NextResponse.json({ borradores, ajustes, fabricas, siguiente });
}

/**
 * accion = armar       { texto }                      -> un borrador por modelo
 *          actualizar  { id, fabrica?, moneda?, descripcion?, lineas? }
 *          descartar   { id }
 *          confirmar   { id }                         -> pedido + correo
 *          correo      { id }                         -> reenviar el correo
 *          ajustes     { destinatarios?, ultimoIn? }
 */
export async function POST(req: NextRequest) {
  const ctx = await contexto();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const cuerpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!cuerpo) return NextResponse.json({ error: "Se esperaba JSON." }, { status: 400 });
  const { supabase, cuenta } = ctx;
  const id = typeof cuerpo.id === "string" ? cuerpo.id : "";

  try {
    switch (cuerpo.accion) {
      case "armar": {
        const texto = String(cuerpo.texto ?? "");
        if (!texto.trim()) return NextResponse.json({ error: "Pega la lista del pedido." }, { status: 400 });
        if (texto.length > 50_000) return NextResponse.json({ error: "La lista es demasiado larga." }, { status: 400 });
        return NextResponse.json({ ok: true, ...(await crearBorradores(supabase, cuenta.id, texto)) });
      }
      case "actualizar":
        return NextResponse.json({
          ok: true,
          borrador: await actualizarBorrador(supabase, cuenta.id, id, {
            fabrica: cuerpo.fabrica as string | null | undefined,
            moneda: cuerpo.moneda as "USD" | "RMB" | null | undefined,
            descripcion: cuerpo.descripcion as string | undefined,
            lineas: cuerpo.lineas,
          }),
        });
      case "descartar":
        await descartarBorrador(supabase, cuenta.id, id);
        return NextResponse.json({ ok: true });
      case "confirmar": {
        const borrador = await confirmarBorrador(supabase, cuenta.id, id);
        // Ya cuenta como en camino: inventario y plan se recalculan.
        invalidarInventario(cuenta.id);
        await invalidar(supabase, cuenta.id, `Se confirmó el pedido ${borrador.pedido} desde Nuevo pedido.`);
        return NextResponse.json({ ok: true, borrador });
      }
      case "correo":
        return NextResponse.json({ ok: true, borrador: await mandarCorreo(supabase, cuenta.id, id) });
      case "ajustes":
        return NextResponse.json({
          ok: true,
          ajustes: await guardarAjustes(supabase, cuenta.id, {
            destinatarios: Array.isArray(cuerpo.destinatarios) ? (cuerpo.destinatarios as unknown[]).map(String) : undefined,
            ultimoIn: cuerpo.ultimoIn == null ? undefined : Number(cuerpo.ultimoIn),
          }),
        });
      default:
        return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
