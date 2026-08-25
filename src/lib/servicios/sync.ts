/**
 * Sincronización con Mercado Libre.
 *
 * Corre desde el cron de Vercel y también a mano desde la app. Cada corrida
 * deja una foto del stock del día: eso es lo que con el tiempo permite saber
 * con certeza qué días estuvo agotado cada SKU, en vez de deducirlo.
 */
import { MeliClient } from "../meli/client";
import {
  dedupePorSku,
  nuevoDiagnostico,
  recuperarDesdeOrdenes,
  obtenerCatalogo,
  obtenerOperaciones,
  obtenerStockFull,
  obtenerUsuario,
} from "../meli/sync";
import { aISO, sumarDias } from "../engine/fechas";
import { obtenerVentas, claveItem } from "../meli/sync";
import {
  cerrarSync,
  conCandado,
  registrarSync,
  traerTodo,
  upsertEnTandas,
  type DB,
} from "../datos/repos";

/**
 * SKUs fantasma: filas activas de un item que ESTA corrida sí recorrió, cuyo
 * SKU ya no vino de MELI y que no están pendientes de resolverse. Es la
 * huella que deja renombrar un SKU en MELI: el nombre nuevo entra como fila
 * nueva y el viejo se quedaba activo para siempre.
 */
export function detectarSkusFantasma(
  activos: { sku: string; item_id: string | null; user_product_id: string | null }[],
  frescos: { sku: string; itemId: string }[],
  variantesSinSku: { itemId: string; userProductId: string | null }[],
): string[] {
  const itemsVistos = new Set(frescos.map((f) => f.itemId));
  for (const v of variantesSinSku) itemsVistos.add(v.itemId);
  const skusFrescos = new Set(frescos.map((f) => f.sku));
  const pendientes = new Set(
    variantesSinSku.map((v) => v.userProductId).filter(Boolean) as string[],
  );

  return activos
    .filter(
      (r) =>
        r.item_id &&
        itemsVistos.has(r.item_id) &&
        !skusFrescos.has(r.sku) &&
        !(r.user_product_id && pendientes.has(r.user_product_id)),
    )
    .map((r) => r.sku);
}
import { invalidar } from "./cache";

export interface ResultadoSync {
  skus: number;
  conStock: number;
  ventas: number;
  ordenes: number;
  operaciones: number;
  ventasSinSku: number;
  /** publicaciones que el recorrido se saltó y se recuperaron desde las órdenes */
  recuperadas: number;
  /** variantes que el catálogo descartó, con el motivo */
  descartadas: {
    sinSku: number;
    repetidos: number;
    lotesFallidos: number;
    userProductsFallidos: number;
    userProductsPendientes: number;
    /** "MLM123: 4" — cuántas tallas se cayeron por publicación */
    publicaciones: string[];
  };
  errores: string[];
  duracionMs: number;
}

/**
 * Desmenuza MODELO-COLOR-TALLA. Es best-effort para poder agrupar y filtrar
 * en la app: tanto el modelo como el color pueden traer guiones (GT104-4,
 * DK-BROWN), así que lo único confiable es que la talla va al final.
 */
const SUFIJOS_SITIO = new Set([
  "MX", "MLM", "AR", "MLA", "BR", "MLB", "CL", "MLC",
  "CO", "MCO", "PE", "MPE", "UY", "MLU", "US", "MX1",
]);

export function desglosarSku(sku: string): {
  modelo: string | null;
  color: string | null;
  talla: string | null;
} {
  const partes = sku.split("-").map((p) => p.trim()).filter(Boolean);
  if (partes.length < 2) return { modelo: sku || null, color: null, talla: null };

  // Fuera el sufijo de país: GT110-NAVY-26-MX -> GT110-NAVY-26.
  // Sin esto la talla quedaba escondida en medio y el color se comía el resto.
  while (partes.length > 2 && SUFIJOS_SITIO.has(partes[partes.length - 1].toUpperCase())) {
    partes.pop();
  }

  const ultima = partes[partes.length - 1];
  const esTalla = /^\d{1,2}(\.\d)?$/.test(ultima);

  if (!esTalla) return { modelo: partes[0], color: partes.slice(1).join("-"), talla: null };

  return {
    modelo: partes[0],
    color: partes.slice(1, -1).join("-") || null,
    talla: ultima,
  };
}

