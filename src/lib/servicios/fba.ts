import type { RenglonAmazon } from "./amazon";
import { desglosarSku } from "./sync";
import { claveAplastada, claveComparacion } from "../importar/sku";
import { claveOrdenada, type IndiceCatalogo } from "../etiquetas/resolver";
import { numeroDePedido } from "./compras";


/**
 * Clave de grupo modelo|color APLANADA: "GREY/BLK", "GREY-BLK" y "GREY BLK"
 * son el mismo color escrito por tres manos distintas (proforma, MELI,
 * Amazon). Sin aplanar, la corrida no se encontraba y salía "sin corrida:
 * no sé cuántas cajas son".
 */
export function claveGrupoFba(modelo: string, color: string): string {
  const m = (modelo ?? "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
  const c = (color ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${m}|${c}`;
}

/**
 * Desglose que entiende los SKUs de Amazon: a veces traen la talla ANTES
 * del color (GT128-23-BLK-MX). Si el desglose normal no encuentra talla,
 * se busca el token que parece talla en cualquier posición.
 */
function desglosarAmazon(sku: string): { modelo: string | null; color: string | null; talla: string | null } {
  const d = desglosarSku(sku);
  if (d.talla) return d;
  const t = claveComparacion(sku).split("-");
  const idx = t.findIndex((x, i) => i > 0 && /^\d{1,2}(\.\d)?$/.test(x));
  if (idx > 0) {
    return {
      modelo: t[0] ?? null,
      color: t.filter((_, i) => i > 0 && i !== idx).join("-") || null,
      talla: t[idx],
    };
  }
  return d;
}
import { traerTodo, type DB } from "../datos/repos";

/** Días de venta que el stock en FBA debe cubrir. */
export const OBJETIVO_DIAS_FBA = 30;

/** Con menos de esto de cobertura, el envío ya es urgente. */
export const URGENTE_DIAS_FBA = 14;

/**
 * Solo el calzado viaja a FBA en cajas: lo demás que viva en la cuenta de
 * Amazon (fundas, micas…) no entra a esta planeación.
 */
const PREFIJOS_CALZADO = ["GT", "MY", "YH", "G650"];

export function esCalzado(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  return PREFIJOS_CALZADO.some((p) => s.startsWith(p));
}

export interface SugerenciaFba {
  modelo: string;
  color: string;
  producto: string;
  titulo: string | null;
  tallas: number;
  ventaDiaria: number;
  disponible: number;
  enTransferencia: number;
  cobertura: number | null;
  faltantePares: number;
  paresPorCaja: number | null;
  /** cajas completas a mandar; 0 cuando no hay corrida conocida */
  cajas: number;
  /** pares que viajan = cajas × pares por caja (o el faltante, sin corrida) */
  pares: number;
  tieneCorrida: boolean;
}

/**
 * Qué mandar a FBA, en CAJAS COMPLETAS por modelo + color.
 *
 * La misma regla que los envíos a Full: las cajas no se abren. Al ritmo de
 * venta del periodo se calcula el faltante por talla (venta del objetivo
 * menos lo que hay más lo que viaja), se suma por color y se redondea hacia
 * arriba a cajas completas usando la corrida del modelo. Los SKUs que no son
 * calzado (no empiezan con GT, MY, YH o G650) quedan fuera.
 */
export function sugerirEnvioFba(
  renglones: RenglonAmazon[],
  dias: number,
  corridas: Map<string, number>,
  objetivoDias = OBJETIVO_DIAS_FBA,
  indiceMeli?: IndiceCatalogo,
): SugerenciaFba[] {
  interface Grupo {
    modelo: string;
    color: string;
    titulo: string | null;
    tallas: number;
    ventaDiaria: number;
    disponible: number;
    enTransferencia: number;
    faltante: number;
  }
  const grupos = new Map<string, Grupo>();

  for (const r of renglones) {
    if (!esCalzado(r.sku)) continue;
    // Primero el catálogo real de MELI (sabe modelo, color y talla de cada
    // SKU, venga como venga escrito el de Amazon); el desglose por guiones
    // queda de respaldo para lo que no esté publicado en MELI.
    const enCatalogo =
      indiceMeli?.canonico.get(claveComparacion(r.sku)) ??
      indiceMeli?.aplastado.get(claveAplastada(r.sku)) ??
      indiceMeli?.ordenado.get(claveOrdenada(r.sku));
    const d = enCatalogo?.modelo
      ? { modelo: enCatalogo.modelo, color: enCatalogo.color ?? "", talla: enCatalogo.talla ?? "" }
      : desglosarAmazon(r.sku);
    const modelo = (d.modelo ?? r.sku).toUpperCase();
    const color = (d.color ?? "").toUpperCase();
    const clave = claveGrupoFba(modelo, color);

    const g =
      grupos.get(clave) ??
      { modelo, color, titulo: r.titulo, tallas: 0, ventaDiaria: 0, disponible: 0, enTransferencia: 0, faltante: 0 };

    const ventaDiaria = r.unidades / dias;
    const posicion = r.disponible + r.enTransferencia;
    g.tallas += 1;
    g.ventaDiaria += ventaDiaria;
    g.disponible += r.disponible;
    g.enTransferencia += r.enTransferencia;
    // El faltante se calcula POR TALLA y luego se suma: el sobrante de una
    // talla no tapa el hueco de otra.
    g.faltante += Math.max(0, ventaDiaria * objetivoDias - posicion);
    if (!g.titulo && r.titulo) g.titulo = r.titulo;
    grupos.set(clave, g);
  }

  return [...grupos.values()]
    .filter((g) => g.ventaDiaria > 0 && g.faltante >= 1)
    .map((g) => {
      const posicion = g.disponible + g.enTransferencia;
      const cobertura = g.ventaDiaria > 0 ? posicion / g.ventaDiaria : null;
      const paresPorCaja = corridas.get(claveGrupoFba(g.modelo, g.color)) ?? null;
      const cajas = paresPorCaja ? Math.ceil(g.faltante / paresPorCaja) : 0;
      return {
        modelo: g.modelo,
        color: g.color,
        producto: `${g.modelo} ${g.color}`.trim(),
        titulo: g.titulo,
        tallas: g.tallas,
        ventaDiaria: g.ventaDiaria,
        disponible: g.disponible,
        enTransferencia: g.enTransferencia,
        cobertura,
        faltantePares: Math.round(g.faltante),
        paresPorCaja,
        cajas,
        pares: paresPorCaja ? cajas * paresPorCaja : Math.round(g.faltante),
        tieneCorrida: Boolean(paresPorCaja),
      };
    })
    .sort((a, b) => (a.cobertura ?? 0) - (b.cobertura ?? 0));
}

/**
 * Amazon por SKU para el pedido a China: venta diaria (últimos 30 días) y
 * stock (FBA + lo que viaja hacia FBA). Solo calzado. Si Amazon no está
 * conectado o las tablas están vacías, regresa un mapa vacío y el pedido se
 * calcula solo con MELI, como antes.
 */
const cacheAmazonCompras = new Map<string, { en: number; datos: Map<string, { ventaDiaria: number; stock: number }> }>();
const VIDA_CACHE_AMZ_MS = 60_000;

export async function amazonParaCompras(
  db: DB,
): Promise<Map<string, { ventaDiaria: number; stock: number }>> {
  // Cada clic en Planificación bajaba ~30 días de ventas de Amazon fila por
  // fila solo para sumarlas; un minuto de caché por instancia lo evita.
  const guardado = cacheAmazonCompras.get("unica");
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_AMZ_MS) return guardado.datos;

  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  try {
    const [ventas, inventario] = await Promise.all([
      traerTodo<any>(db, "amazon_ventas_diarias", "seller_sku, unidades", (q) =>
        q.gte("fecha", desde),
      ),
      traerTodo<any>(db, "amazon_inventario", "seller_sku, disponible, en_transferencia", (q) => q),
    ]);

    const mapa = new Map<string, { ventaDiaria: number; stock: number }>();
    const entrada = (sku: string) => {
      const e = mapa.get(sku) ?? { ventaDiaria: 0, stock: 0 };
      mapa.set(sku, e);
      return e;
    };
    for (const v of ventas) {
      const sku = String(v.seller_sku ?? "");
      if (!esCalzado(sku)) continue;
      entrada(sku).ventaDiaria += (v.unidades ?? 0) / 30;
    }
    for (const i of inventario) {
      const sku = String(i.seller_sku ?? "");
      if (!esCalzado(sku)) continue;
      entrada(sku).stock += (i.disponible ?? 0) + (i.en_transferencia ?? 0);
    }
    cacheAmazonCompras.set("unica", { en: Date.now(), datos: mapa });
    return mapa;
  } catch {
    return new Map();
  }
}

/** Corridas por modelo+color → pares por caja, para redondear a cajas. */
export function mapaCorridas(
  corridasRaw: { modelo?: string; color?: string; tallas?: Record<string, number>; total?: number; pedido?: string }[],
): Map<string, number> {
  const porClave = new Map<string, { total: number; pedido: string }>();
  for (const c of corridasRaw) {
    const clave = claveGrupoFba(c.modelo ?? "", c.color ?? "");
    const total =
      c.total ?? Object.values(c.tallas ?? {}).reduce((a, b) => a + Number(b), 0);
    if (!total) continue;
    const previa = porClave.get(clave);
    // La corrida del pedido más nuevo es la vigente (por NÚMERO, no por
    // texto: "IN9999" > "IN10160" como cadena).
    if (!previa || numeroDePedido(String(c.pedido ?? "")) > numeroDePedido(previa.pedido)) {
      porClave.set(clave, { total, pedido: String(c.pedido ?? "") });
    }
  }
  return new Map([...porClave.entries()].map(([k, v]) => [k, v.total]));
}
