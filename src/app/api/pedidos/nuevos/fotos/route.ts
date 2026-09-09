import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor, clienteAdmin } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { CLAVE_FOTOS_NUEVOS, cargarProductosNuevos } from "@/lib/servicios/productos-nuevos";
import { huellaPublicaciones, tocaRevisar, type FotosGuardada, type FotosProducto } from "@/lib/servicios/productos-nuevos-fotos";
import { guardarCacheApp, leerCacheAppGuardado } from "@/lib/servicios/cache-app";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { enLotes, trozos } from "@/lib/meli/client";
import { Cliente, cuentasAmazon } from "@/lib/amazon/spapi";
import { imagenesDeAsins } from "@/lib/amazon/catalogo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

/**
 * Cuántas fotos tiene cada producto nuevo en MELI y en Amazon.
 *
 * MELI: la publicación (`/items`, 20 por llamada) trae `pictures`; en las
 * que tienen variantes cada variante dice cuáles son suyas (`picture_ids`),
 * y eso es lo que cuenta para el color. Amazon: el catálogo por ASIN, una
 * variante (MAIN, PT01…) por foto. Lo revisado se GUARDA (app_cache,
 * `nuevos:fotos`) y solo se vuelve a preguntar por lo que le falta
 * (`tocaRevisar`); `?todo=1` revisa todo de nuevo.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  const todo = req.nextUrl.searchParams.get("todo") === "1";
  const { productos: lista, amazonConectado } = await cargarProductosNuevos(supabase, cuenta.id);
  const errores: string[] = [];

  const guardadas = await leerCacheAppGuardado<FotosGuardadas>(supabase, cuenta.id, CLAVE_FOTOS_NUEVOS);
  const previas = guardadas.estado === "encontrado" ? (guardadas.valor.datos?.productos ?? {}) : {};

  // Lo guardado se sirve tal cual; solo se pregunta por lo que toca.
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

  const admin = clienteAdmin();

  // ---- MELI ---------------------------------------------------------------
  try {
    const itemIds = [
      ...new Set(
        productos.flatMap((p) => p.meli.publicaciones.map((x) => x.itemId).filter((x): x is string => Boolean(x))),
      ),
    ];
    if (itemIds.length) {
      const cliente = await clienteDeCuenta(admin, cuenta.id);
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
    const incompleto = (fallo.meli && p.meli.publicaciones.some((x) => x.itemId)) || (fallo.amazon && p.amazon.asins.length > 0);
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
  await guardarCacheApp(supabase, cuenta.id, CLAVE_FOTOS_NUEVOS, nuevas, Date.now() - t0);

  return NextResponse.json({
    ok: true,
    amazonConectado,
    productos: [...salida.values()],
    errores,
    revisados: productos.length,
    guardados: lista.length - productos.length,
    revisadoEn: ahora,
  });
}