/**
 * Guarda ventas diarias tolerando que la columna `comision` todavía no
 * exista en la base (la migración 0011 puede aplicarse después del deploy).
 * En cuanto exista, la comisión se escribe sola; mientras, no se pierde nada
 * más que ese campo.
 */
export async function guardarVentasDiarias(
  db: DB,
  filas: Record<string, unknown>[],
  // Con rango, la foto fresca MANDA: lo que esos días ya no traen, se borra.
  rango?: { accountId: string; desde: string; hasta: string },
): Promise<void> {
  if (!filas.length) return;
  try {
    await upsertEnTandas(db, "ventas_diarias", filas, "account_id,sku,fecha");
  } catch (err) {
    const mensaje = String((err as Error).message);
    if (!mensaje.includes("comision") && !mensaje.includes("neto")) throw err;
    await upsertEnTandas(
      db,
      "ventas_diarias",
      filas.map(({ comision: _c, neto: _n, ...resto }) => resto),
      "account_id,sku,fecha",
    );
  }

  // El upsert nunca borra: un día re-sincronizado cuya venta se canceló, o
  // cuyo SKU se renombró en MELI, dejaba la fila vieja sumando PARA SIEMPRE
  // (el cron reescribe 90 días con el nombre nuevo y el viejo sobrevivía).
  // La foto fresca del rango es la verdad de esos días: lo demás sobra.
  if (!rango) return;
  const frescos = new Map<string, Set<string>>();
  for (const f of filas) {
    const fecha = String(f.fecha);
    let set = frescos.get(fecha);
    if (!set) frescos.set(fecha, (set = new Set()));
    set.add(String(f.sku));
  }

  const existentes = await traerTodo<{ sku: string; fecha: string }>(
    db,
    "ventas_diarias",
    "sku, fecha",
    (q) =>
      q.eq("account_id", rango.accountId).gte("fecha", rango.desde).lte("fecha", rango.hasta),
  );

  const porFecha = new Map<string, string[]>();
  for (const e of existentes) {
    if (frescos.get(e.fecha)?.has(e.sku)) continue;
    const lista = porFecha.get(e.fecha) ?? [];
    lista.push(e.sku);
    porFecha.set(e.fecha, lista);
  }

  for (const [fecha, skus] of porFecha) {
    for (let i = 0; i < skus.length; i += 100) {
      const { error } = await db
        .from("ventas_diarias")
        .delete()
        .eq("account_id", rango.accountId)
        .eq("fecha", fecha)
        .in("sku", skus.slice(i, i + 100));
      if (error) throw new Error(`ventas_diarias (reconciliación): ${error.message}`);
    }
  }
}

