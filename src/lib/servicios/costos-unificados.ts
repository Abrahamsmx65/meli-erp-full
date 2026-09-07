/**
 * Costos unificados: Productos y costos (productos_config) es LA fuente del
 * costo de todo lo que se vende, sea calzado o funda, en MELI o en Amazon.
 *
 * Decisión del dueño: un solo lugar para capturar precios. Antes las fundas
 * tenían su Excel aparte (yz_costos) y el calzado que se vende en la cuenta
 * de fundas o las fundas que se venden en Amazon se quedaban sin costo.
 *
 * El amarre de un SKU a su renglón de costo va por niveles:
 *   1. la clave canónica completa (380-CHICO, para los diseños con variante)
 *   2. el modelo de calzado (GT114-NEGRO-25 → GT114; G650-BLK-26-MX → G650)
 *   3. el diseño de funda (499-IP15PM → 499; N-462-A06 → 462; 499N → 499)
 * y yz_costos sigue de respaldo por si algo no se copió todavía.
 */
import { type DB } from "../datos/repos";
import { desglosar as desglosarFunda, claveCanonica, esCalzado } from "../yapanizcel/sku";
import { todo } from "../yapanizcel/db";
import { configPorProducto, type ConfigProducto } from "./productos";
import { desglosarSku } from "./sync";

export type MapaCostos = Map<string, ConfigProducto>;

/** La cuenta de MELI de calzado (la primera): ahí vive productos_config. */
export async function cuentaCalzadoId(db: DB): Promise<string | null> {
  const { data } = await db.from("meli_accounts").select("id").order("creado_en", { ascending: true }).limit(1).maybeSingle();
  return data?.id ?? null;
}

async function cuentaFundasId(db: DB): Promise<string | null> {
  const { data } = await db.from("yz_cuentas").select("id").order("creado_en", { ascending: true }).limit(1).maybeSingle();
  return data?.id ?? null;
}

/**
 * Modelo unificado de un SKU: el modelo de calzado si lo es, y si no, el
 * diseño de la funda. "437-RmPad-2-navy" → 437; "GT114-NEGRO-25" → GT114;
 * "N-462-A06" → 462; "glass-A53" → GLASS.
 */
export function modeloUnificado(sku: string): string {
  const s = String(sku ?? "").trim();
  if (!s) return "";
  const calzado = (desglosarSku(s).modelo ?? s).toUpperCase();
  // Un modelo que empieza con número, o que es un prefijo suelto de una o
  // dos letras (N-462…), no es calzado: es un diseño de funda.
  if (/^\d/.test(calzado) || /^[A-Z]{1,2}$/.test(calzado)) {
    const d = desglosarFunda(s).diseno;
    return (d || calzado).toUpperCase();
  }
  return calzado;
}

/** La configuración (costo y categoría) de un SKU, o null si no hay. */
export function configDeSku(sku: string, mapa: MapaCostos): ConfigProducto | null {
  const s = String(sku ?? "").trim();
  if (!s) return null;
  const completa = mapa.get(claveCanonica(s).toUpperCase());
  if (completa) return completa;
  const modelo = modeloUnificado(s);
  const porModelo = mapa.get(modelo);
  if (porModelo) return porModelo;
  const d = desglosarFunda(s).diseno.toUpperCase();
  if (d && d !== modelo) {
    const porDiseno = mapa.get(d);
    if (porDiseno) return porDiseno;
  }
  // La N o la C de más también se cuela en el Excel de costos: "499N".
  const sinLetra = d.replace(/[A-Z]$/, "");
  if (sinLetra && sinLetra !== d) {
    const v = mapa.get(sinLetra);
    if (v) return v;
  }
  return null;
}

export function costoDeSkuUnificado(sku: string, mapa: MapaCostos): number | null {
  return configDeSku(sku, mapa)?.costo ?? null;
}

/**
 * El mapa de costos y categorías por modelo/diseño: productos_config de la
 * cuenta de calzado, y de respaldo yz_costos de la cuenta de fundas (solo
 * para lo que aún no esté en productos_config).
 */
export async function mapaCostosUnificado(
  db: DB,
  opts?: { meliAccountId?: string | null; yzAccountId?: string | null },
): Promise<MapaCostos> {
  const [meliId, yzId] = await Promise.all([
    opts?.meliAccountId ?? cuentaCalzadoId(db),
    opts?.yzAccountId ?? cuentaFundasId(db),
  ]);
  const [config, yz] = await Promise.all([
    meliId ? configPorProducto(db, meliId) : Promise.resolve(new Map<string, ConfigProducto>()),
    yzId
      ? todo<{ modelo: string; costo: number }>(db, "yz_costos", "modelo, costo", (q) => q.eq("account_id", yzId)).catch(
          () => [] as { modelo: string; costo: number }[],
        )
      : Promise.resolve([] as { modelo: string; costo: number }[]),
  ]);
  const mapa: MapaCostos = new Map();
  for (const [modelo, cfg] of config) mapa.set(modelo.toUpperCase(), cfg);
  for (const c of yz) {
    const k = String(c.modelo).toUpperCase();
    const existente = mapa.get(k);
    if (existente?.costo != null) continue;
    const costo = Number(c.costo);
    if (!Number.isFinite(costo) || costo <= 0) continue;
    mapa.set(k, { categoria: existente?.categoria ?? "Fundas", costo });
  }
  return mapa;
}

/** Solo los costos, como los usa el ERP de fundas (costoDeSku). */
export function soloCostos(mapa: MapaCostos): Map<string, number> {
  const m = new Map<string, number>();
  for (const [k, cfg] of mapa) if (cfg.costo != null) m.set(k, cfg.costo);
  return m;
}

/** Los diseños de fundas que son calzado no se listan dos veces. */
export { esCalzado };
