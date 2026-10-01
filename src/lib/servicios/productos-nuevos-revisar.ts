/**
 * Revisión de fotos de los productos nuevos contra MELI y Amazon, con lo
 * revisado guardado en app_cache (`nuevos:fotos`). La usan la pantalla
 * (`/api/pedidos/nuevos/fotos`) y el aviso por correo al cargar un
 * contenedor.
 *
 * MELI: la publicación (`/items`, 20 por llamada) trae `pictures`; en las
 * que tienen variantes cada variante dice cuáles son suyas (`picture_ids`),
 * y eso es lo que cuenta para el color. Amazon: el catálogo por ASIN, una
 * variante (MAIN, PT01…) por foto. Solo se pregunta por lo que toca
 * (`tocaRevisar`); con `todo` se vuelve a preguntar todo.
 */
import type { DB } from "../datos/repos";
import { clienteDeCuenta } from "./webhooks";
import { enLotes, trozos } from "../meli/client";
import { Cliente, cuentasAmazon } from "../amazon/spapi";
import { imagenesDeAsins } from "../amazon/catalogo";
import { fotosCapturadasPorSku } from "../amazon/fotos-publicacion";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";
import { CLAVE_FOTOS_NUEVOS, FOTOS_MINIMAS, cargarProductosNuevos, type ProductoNuevo } from "./productos-nuevos";
import { huellaPublicaciones, tocaRevisar, type FotosGuardada, type FotosProducto } from "./productos-nuevos-fotos";

const PLAZO_AMAZON_MS = 40_000;

/** El ASIN padre de cada hijo, de `amazon_padres` (lo resuelve el latido). */
async function padresDeHijos(admin: DB, accountId: string, hijos: string[]): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  for (let i = 0; i < hijos.length; i += 200) {
    const { data } = await admin
      .from("amazon_padres")
      .select("asin, parent_asin")
      .eq("account_id", accountId)
      .in("asin", hijos.slice(i, i + 200));
    for (const f of (data ?? []) as { asin: string; parent_asin: string | null }[]) {
      if (f.parent_asin) salida.set(f.asin, f.parent_asin);
    }
  }
  return salida;
}

interface ItemMeli {
  id: string;
  status?: string;
  pictures?: { id?: string }[];
  variations?: { id?: number | string; picture_ids?: string[] }[];
}

interface FotosGuardadas {
  productos: Record<string, FotosGuardada>;
}

export interface RevisionFotos {
  amazonConectado: boolean;
  productos: FotosProducto[];
  /** la lista de productos nuevos con la que se revisó */
  lista: ProductoNuevo[];
  errores: string[];
  revisados: number;
  guardados: number;
  revisadoEn: string;
}

