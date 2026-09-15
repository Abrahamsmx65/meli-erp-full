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
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";
import { CLAVE_FOTOS_NUEVOS, cargarProductosNuevos, type ProductoNuevo } from "./productos-nuevos";
import { huellaPublicaciones, tocaRevisar, type FotosGuardada, type FotosProducto } from "./productos-nuevos-fotos";

const PLAZO_AMAZON_MS = 40_000;

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
  if (amazonConectado) {
    try {
      const conAsin = productos.filter((p) => p.amazon.asins.length);
      if (conAsin.length) {
        const credenciales = (await cuentasAmazon(admin))[0];
        if (!credenciales) throw new Error("Amazon no tiene credenciales guardadas.");
        const cliente = new Cliente(credenciales, Date.now() + PLAZO_AMAZON_MS);
        // Las fotos son del color: un ASIN por producto basta.
        const asins = conAsin.map((p) => p.amazon.asins[0]);
        const imagenes = await imagenesDeAsins(cliente, asins);
        for (const p of conAsin) {
          const asin = p.amazon.asins[0];
          const f = salida.get(p.clave)!;
          f.amazon = { fotos: imagenes.get(asin)?.length ?? 0, asin };
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
