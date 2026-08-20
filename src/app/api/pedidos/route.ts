import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { importarProforma } from "@/lib/importar/proforma";
import { guardarProforma, listarPedidos } from "@/lib/servicios/pedidos";
import { invalidar } from "@/lib/servicios/cache";
import { invalidarInventario } from "@/lib/servicios/inventario";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 8 * 1024 * 1024;

async function cuenta(req: NextRequest) {
  void req;
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No has iniciado sesión.", status: 401 as const };

  const c = await cuentaActiva(supabase);
  if (!c) return { error: "Conecta primero tu cuenta de Mercado Libre.", status: 400 as const };
  return { supabase, cuenta: c };
}

export async function GET(req: NextRequest) {
  const ctx = await cuenta(req);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const pedidos = await listarPedidos(ctx.supabase, ctx.cuenta.id);
  return NextResponse.json({ pedidos });
}

/**
 * Dos modos en una ruta:
 *
 *   accion=previsualizar -> lee el archivo y devuelve lo que VA a pasar, sin
 *                           guardar nada. Es la ventana de confirmación.
 *   accion=confirmar     -> guarda de verdad.
 *
 * Están separados a propósito: cargar un pedido da de alta corridas que el
 * planeador va a usar para decidir envíos. Eso no puede pasar por accidente
 * al soltar un archivo equivocado.
 */
export async function POST(req: NextRequest) {
  const ctx = await cuenta(req);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Se esperaba un archivo." }, { status: 400 });

  const archivo = form.get("archivo");
  const accion = String(form.get("accion") ?? "previsualizar");

  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo de la proforma." }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo pesa más de 8 MB." }, { status: 400 });
  }

  let proforma;
  try {
    const buffer = Buffer.from(await archivo.arrayBuffer());
    proforma = await importarProforma(buffer, { nombre: archivo.name });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Avisar si el pedido ya existe, ANTES de que confirme.
  const { data: yaExiste } = await ctx.supabase
    .from("pedidos")
    .select("id, estado")
    .eq("account_id", ctx.cuenta.id)
    .eq("pedido", proforma.pedido)
    .maybeSingle();

  if (accion === "previsualizar") {
    return NextResponse.json({
      ok: true,
      proforma,
      yaExiste: Boolean(yaExiste),
      archivo: archivo.name,
    });
  }

  if (yaExiste) {
    return NextResponse.json(
      { error: `El pedido ${proforma.pedido} ya está cargado.` },
      { status: 409 },
    );
  }

  try {
    const r = await guardarProforma(ctx.supabase, ctx.cuenta.id, proforma, {
      fechaPi: (form.get("fechaPi") as string) || null,
      notas: (form.get("notas") as string) || null,
      archivo: archivo.name,
    });

    // Las corridas nuevas cambian lo que el planeador puede armar.
    await invalidar(ctx.supabase, ctx.cuenta.id, "Se cargó un pedido nuevo con sus corridas.");

    return NextResponse.json({ ok: true, ...r, pedido: proforma.pedido });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await cuenta(req);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el id del pedido." }, { status: 400 });

  const { data: pedido } = await ctx.supabase
    .from("pedidos")
    .select("pedido")
    .eq("id", id)
    .eq("account_id", ctx.cuenta.id)
    .maybeSingle();

  const { error } = await ctx.supabase
    .from("pedidos")
    .delete()
    .eq("id", id)
    .eq("account_id", ctx.cuenta.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Las corridas se quedan: puede haber inventario viejo de ese pedido en
  // bodega que las siga necesitando para armar sus cajas.
  await invalidar(ctx.supabase, ctx.cuenta.id, "Se borró un pedido.");

  return NextResponse.json({ ok: true, pedido: pedido?.pedido });
}
