/**
 * Sincronización con Mercado Libre.
 *
 * Corre desde el cron de Vercel y también a mano desde la app. Cada corrida
 * deja una foto del stock del día: eso es lo que con el tiempo permite saber
 * con certeza qué días estuvo agotado cada SKU, en vez de deducirlo.
 */
import { MeliClient } from "../meli/client";
import {
  obtenerCatalogo,
  obtenerOperaciones,
  obtenerStockFull,
  obtenerUsuario,
} from "../meli/sync";
import { aISO, sumarDias } from "../engine/fechas";
import { obtenerVentas, claveItem } from "../meli/sync";
import { cerrarSync, registrarSync, upsertEnTandas, type DB } from "../datos/repos";

export interface ResultadoSync {
  skus: number;
  conStock: number;
  ventas: number;
  ordenes: number;
  operaciones: number;
  ventasSinSku: number;
  errores: string[];
  duracionMs: number;
}

/**
 * Desmenuza MODELO-COLOR-TALLA. Es best-effort para poder agrupar y filtrar
 * en la app: tanto el modelo como el color pueden traer guiones (GT104-4,
 * DK-BROWN), así que lo único confiable es que la talla va al final.
 */
export function desglosarSku(sku: string): {
  modelo: string | null;
  color: string | null;
  talla: string | null;
} {
  const partes = sku.split("-").filter(Boolean);
  if (partes.length < 2) return { modelo: sku || null, color: null, talla: null };

  const ultima = partes[partes.length - 1];
  const esTalla = /^\d{1,2}(\.\d)?$/.test(ultima);

  if (!esTalla) return { modelo: partes[0], color: partes.slice(1).join("-"), talla: null };

  return {
    modelo: partes[0],
    color: partes.slice(1, -1).join("-") || null,
    talla: ultima,
  };
}