export async function revisarFotosDeNuevos(db: DB, admin: DB, cuentaId: string, todo: boolean): Promise<RevisionFotos> {
  const { productos: lista, amazonConectado } = await cargarProductosNuevos(db, cuentaId);
  const errores: string[] = [];

  const guardadas = await leerCacheAppGuardado<FotosGuardadas>(db, cuentaId, CLAVE_FOTOS_NUEVOS);
  const previas = guardadas.estado === "encontrado" ? (guardadas.valor.datos?.productos ?? {}) : {};

  const productos = lista.filter((p) => tocaRevisar(p, previas[p.clave], amazonConectado, todo));
  const ahora = new Date().toISOString();
  const salida = new Map<string, FotosProducto>(
    lista.map((p) => {
      const previa = previas[p.clave];
      const base: FotosProducto =
        previa && !productos.includes(p)
          ? { clave: p.clave, meli: previa.meli, amazon: previa.amazon, revisadoEn: previa.revisadoEn ?? null }
          : { clave: p.clave, meli: { fotos: null, itemId: null, estado: null }, amazon: { fotos: null, asin: null }, revisadoEn: null };
      return [p.clave, base];
    }),
  );

  // ---- MELI ---------------------------------------------------------------
  try {
    const itemIds = [
      ...new Set(
        productos.flatMap((p) => p.meli.publicaciones.map((x) => x.itemId).filter((x): x is string => Boolean(x))),
      ),
    ];
    if (itemIds.length) {
      const cliente = await clienteDeCuenta(admin, cuentaId);
      if (!cliente) throw new Error("La cuenta de MELI no tiene tokens guardados.");

      const items = new Map<string, ItemMeli>();
      const respuestas = await enLotes(trozos(itemIds, 20), 4, async (grupo) => {
        try {
          return await cliente.get<{ code: number; body: ItemMeli }[]>("/items", {
            ids: grupo.join(","),
            attributes: "id,status,pictures,variations",
          });
        } catch (err) {
          errores.push(`MELI no contestó por ${grupo.length} publicaciones: ${(err as Error).message}`);
          return [] as { code: number; body: ItemMeli }[];
        }
      });
      for (const lote of respuestas) {
        for (const env of lote ?? []) {
          if (env?.code === 200 && env.body?.id) items.set(env.body.id, env.body);
        }
      }

      for (const p of productos) {
        const f = salida.get(p.clave)!;
        for (const pub of p.meli.publicaciones) {
          if (!pub.itemId) continue;
          const item = items.get(pub.itemId);
          if (!item) continue;
          const variante = pub.variationId
            ? (item.variations ?? []).find((v) => String(v.id) === pub.variationId)
            : undefined;
          const fotos =
            variante?.picture_ids && variante.picture_ids.length
              ? variante.picture_ids.length
              : (item.pictures ?? []).length;
          if (f.meli.fotos == null || fotos > f.meli.fotos) {
            f.meli = { fotos, itemId: pub.itemId, estado: item.status ?? null };
          }
        }
      }
    }
  } catch (err) {
    errores.push(`MELI: ${(err as Error).message}`);
  }

  // ---- Amazon ---------------------------------------------------------------
  // Hasta el 1-oct-2026 se preguntaba por UN ASIN por color y solo al
  // catálogo: Amazon no siempre copia las fotos a cada talla, las deja en
  // el PADRE, y el catálogo tarda en publicar lo recién subido; el dueño
  // veía «0 fotos» en productos a los que ya les había cargado imágenes.
  // Ahora se cuentan todas las tallas del color y su padre, y lo que el
  // catálogo aún no publica se busca en la ficha CAPTURADA del vendedor
  // (Listings Items, lo mismo que ya ve Productos nuevos de TikTok).
  if (amazonConectado) {
    try {
      const conAmazon = productos.filter((p) => p.amazon.asins.length || p.amazon.skus.length);
      if (conAmazon.length) {
        const credenciales = (await cuentasAmazon(admin))[0];
        if (!credenciales) throw new Error("Amazon no tiene credenciales guardadas.");
        const cliente = new Cliente(credenciales, Date.now() + PLAZO_AMAZON_MS);
        const hijos = [...new Set(conAmazon.flatMap((p) => p.amazon.asins))];
        const padres = await padresDeHijos(admin, cliente.cuenta.accountId, hijos);
        const asins = [...new Set([...hijos, ...padres.values()])];
        const imagenes = asins.length ? await imagenesDeAsins(cliente, asins) : new Map<string, unknown[]>();
        for (const p of conAmazon) {
          const f = salida.get(p.clave)!;
          let mejor: { fotos: number; asin: string | null } = { fotos: 0, asin: p.amazon.asins[0] ?? null };
          const candidatos = [...p.amazon.asins, ...p.amazon.asins.map((h) => padres.get(h)).filter((x): x is string => Boolean(x))];
          for (const asin of candidatos) {
            const n = imagenes.get(asin)?.length ?? 0;
            if (n > mejor.fotos) mejor = { fotos: n, asin };
          }
          f.amazon = mejor;
        }
        // Lo que sigue corto: la ficha capturada por SKU (fotos que el
        // vendedor ya subió aunque el catálogo no las enseñe todavía).
        const cortos = conAmazon.filter((p) => (salida.get(p.clave)!.amazon.fotos ?? 0) < FOTOS_MINIMAS && p.amazon.skus.length);
        if (cortos.length && credenciales.sellingPartnerId && cliente.msRestantes() > 5_000) {
          const skus = [...new Set(cortos.flatMap((p) => p.amazon.skus))];
          const capturadas = await fotosCapturadasPorSku(cliente, credenciales.sellingPartnerId, skus);
          for (const p of cortos) {
            const f = salida.get(p.clave)!;
            for (const sku of p.amazon.skus) {
              const n = capturadas.get(sku.toUpperCase())?.length ?? 0;
              if (n > (f.amazon.fotos ?? 0)) f.amazon = { fotos: n, asin: f.amazon.asin ?? p.amazon.asins[0] ?? null };
            }
          }
        }
      }
    } catch (err) {
      errores.push(`Amazon: ${(err as Error).message}`);
    }
  }

  // Lo recién preguntado queda con su fecha; si MELI o Amazon fallaron, esos
  // se quedan sin fecha para volver a preguntar la próxima vez.
  const t0 = Date.now();
  const fallo = { meli: errores.some((e) => e.startsWith("MELI")), amazon: errores.some((e) => e.startsWith("Amazon")) };
  for (const p of productos) {
    const f = salida.get(p.clave)!;
    const incompleto =
      (fallo.meli && p.meli.publicaciones.some((x) => x.itemId)) || (fallo.amazon && p.amazon.asins.length > 0);
    f.revisadoEn = incompleto ? null : ahora;
  }
  const nuevas: FotosGuardadas = { productos: { ...previas } };
  for (const p of lista) {
    const f = salida.get(p.clave)!;
    nuevas.productos[p.clave] = { ...f, huella: huellaPublicaciones(p) };
  }
  // Lo que ya no es producto nuevo sale del guardado.
  const vivas = new Set(lista.map((p) => p.clave));
  for (const k of Object.keys(nuevas.productos)) if (!vivas.has(k)) delete nuevas.productos[k];
  await guardarCacheApp(db, cuentaId, CLAVE_FOTOS_NUEVOS, nuevas, Date.now() - t0);

  return {
    amazonConectado,
    productos: [...salida.values()],
    lista,
    errores,
    revisados: productos.length,
    guardados: lista.length - productos.length,
    revisadoEn: ahora,
  };
}
