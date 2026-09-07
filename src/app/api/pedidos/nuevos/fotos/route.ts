import { NextResponse } from "next/server";
import { clienteServidor, clienteAdmin } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { productosNuevos } from "@/lib/servicios/productos-nuevos";
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

export interface FotosProducto {
  clave: string;
  /** null = sin publicación en MELI (o MELI no contestó por ella) */
  meli: { fotos: number | null; itemId: string | null; estado: string | null };
  /** null = sin publicación en Amazon; `sinCuenta` cuando Amazon no está conectado */
  amazon: { fotos: number | null; asin: string | null };
}

/**
 * Cuántas fotos tiene cada producto nuevo en MELI y en Amazon, en vivo.
 *
 * MELI: la publicación (`/items`, 20 por llamada) trae `pictures`; en las
 * que tienen variantes cada variante dice cuáles son suyas (`picture_ids`),
 * y eso es lo que cuenta para el color. Amazon: el catálogo por ASIN, una
 * variante (MAIN, PT01…) por foto. Son pocos productos, así que se pregunta
 * al momento y no se guarda nada.
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  const { productos, amazonConectado } = await productosNuevos(supabase, cuenta.id);
  const errores: string[] = [];
  const salida = new Map<string, FotosProducto>(
    productos.map((p) => [
      p.clave,
      { clave: p.clave, meli: { fotos: null, itemId: null, estado: null }, amazon: { fotos: null, asin: null } },
    ]),
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

  return NextResponse.json({
    ok: true,
    amazonConectado,
    productos: [...salida.values()],
    errores,
    revisadoEn: new Date().toISOString(),
  });
}
