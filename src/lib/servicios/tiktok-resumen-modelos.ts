/**
 * El Excel por MODELO del almacén TikTok (pedido del dueño, 2-oct-2026):
 * modelo, foto, categoría, ID del producto en TikTok con su estado, stock
 * en la bodega TikTok (kardex), stock en cada bodega de cajas (Industher,
 * Caseshop, EnvioPack…) y las ventas de MELI de toda la historia. El motor
 * puro está en `tiktok/resumen-modelos.ts`; aquí se lee la base y se arma el
 * archivo. La foto es la primera del producto en TikTok (copiada en
 * `tienda_productos`) y, si el modelo no está en TikTok, la de Amazon
 * (`amazon_padres` por el ASIN de `amazon_listings`); se incrusta en la
 * celda y la URL va aparte por si la descarga falla.
 */

import ExcelJS from "exceljs";
import { traerTodo, type DB } from "../datos/repos";
import { sumarDias } from "../engine/fechas";
import {
  armarResumenModelos,
  modeloDeSku,
  nombreEstadoTikTok,
  type ExistenciaResumen,
  type ResumenModelos,
  type VentaMeliResumen,
} from "../tiktok/resumen-modelos";
import { fechaMx } from "./ventas-monitor";

const DIAS_RECIENTES = 30;
const MS_POR_FOTO = 10_000;
const FOTOS_A_LA_VEZ = 6;
const LADO_FOTO = 72;

export interface ResumenModelosCargado extends ResumenModelos {
  hoy: string;
  avisos: string[];
}

export async function cargarResumenModelos(db: DB, accountId: string): Promise<ResumenModelosCargado> {
  const eq = (q: any) => q.eq("account_id", accountId);
  const hoy = fechaMx();
  const avisos: string[] = [];

  const [tiktokRaw, kardexRaw, existRaw, configRaw, tiendaRaw, ventasR] = await Promise.all([
    traerTodo<any>(db, "tiktok_skus", "seller_sku, sku_interno, product_id, estado, titulo", (q) => eq(q).eq("activo", true)),
    traerTodo<any>(db, "tiktok_inventario", "sku, saldo, apartado, apartado_web", eq),
    traerTodo<any>(db, "existencias", "almacen, modelo, cajas_disponibles, pares_por_caja", eq),
    traerTodo<any>(db, "productos_config", "modelo, categoria", eq),
    traerTodo<any>(db, "tienda_productos", "modelo, product_id, imagenes, activo", eq),
    db.rpc("ventas_resumen_sku", {
      p_account: accountId,
      p_desde: "2020-01-01",
      p_hasta: hoy,
      p_prev_desde: sumarDias(hoy, -(DIAS_RECIENTES - 1)),
      p_prev_hasta: hoy,
      p_hoy: hoy,
    }),
  ]);

  const ventasMeli: VentaMeliResumen[] = [];
  if (ventasR.error) {
    avisos.push(`Las ventas de MELI no se pudieron leer (${ventasR.error.message}); la columna va vacía.`);
  } else {
    for (const f of (ventasR.data ?? []) as any[]) {
      ventasMeli.push({
        sku: String(f.sku ?? ""),
        unidades: Number(f.unidades) || 0,
        ordenes: Number(f.ordenes) || 0,
        unidades30: Number(f.unidades_prev) || 0,
      });
    }
  }

  const existencias: ExistenciaResumen[] = (existRaw ?? [])
    .filter((x: any) => String(x.almacen ?? "").trim().toUpperCase() !== "TIKTOK")
    .map((x: any) => ({
      almacen: String(x.almacen ?? "").trim(),
      modelo: String(x.modelo ?? ""),
      pares: (Number(x.cajas_disponibles) || 0) * (Number(x.pares_por_caja) || 0),
    }));

  const categorias = new Map<string, string>();
  for (const c of configRaw ?? []) {
    const modelo = String(c.modelo ?? "").trim().toUpperCase();
    if (modelo && c.categoria && !categorias.has(modelo)) categorias.set(modelo, String(c.categoria));
  }

  // Foto: la del producto de TikTok (activo primero), si no la de Amazon.
  const fotos = new Map<string, string>();
  const tienda = [...(tiendaRaw ?? [])].sort((a: any, b: any) => Number(Boolean(b.activo)) - Number(Boolean(a.activo)));
  for (const t of tienda) {
    const modelo = String(t.modelo ?? "").trim().toUpperCase();
    const primera = Array.isArray(t.imagenes) ? t.imagenes.find((u: unknown) => typeof u === "string" && u.startsWith("http")) : null;
    if (modelo && primera && !fotos.has(modelo)) fotos.set(modelo, primera);
  }
  try {
    const [listings, padres] = await Promise.all([
      traerTodo<any>(db, "amazon_listings", "seller_sku, asin", (q) => q.not("asin", "is", null)),
      traerTodo<any>(db, "amazon_padres", "asin, imagen_url", (q) => q.not("imagen_url", "is", null)),
    ]);
    const porAsin = new Map<string, string>();
    for (const p of padres ?? []) if (p.asin && p.imagen_url) porAsin.set(String(p.asin), String(p.imagen_url));
    for (const l of listings ?? []) {
      const modelo = modeloDeSku(String(l.seller_sku ?? ""));
      const url = l.asin ? porAsin.get(String(l.asin)) : null;
      if (modelo && url && !fotos.has(modelo)) fotos.set(modelo, url);
    }
  } catch (err) {
    avisos.push(`Las fotos de Amazon no se pudieron leer (${(err as Error).message}).`);
  }

  const resumen = armarResumenModelos({
    tiktok: (tiktokRaw ?? []).map((s: any) => ({
      sku: String(s.sku_interno || s.seller_sku || ""),
      productId: s.product_id ? String(s.product_id) : null,
      estado: s.estado ? String(s.estado) : null,
      titulo: s.titulo ? String(s.titulo) : null,
    })),
    kardex: (kardexRaw ?? []).map((k: any) => ({
      sku: String(k.sku ?? ""),
      saldo: Number(k.saldo) || 0,
      apartado: (Number(k.apartado) || 0) + (Number(k.apartado_web) || 0),
    })),
    existencias,
    ventasMeli,
    categorias,
    fotos,
  });
  return { ...resumen, hoy, avisos };
}

