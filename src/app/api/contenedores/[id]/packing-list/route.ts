import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import {
  armarPackingListContenedor,
  excelPackingListContenedor,
  type DatosModelo,
  type RenglonContenedor,
} from "@/lib/servicios/packing-list-contenedor";
import { configPorProducto } from "@/lib/servicios/productos";

export const dynamic = "force-dynamic";

/**
 * Packing list del contenedor para el agente aduanal (formato del dueño,
 * 18-sep-2026): LOTE PEDIDO | MODELO | COLOR | SKU | PARES | CAJAS | LARGO |
 * ALTO | ANCHO | PESO | PRECIO | NOMBRE | CODIGO FISCAL. Las medidas y el
 * peso vienen del packing list de la fábrica guardado en `contenedor_lineas`;
 * el precio de la caja es costo por par × pares; el código fiscal sale de la
 * categoría de MELI del modelo. El armado vive en
 * `servicios/packing-list-contenedor.ts`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  const { data: contenedor } = await supabase
    .from("contenedores")
    .select("id, numero, numero_naviera")
    .eq("id", id)
    .eq("account_id", cuenta.id)
    .maybeSingle();
  if (!contenedor) return NextResponse.json({ error: "Contenedor no encontrado." }, { status: 404 });

  const { data: cls } = await supabase
    .from("contenedor_lineas")
    .select("cajas, pedido_linea_id, largo_cm, ancho_cm, alto_cm, peso_kg")
    .eq("contenedor_id", contenedor.id);

  if (!cls?.length) {
    return NextResponse.json(
      { error: "El contenedor no tiene cajas asignadas todavía." },
      { status: 400 },
    );
  }

  const { data: lineas } = await supabase
    .from("pedido_lineas")
    .select("id, pedido_id, modelo, color, talla, pares_por_caja")
    .in("id", [...new Set(cls.map((x) => x.pedido_linea_id))]);
  const porId = new Map((lineas ?? []).map((l) => [l.id, l]));

  const { data: pedidos } = await supabase
    .from("pedidos")
    .select("id, pedido")
    .in("id", [...new Set((lineas ?? []).map((l) => l.pedido_id))]);
  const pedidoDe = new Map((pedidos ?? []).map((p) => [p.id, p.pedido as string]));

  const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
  const renglones: RenglonContenedor[] = [];
  for (const cl of cls) {
    const l = porId.get(cl.pedido_linea_id);
    if (!l) continue;
    renglones.push({
      pedido: pedidoDe.get(l.pedido_id) ?? "",
      modelo: (l.modelo ?? "").toUpperCase(),
      color: (l.color ?? "").toUpperCase(),
      talla: l.talla ?? "",
      paresPorCaja: l.pares_por_caja ?? 0,
      cajas: cl.cajas ?? 0,
      largoCm: num(cl.largo_cm),
      anchoCm: num(cl.ancho_cm),
      altoCm: num(cl.alto_cm),
      pesoKg: num(cl.peso_kg),
    });
  }

  const modelos = await datosDeModelos(supabase, cuenta.id, [...new Set(renglones.map((r) => r.modelo))]);
  const packing = armarPackingListContenedor(renglones, modelos);
  const buffer = await excelPackingListContenedor(contenedor.numero, contenedor.numero_naviera ?? null, packing);

  const nombre = `packing-list-${contenedor.numero.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Por modelo: el título de la publicación, la categoría de MELI con más
 * publicaciones (un modelo trae casi todas sus tallas en la misma) y el
 * costo por par de Productos y costos.
 */
async function datosDeModelos(
  db: Awaited<ReturnType<typeof clienteServidor>>,
  accountId: string,
  modelos: string[],
): Promise<Map<string, DatosModelo>> {
  const salida = new Map<string, DatosModelo>();
  if (!modelos.length) return salida;

  const skus = await traerTodo<{ sku: string; modelo: string | null; titulo: string | null; categoria_id: string | null }>(
    db,
    "skus",
    "sku, modelo, titulo, categoria_id",
    (q) => q.eq("account_id", accountId).eq("activo", true).in("modelo", modelos),
  );

  // Un modelo con guion (GT104-1) queda mal partido en skus.modelo: se
  // rescata por el prefijo del SKU completo.
  const conocidos = new Set(skus.map((s) => (s.modelo ?? "").toUpperCase()));
  for (const m of modelos.filter((x) => !conocidos.has(x))) {
    const extra = await traerTodo<{ sku: string; modelo: string | null; titulo: string | null; categoria_id: string | null }>(
      db,
      "skus",
      "sku, modelo, titulo, categoria_id",
      (q) => q.eq("account_id", accountId).eq("activo", true).ilike("sku", `${m}-%`),
    );
    for (const s of extra) skus.push({ ...s, modelo: m });
  }

  const idsCat = [...new Set(skus.map((s) => s.categoria_id).filter((c): c is string => Boolean(c)))];
  const { data: cats } = idsCat.length
    ? await db.from("categorias_meli").select("id, nombre").in("id", idsCat)
    : { data: [] as { id: string; nombre: string }[] };
  const nombreCat = new Map((cats ?? []).map((c) => [c.id, c.nombre as string]));

  const porModelo = new Map<string, { titulo: string | null; categorias: Map<string, number> }>();
  for (const s of skus) {
    const m = (s.modelo ?? "").toUpperCase();
    if (!m) continue;
    const p = porModelo.get(m) ?? { titulo: null, categorias: new Map<string, number>() };
    if (!p.titulo && s.titulo) p.titulo = s.titulo;
    if (s.categoria_id) {
      const n = nombreCat.get(s.categoria_id);
      if (n) p.categorias.set(n, (p.categorias.get(n) ?? 0) + 1);
    }
    porModelo.set(m, p);
  }

  const config = await configPorProducto(db, accountId);
  for (const m of modelos) {
    const p = porModelo.get(m);
    const categoria = p ? [...p.categorias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null;
    const c = config.get(m) ?? config.get(m.toUpperCase());
    salida.set(m, { titulo: p?.titulo ?? null, categoriaMeli: categoria, costoMxn: c?.costo ?? null });
  }
  return salida;
}
