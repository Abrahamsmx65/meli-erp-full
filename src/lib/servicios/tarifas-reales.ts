/**
 * Lo que cada plataforma COBRÓ de verdad por modelo en los últimos 30 días
 * (MELI, Amazon, TikTok), para que Números calcule con lo real y no con
 * estimaciones (dueño, 11-oct-2026). Las sumas van en Postgres
 * (`*_tarifas_por_modelo`, migración 0136) y el resultado se guarda
 * masticado en `app_cache` (`finanzas:tarifas-reales`).
 */
import type { DB } from "../datos/repos";
import { traerRpcTodoOLanzar, traerTodo } from "../datos/repos";
import { tramoEnvio, type TarifasReales } from "../finanzas/numeros";
import { cuentaAmazon } from "./amazon";

// v2: trae el depósito por precio (`meliPorPrecio`, migración 0143).
// v3: trae el envío que cobra MELI por tramo de precio (`envioMeliPorTramo`).
export const CLAVE_TARIFAS = "finanzas:tarifas-reales:v3";
export const DIAS_TARIFAS = 30;
export const EDAD_TARIFAS_MS = 6 * 3_600_000;

export interface TarifasGuardadas {
  desde: string;
  porModelo: Record<string, TarifasReales>;
  avisos: string[];
}

const n = (x: unknown): number | null => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));

export async function calcularTarifasReales(db: DB, accountId: string): Promise<TarifasGuardadas> {
  const desde = new Date(Date.now() - DIAS_TARIFAS * 86_400_000).toISOString().slice(0, 10);
  const porModelo: Record<string, TarifasReales> = {};
  const de = (m: string) => (porModelo[m] ??= {});
  const avisos: string[] = [];

  const [meli, amz, tt, porPrecio, medidas] = await Promise.allSettled([
    traerRpcTodoOLanzar<any>(db, "meli_tarifas_por_modelo", { p_account: accountId, p_desde: desde }),
    (async () => {
      const cuenta = await cuentaAmazon(db);
      return cuenta ? traerRpcTodoOLanzar<any>(db, "amazon_tarifas_por_modelo", { p_account: cuenta.id, p_desde: desde }) : [];
    })(),
    traerRpcTodoOLanzar<any>(db, "tiktok_tarifas_por_modelo", { p_account: accountId, p_desde: desde }),
    traerRpcTodoOLanzar<any>(db, "meli_neto_por_precio_modelo", { p_account: accountId, p_desde: desde }),
    // Lo que MELI cobra HOY de envío con las medidas que ELLA capturó (su
    // simulador al precio de venta, de Costos de envío; dueño, 8-nov-2026:
    // «que lo que sale ahí de envío sea el real de MELI»).
    traerTodo<{ modelo: string | null; costo: unknown; precio_venta: unknown; precio: unknown; envio_gratis: boolean | null }>(
      db,
      "medidas_envio",
      "modelo, costo, precio_venta, precio, envio_gratis, sku",
      (q) => q.eq("account_id", accountId).not("costo", "is", null),
    ),
  ]);

  if (meli.status === "fulfilled") {
    for (const r of meli.value)
      de(r.modelo).meli = {
        pares: Number(r.pares ?? 0),
        paresDirecta: Number(r.pares_directa ?? 0),
        comisionPct: n(r.comision_pct),
        envioPar: n(r.envio_par),
        retencionPct: n(r.retencion_pct),
        netoPar: n(r.neto_par),
      };
  } else avisos.push(`MELI: ${(meli.reason as Error).message}`);
  if (porPrecio.status === "fulfilled") {
    for (const r of porPrecio.value) {
      const precio = n(r.precio);
      const netoPar = n(r.neto_par);
      if (precio == null || netoPar == null) continue;
      (de(r.modelo).meliPorPrecio ??= []).push({ precio, pares: Number(r.pares ?? 0), netoPar });
    }
  } else avisos.push(`MELI por precio: ${(porPrecio.reason as Error).message}`);
  if (amz.status === "fulfilled") {
    for (const r of amz.value)
      de(r.modelo).amazon = {
        unidades: Number(r.unidades ?? 0),
        precioPar: n(r.precio_par),
        comisionPct: n(r.comision_pct),
        retencionPct: n(r.retencion_pct),
        fbaPar: n(r.fba_par),
        otrosPar: n(r.otros_par),
        netoPar: n(r.neto_par),
      };
  } else avisos.push(`Amazon: ${(amz.reason as Error).message}`);
  if (tt.status === "fulfilled") {
    for (const r of tt.value)
      de(r.modelo).tiktok = {
        pares: Number(r.pares ?? 0),
        precioPar: n(r.precio_par),
        pagoPar: n(r.pago_par),
        afiliadoPct: n(r.afiliado_pct),
      };
  } else avisos.push(`TikTok: ${(tt.reason as Error).message}`);

  if (medidas.status === "fulfilled") {
    const grupos = new Map<string, Map<number, number[]>>();
    for (const f of medidas.value) {
      const costo = n(f.costo);
      const precio = n(f.precio_venta) ?? n(f.precio);
      if (!f.modelo || costo == null || precio == null || f.envio_gratis === false) continue;
      const modelo = f.modelo.toUpperCase();
      const porTramo = grupos.get(modelo) ?? new Map<number, number[]>();
      const t = tramoEnvio(precio);
      porTramo.set(t, [...(porTramo.get(t) ?? []), costo]);
      grupos.set(modelo, porTramo);
    }
    for (const [modelo, porTramo] of grupos) {
      const salida: NonNullable<TarifasReales["envioMeliPorTramo"]> = {};
      for (const [t, costos] of porTramo) {
        costos.sort((a, b) => a - b);
        salida[t] = { costo: costos[Math.floor(costos.length / 2)], variantes: costos.length };
      }
      de(modelo).envioMeliPorTramo = salida;
    }
  } else avisos.push(`Envío de MELI: ${(medidas.reason as Error).message}`);

  return { desde, porModelo, avisos };
}