/** Baja una foto (JPG/PNG); lo que no sea imagen cuenta como fallida. */
async function bajarFoto(url: string): Promise<{ buffer: Buffer; extension: "jpeg" | "png" } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(MS_POR_FOTO) });
    if (!r.ok) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    const esJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const esPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    if (!esJpg && !esPng) return null;
    return { buffer: bytes, extension: esPng ? "png" : "jpeg" };
  } catch {
    return null;
  }
}

async function bajarFotos(urls: string[]): Promise<Map<string, { buffer: Buffer; extension: "jpeg" | "png" }>> {
  const salida = new Map<string, { buffer: Buffer; extension: "jpeg" | "png" }>();
  const cola = [...new Set(urls)];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(FOTOS_A_LA_VEZ, cola.length) }, async () => {
      while (i < cola.length) {
        const url = cola[i++];
        const foto = await bajarFoto(url);
        if (foto) salida.set(url, foto);
      }
    }),
  );
  return salida;
}

/**
 * El Excel: una hoja «Por modelo» con la foto incrustada, y una hoja
 * «Avisos» si algo no se pudo leer. Números como números para filtrar y
 * sumar; los IDs de TikTok como texto (Excel los redondea si son número).
 */
export async function excelResumenModelos(r: ResumenModelosCargado): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";
  wb.created = new Date();

  const hoja = wb.addWorksheet("Por modelo");
  const columnas: { header: string; key: string; width: number }[] = [
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Foto", key: "foto", width: 12 },
    { header: "Categoría", key: "categoria", width: 18 },
    { header: "Título en TikTok", key: "titulo", width: 44 },
    { header: "ID producto TikTok", key: "productId", width: 22 },
    { header: "Estado en TikTok", key: "estado", width: 16 },
    { header: "Otros productos TikTok", key: "otros", width: 30 },
    { header: "Bodega TikTok (saldo)", key: "saldoTikTok", width: 14 },
    { header: "Apartado TikTok", key: "apartadoTikTok", width: 13 },
    { header: "Disponible TikTok", key: "disponibleTikTok", width: 14 },
    ...r.almacenes.map((a) => ({ header: `Pares en ${a}`, key: `bodega_${a}`, width: 15 })),
    { header: "Total bodegas de cajas", key: "totalBodegas", width: 16 },
    { header: "Ventas MELI (pares, total)", key: "ventasMeli", width: 18 },
    { header: "Órdenes MELI (total)", key: "ordenesMeli", width: 16 },
    { header: `Ventas MELI ${DIAS_RECIENTES} días`, key: "ventasMeli30", width: 16 },
    { header: "URL de la foto", key: "fotoUrl", width: 40 },
  ];
  hoja.columns = columnas;
  hoja.getRow(1).font = { bold: true };
  hoja.getRow(1).alignment = { vertical: "middle", wrapText: true };
  hoja.getRow(1).height = 30;
  hoja.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };

  const fotos = await bajarFotos(r.renglones.map((x) => x.foto).filter((u): u is string => Boolean(u)));
  const colFoto = columnas.findIndex((c) => c.key === "foto");

  for (const x of r.renglones) {
    const principal = x.productos[0] ?? null;
    const otros = x.productos
      .slice(1)
      .map((p) => `${p.productId} (${nombreEstadoTikTok(p.estado)})`)
      .join(", ");
    const fila: Record<string, unknown> = {
      modelo: x.modelo,
      foto: x.foto ? (fotos.has(x.foto) ? "" : "sin bajar") : "sin foto",
      categoria: x.categoria ?? "",
      titulo: x.titulo ?? "",
      productId: principal?.productId ?? "",
      estado: principal ? nombreEstadoTikTok(principal.estado) : "no está en TikTok",
      otros,
      saldoTikTok: x.saldoTikTok,
      apartadoTikTok: x.apartadoTikTok,
      disponibleTikTok: x.disponibleTikTok,
      totalBodegas: x.totalBodegas,
      ventasMeli: x.ventasMeli,
      ordenesMeli: x.ordenesMeli,
      ventasMeli30: x.ventasMeli30,
      fotoUrl: x.foto ?? "",
    };
    for (const a of r.almacenes) fila[`bodega_${a}`] = x.porBodega[a] ?? 0;
    const row = hoja.addRow(fila);
    row.alignment = { vertical: "middle" };
    row.getCell("titulo").alignment = { vertical: "middle", wrapText: true };
    row.getCell("productId").numFmt = "@";
    if (x.foto) {
      row.getCell("fotoUrl").value = { text: x.foto, hyperlink: x.foto };
      const foto = fotos.get(x.foto);
      if (foto) {
        row.height = LADO_FOTO * 0.75 + 6;
        const id = wb.addImage({ buffer: foto.buffer as any, extension: foto.extension });
        hoja.addImage(id, {
          tl: { col: colFoto + 0.1, row: row.number - 1 + 0.08 },
          ext: { width: LADO_FOTO, height: LADO_FOTO },
          editAs: "oneCell",
        });
      }
    }
  }
  hoja.getColumn("foto").width = LADO_FOTO / 7 + 1;
  hoja.getColumn("disponibleTikTok").font = { bold: true };
  hoja.getColumn("totalBodegas").font = { bold: true };

  const total = hoja.addRow({
    modelo: "TOTAL",
    saldoTikTok: r.renglones.reduce((s, x) => s + x.saldoTikTok, 0),
    apartadoTikTok: r.renglones.reduce((s, x) => s + x.apartadoTikTok, 0),
    disponibleTikTok: r.renglones.reduce((s, x) => s + x.disponibleTikTok, 0),
    totalBodegas: r.renglones.reduce((s, x) => s + x.totalBodegas, 0),
    ventasMeli: r.renglones.reduce((s, x) => s + x.ventasMeli, 0),
    ordenesMeli: r.renglones.reduce((s, x) => s + x.ordenesMeli, 0),
    ventasMeli30: r.renglones.reduce((s, x) => s + x.ventasMeli30, 0),
    ...Object.fromEntries(r.almacenes.map((a) => [`bodega_${a}`, r.renglones.reduce((s, x) => s + (x.porBodega[a] ?? 0), 0)])),
  });
  total.font = { bold: true };

  const notas = wb.addWorksheet("Notas");
  notas.columns = [{ header: "Nota", key: "nota", width: 110 }];
  notas.getRow(1).font = { bold: true };
  const lineas = [
    `Generado el ${r.hoy} (hora de México). Un renglón por modelo: los que están en TikTok (catálogo o kardex) o tienen pares en alguna bodega de cajas.`,
    "«ID producto TikTok» es el producto activo si lo hay; los demás productos del modelo (borradores, desactivados, borrados) van en «Otros productos TikTok».",
    "«Bodega TikTok» es el kardex del ERP (saldo), lo apartado por pedidos sin despachar y el disponible = saldo − apartado.",
    "Los pares por bodega son cajas DISPONIBLES × pares por caja de la última foto de Industher; la bodega TikTok de Industher no se cuenta ahí (ya va en el kardex).",
    `Las ventas de MELI son de toda la historia registrada (y los últimos ${DIAS_RECIENTES} días aparte), sumadas por modelo con el SKU de MELI.`,
    "La foto es la primera del producto en TikTok; si el modelo no está en TikTok, la de Amazon. «sin bajar» = la URL existe pero no se pudo descargar al armar el archivo.",
    ...r.avisos,
  ];
  for (const l of lineas) notas.addRow({ nota: l });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