export async function sincronizar(
  db: DB,
  accountId: string,
  opts?: { diasHistoria?: number; soloStock?: boolean },
): Promise<ResultadoSync> {
  const t0 = Date.now();
  const logId = await registrarSync(db, accountId, opts?.soloStock ? "stock" : "completa");
  const errores: string[] = [];

  try {
    const { data: cuenta } = await db
      .from("meli_accounts")
      .select("id, meli_user_id, site_id")
      .eq("id", accountId)
      .single();
    if (!cuenta) throw new Error("La cuenta no existe.");

    const { data: tok } = await db
      .from("meli_tokens")
      .select("access_token, refresh_token, expira_en")
      .eq("account_id", accountId)
      .single();
    if (!tok) throw new Error("Esta cuenta no tiene tokens guardados. Vuelve a conectarla con MELI.");

    const cliente = new MeliClient({
      clientId: process.env.MELI_CLIENT_ID!,
      clientSecret: process.env.MELI_CLIENT_SECRET!,
      credenciales: {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiraEn: new Date(tok.expira_en).getTime(),
      },
      // MELI rota el refresh token en cada renovación: si no se guarda el
      // nuevo al instante, la siguiente sincronización se queda fuera.
      alRenovar: async (c) => {
        await db
          .from("meli_tokens")
          .update({
            access_token: c.accessToken,
            refresh_token: c.refreshToken,
            expira_en: new Date(c.expiraEn).toISOString(),
            actualizado_en: new Date().toISOString(),
          })
          .eq("account_id", accountId);
      },
    });

    const usuario = await obtenerUsuario(cliente);
    const sellerId = usuario.id;

    // ---- Catálogo --------------------------------------------------------
    const catalogo = await obtenerCatalogo(cliente, sellerId);
    const filasSku = catalogo.map((f) => {
      const d = desglosarSku(f.sku);
      return {
        account_id: accountId,
        sku: f.sku,
        item_id: f.itemId,
        variation_id: f.variationId,
        inventory_id: f.inventoryId,
        titulo: f.titulo,
        logistica: f.logistica,
        estado: f.estado,
        precio: f.precio,
        modelo: d.modelo,
        color: d.color,
        talla: d.talla,
        activo: true,
        actualizado_en: new Date().toISOString(),
      };
    });
    await upsertEnTandas(db, "skus", filasSku, "account_id,sku");

    // ---- Stock actual + foto del día ------------------------------------
    const hoy = aISO(new Date());
    const conInventario = catalogo
      .filter((c) => c.inventoryId)
      .map((c) => ({ sku: c.sku, inventoryId: c.inventoryId }));

    const { stock, errores: errStock } = await obtenerStockFull(cliente, sellerId, conInventario);
    errores.push(...errStock.slice(0, 20));

    await upsertEnTandas(
      db,
      "stock_full",
      stock.map((s) => ({
        account_id: accountId,
        sku: s.sku,
        disponible: s.disponible,
        en_transferencia: s.enTransferencia,
        no_disponible: s.noDisponible,
        total: s.total,
        actualizado_en: new Date().toISOString(),
      })),
      "account_id,sku",
    );

    await upsertEnTandas(
      db,
      "stock_snapshots",
      stock.map((s) => ({
        account_id: accountId,
        sku: s.sku,
        fecha: hoy,
        disponible: s.disponible,
        en_transferencia: s.enTransferencia,
        origen: "snapshot",
      })),
      "account_id,sku,fecha",
    );

    if (opts?.soloStock) {
      const r: ResultadoSync = {
        skus: filasSku.length,
        conStock: stock.length,
        ventas: 0,
        ordenes: 0,
        operaciones: 0,
        ventasSinSku: 0,
        errores,
        duracionMs: Date.now() - t0,
      };
      await cerrarSync(db, logId, "ok", r as never);
      return r;
    }

    // ---- Ventas ----------------------------------------------------------
    const dias = opts?.diasHistoria ?? 90;
    const desde = sumarDias(hoy, -dias);

    const mapaItemSku = new Map<string, string>();
    for (const c of catalogo) {
      mapaItemSku.set(claveItem(c.itemId, c.variationId), c.sku);
      if (!c.variationId) mapaItemSku.set(c.itemId, c.sku);
    }

    const { ventas, ordenesLeidas, sinSku } = await obtenerVentas(
      cliente,
      sellerId,
      desde,
      hoy,
      mapaItemSku,
    );

    await upsertEnTandas(
      db,
      "ventas_diarias",
      ventas.map((v) => ({
        account_id: accountId,
        sku: v.sku,
        fecha: v.fecha,
        unidades: v.unidades,
        ordenes: v.ordenes ?? 0,
        importe: v.importe ?? 0,
      })),
      "account_id,sku,fecha",
    );

    // ---- Movimientos de inventario ---------------------------------------
    const mapaInventarioSku = new Map<string, string>();
    for (const c of catalogo) {
      if (c.inventoryId) mapaInventarioSku.set(c.inventoryId, c.sku);
    }

    let operaciones = 0;
    try {
      const ops = await obtenerOperaciones(cliente, sellerId, desde, hoy, mapaInventarioSku);
      // El id de operación viene en el payload; si falta, se sintetiza uno
      // estable para no duplicar en la siguiente corrida.
      const filas = ops.map((o, i) => ({
        account_id: accountId,
        operation_id: `${o.sku}-${o.fecha}-${i}`,
        sku: o.sku,
        fecha: o.fecha,
        tipo: o.tipo,
        delta_disponible: o.deltaDisponible,
        resultado_disponible: o.resultadoDisponible,
      }));
      operaciones = await upsertEnTandas(db, "stock_operaciones", filas, "account_id,operation_id");
    } catch (err) {
      // Sin movimientos el sistema sigue funcionando con los snapshots
      // diarios; solo pierde la reconstrucción hacia atrás.
      errores.push(`Movimientos de inventario: ${(err as Error).message}`);
    }

    const r: ResultadoSync = {
      skus: filasSku.length,
      conStock: stock.length,
      ventas: ventas.length,
      ordenes: ordenesLeidas,
      operaciones,
      ventasSinSku: sinSku,
      errores,
      duracionMs: Date.now() - t0,
    };

    await cerrarSync(db, logId, "ok", r as never);
    return r;
  } catch (err) {
    const mensaje = (err as Error).message;
    await cerrarSync(db, logId, "error", { mensaje, errores });
    throw err;
  }
}
