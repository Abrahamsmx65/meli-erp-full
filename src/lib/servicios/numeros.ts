/**
 * Números: lo que el dueño fija por modelo (`numeros_modelos`) + el costo
 * del ÚLTIMO contenedor costeado (`finanzas:costeo`). Se importó UNA vez de
 * su sheet «Números» el 11-oct-2026; desde ahí vive aquí y el sheet ya no se
 * actualiza. La cuenta es ligera (fórmulas sobre ~200 modelos): la pantalla
 * la hace al leer, sobre dos lecturas acotadas.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { ENTRADA_VACIA, type EntradaNumeros, type TarifasReales } from "../finanzas/numeros";
import { leerCacheAppGuardado } from "./cache-app";
import { CLAVE_COSTEO, type ResultadoCosteo } from "./costeo";
import { configPorProducto } from "./productos";

export interface RenglonNumeros {
  entrada: EntradaNumeros;
  categoria: string | null;
  /** costo por par con el que se calcula */
  costo: number | null;
  /** de dónde salió: el último contenedor costeado o, si no hay, el catálogo */
  fuenteCosto: "contenedor" | "catalogo" | null;
  contenedor: string | null;
  /** ya tiene renglón guardado en numeros_modelos */
  guardado: boolean;
  /** lo que cobró cada plataforma de verdad en los últimos 30 días */
  reales: TarifasReales | null;
}

const n = (x: unknown): number | null => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));

export async function listarNumeros(
  db: DB,
  accountId: string,
  tarifas: Record<string, TarifasReales> = {},
): Promise<{ renglones: RenglonNumeros[]; costeoEn: string | null }> {
  const [filas, costeo, config] = await Promise.all([
    traerTodo<any>(
      db,
      "numeros_modelos",
      "modelo, envio_meli, precio_relampago, pv_normal, retencion, envio_amazon, pvp_deal, tiktok_extra, tiktok_comision, tiktok_oferta",
      (q) => q.eq("account_id", accountId),
    ),
    leerCacheAppGuardado<ResultadoCosteo>(db, accountId, CLAVE_COSTEO),
    configPorProducto(db, accountId).catch(() => new Map()),
  ]);
  const ultimo = new Map<string, { id: string; porPar: number }>();
  let costeoEn: string | null = null;
  if (costeo.estado === "encontrado") {
    costeoEn = costeo.valor.generadoEn;
    for (const m of costeo.valor.datos.modelos) if (m.ultimo) ultimo.set(m.modelo, m.ultimo);
  }
  const entradas = new Map<string, EntradaNumeros>();
  for (const f of filas) {
    entradas.set(f.modelo, {
      modelo: f.modelo,
      envioMeli: n(f.envio_meli),
      precioRelampago: n(f.precio_relampago),
      pvNormal: n(f.pv_normal),
      retencion: Boolean(f.retencion),
      envioAmazon: n(f.envio_amazon),
      pvpDeal: n(f.pvp_deal),
      tiktokExtra: n(f.tiktok_extra) ?? ENTRADA_VACIA.tiktokExtra,
      tiktokComision: n(f.tiktok_comision) ?? ENTRADA_VACIA.tiktokComision,
      tiktokOferta: n(f.tiktok_oferta) ?? ENTRADA_VACIA.tiktokOferta,
    });
  }
  const modelos = new Set<string>([...entradas.keys(), ...ultimo.keys()]);
  const renglones: RenglonNumeros[] = [...modelos].map((modelo) => {
    const u = ultimo.get(modelo) ?? null;
    const cfg = config.get(modelo) ?? null;
    const costo = u?.porPar ?? cfg?.costo ?? null;
    return {
      entrada: entradas.get(modelo) ?? { modelo, ...ENTRADA_VACIA },
      categoria: cfg?.categoria ?? null,
      costo,
      fuenteCosto: u ? "contenedor" : costo != null ? "catalogo" : null,
      contenedor: u?.id ?? null,
      guardado: entradas.has(modelo),
      reales: tarifas[modelo] ?? null,
    };
  });
  renglones.sort((a, b) => a.entrada.modelo.localeCompare(b.entrada.modelo, "es", { numeric: true }));
  return { renglones, costeoEn };
}

const precio = (x: unknown, campo: string): number | null => {
  if (x == null || x === "") return null;
  const v = Number(x);
  if (!Number.isFinite(v) || v < 0) throw new Error(`${campo}: debe ser un número positivo.`);
  return v;
};

export async function guardarNumeros(db: DB, accountId: string, e: Partial<EntradaNumeros> & { modelo: string }): Promise<void> {
  const modelo = String(e.modelo ?? "").trim().toUpperCase();
  if (!/^[A-Z]{1,4}\d{2,5}[A-Z]?$/.test(modelo)) throw new Error("Modelo inválido.");
  const comision = precio(e.tiktokComision, "Comisión TikTok") ?? ENTRADA_VACIA.tiktokComision;
  if (comision >= 1) throw new Error("La comisión de TikTok va en fracción (0.24 = 24 %).");
  const { error } = await db.from("numeros_modelos").upsert(
    {
      account_id: accountId,
      modelo,
      envio_meli: precio(e.envioMeli, "Envío MELI"),
      precio_relampago: precio(e.precioRelampago, "Precio relámpago"),
      pv_normal: precio(e.pvNormal, "PV normal"),
      retencion: Boolean(e.retencion),
      envio_amazon: precio(e.envioAmazon, "Envío Amazon"),
      pvp_deal: precio(e.pvpDeal, "PVP deal"),
      tiktok_extra: precio(e.tiktokExtra, "Extra TikTok") ?? ENTRADA_VACIA.tiktokExtra,
      tiktok_comision: comision,
      tiktok_oferta: precio(e.tiktokOferta, "Factor oferta TikTok") ?? ENTRADA_VACIA.tiktokOferta,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "account_id,modelo" },
  );
  if (error) throw new Error(`numeros_modelos: ${error.message}`);
}
