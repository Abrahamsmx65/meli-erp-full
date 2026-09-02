/**
 * El conteo cíclico contra la base: qué se puede contar y cómo se guarda.
 *
 * Guardar un conteo son dos cosas, en este orden y nunca al revés:
 *   1. los `ajuste` al kardex (el conteo siempre gana), con referencia
 *      `conteo:<fecha>` y constancia de los escaneos en la nota;
 *   2. publicar a TikTok el disponible nuevo — vía `sincronizarTikTok` con
 *      `soloPedidos`, que ANTES lee los pedidos recientes (regla de oro:
 *      nunca se le escribe a TikTok un número sin leer lo que acaba de
 *      vender). Si la publicación falla, el kardex ya quedó bien y el cron
 *      lo vuelve a intentar en 15 minutos.
 */
import { traerTodo, type DB } from "../datos/repos";
import { buscarAmazon, mapaAmazon } from "../etiquetas/resolver";
import { ajustesDeConteo, type ProductoConteo, type RenglonConteo } from "../tiktok/conteo";
import { registrarMovimientos, sincronizarTikTok } from "./tiktok";

/**
 * Todo lo que existe en el almacén de TikTok: lo que alguna vez se movió
 * (kardex) más lo que está publicado y amarrado al ERP, con su FNSKU de
 * Amazon para que el escáner lo reconozca.
 */
export async function catalogoParaConteo(db: DB, accountId: string): Promise<ProductoConteo[]> {
  const eq = (q: any) => q.eq("account_id", accountId);
  const [inventario, publicados, amazon] = await Promise.all([
    traerTodo<{ sku: string; saldo: number; apartado: number }>(db, "tiktok_inventario", "sku, saldo, apartado", eq),
    traerTodo<{ sku_interno: string | null; titulo: string | null }>(db, "tiktok_skus", "sku_interno, titulo", (q) =>
      eq(q).eq("activo", true).not("sku_interno", "is", null),
    ),
    mapaAmazon(db),
  ]);

  const porSku = new Map<string, ProductoConteo>();
  for (const r of inventario) {
    porSku.set(r.sku, { sku: r.sku, fnsku: buscarAmazon(amazon, r.sku)?.fnsku ?? null, saldo: r.saldo ?? 0, apartado: r.apartado ?? 0, titulo: null });
  }
  for (const p of publicados) {
    const sku = p.sku_interno as string;
    const ya = porSku.get(sku);
    if (ya) {
      if (!ya.titulo) ya.titulo = p.titulo;
      continue;
    }
    porSku.set(sku, { sku, fnsku: buscarAmazon(amazon, sku)?.fnsku ?? null, saldo: 0, apartado: 0, titulo: p.titulo });
  }
  return [...porSku.values()].sort((a, b) => a.sku.localeCompare(b.sku, "es", { numeric: true }));
}

export interface ResultadoConteo {
  fecha: string;
  ajustes: number;
  publicacion: { publicados: number; avisos: string[] } | { error: string } | null;
}

/**
 * Guarda el conteo: ajustes al kardex y publicación a TikTok. `renglones`
 * es lo que la pantalla enseñó y el usuario aceptó (contado vs saldo); se
 * vuelve a validar contra el catálogo real para que un SKU inventado no
 * abra un renglón fantasma.
 */
export async function guardarConteo(
  admin: any,
  accountId: string,
  renglones: RenglonConteo[],
  opciones: { usuario?: string | null; escaneos?: string[] } = {},
): Promise<ResultadoConteo> {
  const catalogo = await catalogoParaConteo(admin, accountId);
  const conocidos = new Map(catalogo.map((p) => [p.sku, p]));

  const desconocidos = renglones.filter((r) => !conocidos.has(r.sku)).map((r) => r.sku);
  if (desconocidos.length) {
    throw new Error(`Estos SKU no existen en el almacén de TikTok: ${desconocidos.join(", ")}.`);
  }

  // El saldo contra el que se compara es el de AHORA, no el que la pantalla
  // cargó hace un rato: si entre tanto se despachó un corte, la diferencia
  // real es otra. El contado es el dato del usuario; el saldo se refresca.
  const fecha = new Date().toISOString();
  const frescos: RenglonConteo[] = renglones.map((r) => {
    const p = conocidos.get(r.sku) as ProductoConteo;
    const contado = Math.max(0, Math.round(Number(r.contado) || 0));
    return { ...r, contado, saldo: p.saldo, apartado: p.apartado, diferencia: contado - p.saldo };
  });
  const ajustes = ajustesDeConteo(frescos, fecha);

  const constancia = (opciones.escaneos ?? []).slice(0, 400).join(" ");
  const registro = ajustes.length
    ? await registrarMovimientos(
        admin,
        accountId,
        ajustes.map((a) => ({ ...a, nota: constancia ? `${a.nota} Escaneos: ${constancia}` : a.nota })),
        opciones.usuario ?? null,
      )
    : { registrados: 0, skus: [] };

  let publicacion: ResultadoConteo["publicacion"] = null;
  if (registro.registrados > 0) {
    try {
      const r = await sincronizarTikTok(admin, accountId, { soloPedidos: true });
      publicacion = { publicados: r.publicados, avisos: r.avisos };
    } catch (err) {
      publicacion = { error: (err as Error).message };
    }
  }

  return { fecha, ajustes: registro.registrados, publicacion };
}

/** Lee del cuerpo del POST los renglones aceptados, con lo mínimo validado. */
export function renglonesDelCuerpo(body: any): RenglonConteo[] {
  const crudos = Array.isArray(body?.renglones) ? body.renglones : [];
  return crudos
    .map((r: any) => ({
      sku: String(r?.sku ?? "").trim(),
      fnsku: null,
      saldo: Number(r?.saldo) || 0,
      apartado: 0,
      contado: Math.max(0, Math.round(Number(r?.contado) || 0)),
      diferencia: 0,
      supuestoCero: Boolean(r?.supuestoCero),
    }))
    .filter((r: RenglonConteo) => r.sku)
    .slice(0, 2000);
}
