/**
 * Lo que se lee de la base para los archivos de un contenedor: el packing
 * list del agente aduanal y los dos archivos de la bodega (PRODUCTOS y
 * PACKING LIST). Un solo lugar para los dos, así dicen lo mismo.
 */
import { porTandas, traerTodo, type DB } from "../datos/repos";
import { numeroDeEmbarque } from "./drive-packing";
import { codigoDeCaja } from "./bodega-contenedor";
import type { DatosModelo, RenglonContenedor } from "./packing-list-contenedor";
import { configPorProducto } from "./productos";
import { amarreDeLineas } from "./amarre-pedido";
import type { RenglonBodega } from "./bodega-contenedor";

export interface ContenedorBasico {
  id: string;
  numero: string;
  numero_naviera: string | null;
  creado_en: string | null;
}

export async function contenedorDeCuenta(db: DB, accountId: string, id: string): Promise<ContenedorBasico | null> {
  const { data } = await db
    .from("contenedores")
    .select("id, numero, numero_naviera, creado_en")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  return (data as ContenedorBasico | null) ?? null;
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

/** Un renglón por línea del contenedor, con su pedido, color, talla, pares y medidas de la caja. */
export async function renglonesDelContenedor(db: DB, contenedorId: string): Promise<RenglonContenedor[]> {
  const { data: cls } = await db
    .from("contenedor_lineas")
    .select("cajas, pedido_linea_id, largo_cm, ancho_cm, alto_cm, peso_kg")
    .eq("contenedor_id", contenedorId);
  if (!cls?.length) return [];

  const { data: lineas } = await db
    .from("pedido_lineas")
    .select("id, pedido_id, modelo, color, talla, pares_por_caja")
    .in("id", [...new Set(cls.map((x: any) => x.pedido_linea_id))]);
  const porId = new Map((lineas ?? []).map((l: any) => [l.id, l]));

  const { data: pedidos } = await db
    .from("pedidos")
    .select("id, pedido")
    .in("id", [...new Set((lineas ?? []).map((l: any) => l.pedido_id))]);
  const pedidoDe = new Map((pedidos ?? []).map((p: any) => [p.id, p.pedido as string]));

  const renglones: RenglonContenedor[] = [];
  for (const cl of cls as any[]) {
    const l: any = porId.get(cl.pedido_linea_id);
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
  return renglones;
}

/**
 * Medidas de la caja que faltan en este contenedor (se cargó sin el packing
 * list de la fábrica, como el S259): se toman de otro contenedor con el
 * MISMO modelo y los mismos pares por caja. Nunca se inventan.
 */
export async function completarMedidas<T extends RenglonContenedor>(db: DB, renglones: T[]): Promise<T[]> {
  const faltan = renglones.filter((r) => r.largoCm == null || r.pesoKg == null);
  if (!faltan.length) return renglones;
  const modelos = [...new Set(faltan.map((r) => r.modelo))];
  const lineas = await traerTodo<{ id: string; modelo: string; pares_por_caja: number | null }>(db, "pedido_lineas", "id, modelo, pares_por_caja", (q) =>
    q.in("modelo", modelos).order("id", { ascending: true }),
  );
  const claveDe = new Map(lineas.map((l) => [l.id, `${(l.modelo ?? "").toUpperCase()}|${l.pares_por_caja ?? 0}`]));
  const medidas = await porTandas(
    lineas.map((l) => l.id),
    300,
    (tanda) =>
      traerTodo<{ pedido_linea_id: string; largo_cm: number | null; ancho_cm: number | null; alto_cm: number | null; peso_kg: number | null }>(
        db,
        "contenedor_lineas",
        "pedido_linea_id, largo_cm, ancho_cm, alto_cm, peso_kg",
        (q) => q.in("pedido_linea_id", tanda).not("largo_cm", "is", null),
      ),
  );
  const porClave = new Map<string, { largo: number | null; ancho: number | null; alto: number | null; peso: number | null }>();
  for (const m of medidas) {
    const k = claveDe.get(m.pedido_linea_id);
    if (k && !porClave.has(k)) porClave.set(k, { largo: num(m.largo_cm), ancho: num(m.ancho_cm), alto: num(m.alto_cm), peso: num(m.peso_kg) });
  }
  return renglones.map((r) => {
    if (r.largoCm != null && r.pesoKg != null) return r;
    const m = porClave.get(`${r.modelo}|${r.paresPorCaja}`);
    if (!m) return r;
    return {
      ...r,
      largoCm: r.largoCm ?? m.largo,
      anchoCm: r.anchoCm ?? m.ancho,
      altoCm: r.altoCm ?? m.alto,
      pesoKg: r.pesoKg ?? m.peso,
    };
  });
}

/**
 * Los SKU de etiqueta de los contenedores ANTERIORES a este (embarque de
 * número menor; sin número, los creados antes): esos productos ya se dieron
 * de alta en la bodega.
 */
export async function skusDeContenedoresAnteriores(db: DB, accountId: string, actual: ContenedorBasico): Promise<Set<string>> {
  const { data: conts } = await db.from("contenedores").select("id, numero, creado_en").eq("account_id", accountId);
  const embarque = numeroDeEmbarque(actual.numero);
  const anteriores = ((conts ?? []) as { id: string; numero: string; creado_en: string | null }[]).filter((c) => {
    if (c.id === actual.id) return false;
    const n = numeroDeEmbarque(c.numero);
    if (embarque != null && n != null) return n < embarque;
    return (c.creado_en ?? "") < (actual.creado_en ?? "");
  });
  const salida = new Set<string>();
  for (const c of anteriores) {
    for (const r of await renglonesDelContenedor(db, c.id)) {
      if (r.cajas > 0) salida.add(codigoDeCaja(r.pedido, r.modelo, r.color, r.talla));
    }
  }
  return salida;
}

/**
 * Por modelo: el título de la publicación, la categoría de MELI con más
 * publicaciones (un modelo trae casi todas sus tallas en la misma) y el
 * costo por par de Productos y costos.
 */
export async function datosDeModelos(db: DB, accountId: string, modelos: string[]): Promise<Map<string, DatosModelo>> {
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
  const nombreCat = new Map(((cats ?? []) as { id: string; nombre: string }[]).map((c) => [c.id, c.nombre]));

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
    const categoria = p ? ([...p.categorias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) : null;
    const c = config.get(m) ?? config.get(m.toUpperCase());
    salida.set(m, { titulo: p?.titulo ?? null, categoriaMeli: categoria, costoMxn: c?.costo ?? null });
  }
  return salida;
}

/**
 * A cada renglón le pone el SKU de MELI de su modelo y color (con su talla si
 * la caja es de una sola), con el mismo amarre que avisa los colores
 * fantasma (amarres a mano incluidos). Sin variante en MELI queda en null.
 */
export async function conSkusMeli(db: DB, accountId: string, renglones: RenglonContenedor[]): Promise<RenglonBodega[]> {
  const amarres = await amarreDeLineas(
    db,
    accountId,
    renglones.map((r) => ({ modelo: r.modelo, color: r.color, talla: r.talla || null })),
  ).catch(() => [] as Awaited<ReturnType<typeof amarreDeLineas>>);
  return renglones.map((r, i) => ({ ...r, skuMeli: amarres[i]?.estado === "ligado" ? amarres[i].skuMeli : null }));
}
