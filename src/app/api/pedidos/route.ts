import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { importarProforma, type Proforma } from "@/lib/importar/proforma";
import { guardarProforma, listarPedidos } from "@/lib/servicios/pedidos";
import { invalidar } from "@/lib/servicios/cache";
import { invalidarInventario } from "@/lib/servicios/inventario";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 8 * 1024 * 1024;

/** Ajustes por renglón que el usuario hace en la ventana de confirmación. */
interface OverrideLinea {
  indice: number;
  /**
   * El renglón es de cajas completas por color-modelo: el número que trae el
   * archivo son CAJAS, no pares. Se convierte con los pares por caja de su
   * propia corrida.
   */
  esCajaCompleta?: boolean;
  modelo?: string;
  color?: string;
}

/**
 * Aplica los ajustes ANTES de guardar. El archivo se relee tal cual en cada
 * paso, así que los ajustes viajan con la confirmación y se aplican aquí,
 * del lado del servidor, sobre los mismos datos que se van a guardar.
 */
function aplicarOverrides(proforma: Proforma, overrides: OverrideLinea[]) {
  for (const o of overrides) {
    const l = proforma.lineas[o.indice];
    if (!l) continue;
    if (typeof o.modelo === "string" && o.modelo.trim()) {
      l.modelo = o.modelo.trim().toUpperCase();
    }
    if (typeof o.color === "string" && o.color.trim()) {
      l.color = o.color.trim().toUpperCase();
      l.colorCrudo = o.color.trim();
    }
    if (o.esCajaCompleta) {
      const cajas = l.cajas > 0 ? l.cajas : l.pares;
      l.cajas = cajas;
      l.pares = cajas * l.paresPorCaja;
    }
  }
  // Los totales de cajas y pares se recalculan; el importe NO: es el que
  // dice la Proforma Invoice y es lo que de verdad se paga.
  proforma.totales.cajas = proforma.lineas.reduce((a, l) => a + l.cajas, 0);
  proforma.totales.pares = proforma.lineas.reduce((a, l) => a + l.pares, 0);
}

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

    const crudo = form.get("overrides");
    if (typeof crudo === "string" && crudo) {
      const overrides = JSON.parse(crudo) as OverrideLinea[];
      if (!Array.isArray(overrides)) throw new Error("Los ajustes de renglones vienen mal formados.");
      aplicarOverrides(proforma, overrides);
    }
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
    invalidarInventario(ctx.cuenta.id);
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
  invalidarInventario(ctx.cuenta.id);
  await invalidar(ctx.supabase, ctx.cuenta.id, "Se borró un pedido.");

  return NextResponse.json({ ok: true, pedido: pedido?.pedido });
}