async function ejecutarSincronizacion(
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

    // ---- Catálogo: recorrido de publicaciones ----------------------------
    const diag = nuevoDiagnostico();

    // Agrupado por publicación: un id de variante suelto no le sirve a nadie,
    // pero "esta publicación trae 6 tallas sin SKU" sí se puede ir a arreglar.
    const porPublicacion = () => {
      const porItem = new Map<string, number>();
      for (const v of diag.variantesSinSku) {
        porItem.set(v.itemId, (porItem.get(v.itemId) ?? 0) + 1);
      }
      return [...porItem.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([itemId, n]) => `${itemId}: ${n}`);
    };
    // Amarres user_product -> SKU que ya se resolvieron antes. Sin esto cada
    // corrida volvería a preguntar por miles de productos y se pasaría del
    // límite de tiempo de la función.
    const cache = new Map<string, string>();
    {
      const { data: previos } = await db
        .from("skus")
        .select("sku, user_product_id")
        .eq("account_id", accountId)
        .not("user_product_id", "is", null);
      for (const p of previos ?? []) {
        if (p.user_product_id && p.sku) cache.set(p.user_product_id, p.sku);
      }
    }

    let catalogo = await obtenerCatalogo(cliente, sellerId, {
      diag,
      cache,
      // La sincronización entera tiene 300 s en Vercel; esta parte se queda
      // con un pedazo acotado y lo que no alcance sigue en la próxima.
      limiteUserProductsMs: 60_000,
    });

    const hoy = aISO(new Date());
    const dias = opts?.diasHistoria ?? 90;
    const desde = sumarDias(hoy, -dias);

    let ventas: Awaited<ReturnType<typeof obtenerVentas>>["ventas"] = [];
    let ventasTruncadas = false;
    let ordenesLeidas = 0;
    let sinSku = 0;
    let recuperadas = 0;

    if (!opts?.soloStock) {
      // ---- Ventas --------------------------------------------------------
      const mapaItemSku = new Map<string, string>();
      for (const c of catalogo) {
        mapaItemSku.set(claveItem(c.itemId, c.variationId), c.sku);
        if (!c.variationId) mapaItemSku.set(c.itemId, c.sku);
      }

      const r = await obtenerVentas(cliente, sellerId, desde, hoy, mapaItemSku);
      ventas = r.ventas;
      ventasTruncadas = r.truncado;
      ordenesLeidas = r.ordenesLeidas;
      sinSku = r.sinSku;

      // ---- Red de seguridad del catálogo ---------------------------------
      //
      // El recorrido de publicaciones se salta cosas: los productos agotados
      // en Full quedan pausados o cerrados y no siempre aparecen. Justo esos
      // son los que urge reponer, así que perderlos vacía el plan.
      //
      // Las órdenes son prueba irrefutable de que la publicación existe: si
      // vendió, está. Se recuperan por su id y se agregan al catálogo.
      const enCatalogo = new Set(catalogo.map((c) => c.sku));
      // Si la publicación+variación de la orden YA está en el catálogo con
      // otro nombre, el SKU de la orden es un nombre VIEJO (renombrado en
      // MELI): rescatarlo lo resucitaba en cada corrida y el fantasma nunca
      // moría. Solo se rescata lo que de verdad no vino: agotados y pausados.
      const clavesEnCatalogo = new Set(
        catalogo.map((c) => claveItem(c.itemId, c.variationId)),
      );
      const faltantes = [...r.itemsPorSku.values()].filter(
        (ref) =>
          !enCatalogo.has(ref.sku) &&
          !clavesEnCatalogo.has(claveItem(ref.itemId, ref.variationId)),
      );

      if (faltantes.length) {
        try {
          const rec = await recuperarDesdeOrdenes(cliente, faltantes);
          if (rec.filas.length) {
            catalogo = dedupePorSku([...catalogo, ...rec.filas]);
          }
          recuperadas = rec.recuperados;

          if (rec.recuperados < rec.intentados) {
            errores.push(
              `Publicaciones faltantes: se intentaron ${rec.intentados}, se recuperaron ${rec.recuperados}` +
                (rec.sinPublicacion ? `, ${rec.sinPublicacion} sin publicación accesible` : "") +
                (rec.lotesFallidos ? `, ${rec.lotesFallidos} lotes con error` : "") +
                ".",
            );
          }
        } catch (err) {
          errores.push(`Recuperación de publicaciones: ${(err as Error).message}`);
        }
      }
    }

    // ---- Guardar catálogo ya completo ------------------------------------
    const filasSku = catalogo.map((f) => {
      const d = desglosarSku(f.sku);
      return {
        account_id: accountId,
        sku: f.sku,
        item_id: f.itemId,
        variation_id: f.variationId,
        inventory_id: f.inventoryId,
        user_product_id: f.userProductId,
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

    // Renombrar un SKU en MELI dejaba el nombre viejo como fila fantasma,
    // activa para siempre: el plan, las etiquetas y los datos fiscales la
    // seguían contando como real. Lo que un item recorrido ya no trae, y no
    // está pendiente de resolverse, se apaga; borrarlo rompería el historial.
    const activosPrevios = await traerTodo<{
      sku: string;
      item_id: string | null;
      user_product_id: string | null;
    }>(db, "skus", "sku, item_id, user_product_id", (q) =>
      q.eq("account_id", accountId).eq("activo", true),
    );
    const fantasmas = detectarSkusFantasma(
      activosPrevios,
      catalogo.map((c) => ({ sku: c.sku, itemId: c.itemId })),
      diag.variantesSinSku.map((v) => ({
        itemId: v.itemId,
        userProductId: v.userProductId,
      })),
    );
    for (let i = 0; i < fantasmas.length; i += 200) {
      await db
        .from("skus")
        .update({ activo: false, actualizado_en: new Date().toISOString() })
        .eq("account_id", accountId)
        .in("sku", fantasmas.slice(i, i + 200));
    }

    // Las tallas que siguen sin SKU se apuntan con todo su contexto para que
    // el proceso de pendientes las resuelva con el dato real de MELI. La
    // lista se reemplaza completa: es la foto de esta corrida.
    await db.from("skus_pendientes").delete().eq("account_id", accountId);
    if (diag.variantesSinSku.length) {
      const filasPendientes = diag.variantesSinSku
        .filter((v) => v.userProductId)
        .map((v) => ({
          account_id: accountId,
          item_id: v.itemId,
          variation_id: v.variationId ?? "",
          user_product_id: v.userProductId,
          inventory_id: v.inventoryId,
          titulo: v.titulo,
          logistica: v.logistica,
          estado: v.estado,
          precio: v.precio,
        }));
      await upsertEnTandas(db, "skus_pendientes", filasPendientes, "account_id,item_id,variation_id");
    }

    // ---- Stock actual + foto del día -------------------------------------
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
        recuperadas: 0,
        descartadas: {
          sinSku: diag.variantesSinSku.length,
          repetidos: diag.skusRepetidos.length,
          lotesFallidos: diag.lotesFallidos,
          userProductsFallidos: diag.userProductsFallidos,
          userProductsPendientes: diag.userProductsPendientes,
          publicaciones: porPublicacion(),
        },
        errores,
        duracionMs: Date.now() - t0,
      };
      await cerrarSync(db, logId, "ok", r as never);
      return r;
    }

    await guardarVentasDiarias(
      db,
      ventas.map((v) => ({
        account_id: accountId,
        sku: v.sku,
        fecha: v.fecha,
        unidades: v.unidades,
        ordenes: v.ordenes ?? 0,
        importe: v.importe ?? 0,
        comision: v.comision ?? 0,
      })),
      // La ventana completa se reconcilia: cancelaciones y renombres fuera.
      // Solo con la foto COMPLETA: si MELI truncó la descarga, borrar contra
      // una foto incompleta destruiría ventas reales.
      ventasTruncadas ? undefined : { accountId, desde, hasta: hoy },
    );
    if (ventasTruncadas) {
      errores.push(
        "MELI truncó la descarga de órdenes (~10 mil por ventana): las ventas se guardaron pero la limpieza de residuos se saltó esta corrida.",
      );
    }

    // ---- Movimientos de inventario ---------------------------------------
    const mapaInventarioSku = new Map<string, string>();
    for (const c of catalogo) {
      if (c.inventoryId) mapaInventarioSku.set(c.inventoryId, c.sku);
    }

    let operaciones = 0;
    try {
      // Incremental: si ya hay historial, solo se piden los movimientos
      // nuevos. La primera corrida baja 90 días (~142 llamadas); las
      // siguientes bajan 2 o 3 días (~4 llamadas). Sin esto, cada
      // sincronización repetía la carga completa y MELI acababa contestando
      // 429 "over_quota" en este endpoint, que tiene su propia cuota.
      const { data: ultima } = await db
        .from("stock_operaciones")
        .select("fecha")
        .eq("account_id", accountId)
        .order("fecha", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Se traslapan 2 días para no perder nada que haya entrado tarde.
      const desdeOps = ultima?.fecha
        ? sumarDias(aISO(new Date(ultima.fecha)), -2)
        : desde;

      const r = await obtenerOperaciones(cliente, sellerId, desdeOps, hoy, mapaInventarioSku);
      const ops = r.operaciones;

      if (r.lotesFallidos > 0) {
        errores.push(
          `Movimientos: ${r.lotesFallidos} de ${r.lotesTotales} lotes no bajaron (${r.errores[0] ?? "sin detalle"}). Lo demás sí se guardó; vuelve a sincronizar más tarde para completar.`,
        );
      }
      // Se usa el id real de MELI. El sintetizado por índice cambiaba entre
      // corridas y multiplicaba los renglones en cada sincronización.
      const filas = ops.map((o) => ({
        account_id: accountId,
        operation_id: o.id ?? `${o.sku}|${o.fecha}|${o.resultadoDisponible ?? ""}`,
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

    // Una variante descartada se ve, desde la pantalla, igual que un producto
    // que no está publicado. Aquí queda escrita la diferencia.
    if (diag.variantesSinSku.length) {
      const ej = porPublicacion().slice(0, 5).join(", ");
      errores.push(
        `Catálogo: ${diag.variantesSinSku.length} variantes vienen de MELI sin SKU ` +
          `(${ej}). Esas tallas no se pueden amarrar hasta que la publicación traiga su código.`,
      );
    }
    if (diag.skusRepetidos.length) {
      const ej = [...new Set(diag.skusRepetidos.map((v) => v.sku))].slice(0, 5).join(", ");
      errores.push(
        `Catálogo: ${diag.skusRepetidos.length} variantes comparten SKU con otra de la misma ` +
          `publicación (${ej}). Cuando dos tallas traen el mismo código solo sobrevive una.`,
      );
    }
    if (diag.userProductsPendientes) {
      errores.push(
        `Catálogo: ${diag.userProductsPendientes} SKUs se están consultando a MELI en segundo ` +
          `plano (MELI limita el ritmo de esa consulta). No tienes que hacer nada: en unos ` +
          `minutos estarán y el plan se actualizará solo.`,
      );
    }
    if (diag.userProductsFallidos) {
      errores.push(
        `Catálogo: ${diag.userProductsFallidos} productos no bajaron de MELI, así que su SKU ` +
          `no se pudo leer. Esas tallas conservan lo que ya estaba guardado.`,
      );
    }
    if (diag.lotesFallidos) {
      errores.push(
        `Catálogo: ${diag.lotesFallidos} lotes de publicaciones no bajaron de MELI; ` +
          `esos SKUs conservan lo que ya se tenía guardado.`,
      );
    }

    const r: ResultadoSync = {
      skus: filasSku.length,
      conStock: stock.length,
      ventas: ventas.length,
      ordenes: ordenesLeidas,
      operaciones,
      ventasSinSku: sinSku,
      recuperadas,
      descartadas: {
        sinSku: diag.variantesSinSku.length,
        repetidos: diag.skusRepetidos.length,
        lotesFallidos: diag.lotesFallidos,
        userProductsFallidos: diag.userProductsFallidos,
        userProductsPendientes: diag.userProductsPendientes,
        publicaciones: porPublicacion(),
      },
      errores,
      duracionMs: Date.now() - t0,
    };

    await cerrarSync(db, logId, "ok", r as never);
    // Los insumos cambiaron: el plan guardado quedó viejo.
    await invalidar(db, accountId, "Se sincronizó con Mercado Libre después de calcularlo.");
    return r;
  } catch (err) {
    const mensaje = (err as Error).message;
    await cerrarSync(db, logId, "error", { mensaje, errores });
    throw err;
  }
}

export async function sincronizar(
  db: DB,
  accountId: string,
  opts?: { diasHistoria?: number; soloStock?: boolean },
): Promise<ResultadoSync> {
  return conCandado(
    db,
    accountId,
    "meli_sync",
    10 * 60,
    () => ejecutarSincronizacion(db, accountId, opts),
    "Ya hay una sincronización de Mercado Libre en curso. Espera a que termine.",
  );
}
