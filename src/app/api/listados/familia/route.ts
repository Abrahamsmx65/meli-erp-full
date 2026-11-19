import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, porTandas, traerTodo } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import {
  agruparEnFamilia,
  leerDestino,
  leerPublicaciones,
  resolverFamilia,
} from "@/lib/servicios/familia-meli";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PUBLICACIONES = 40;

/**
 * Agrupa publicaciones YA creadas en una familia de MELI: les escribe el
 * nombre de la familia destino y confirma en qué familia quedaron. Escribe
 * directo en MELI; no toca Supabase. `soloRevisar` no escribe nada.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const itemIds = leerPublicaciones(typeof body.publicaciones === "string" ? body.publicaciones : "");
  const destino = leerDestino(typeof body.destino === "string" ? body.destino : "");
  const soloRevisar = body.soloRevisar === true;

  if (!itemIds.length) return NextResponse.json({ error: "Pon al menos un MLM por agrupar." }, { status: 400 });
  if (!destino) {
    return NextResponse.json(
      { error: "El destino es el id de la familia (puros números) o un MLM que ya esté en ella." },
      { status: 400 },
    );
  }
  if (itemIds.length > MAX_PUBLICACIONES) {
    return NextResponse.json({ error: `Máximo ${MAX_PUBLICACIONES} publicaciones por vez.` }, { status: 400 });
  }

  // Solo publicaciones del catálogo propio, las que se mueven y la de destino.
  const porRevisar = destino.tipo === "publicacion" ? [...itemIds, destino.id] : itemIds;
  const propias = await porTandas(porRevisar, 100, (tanda) =>
    traerTodo<{ item_id: string }>(supabase, "skus", "item_id, sku", (q) =>
      q.eq("account_id", cuenta.id).in("item_id", tanda),
    ),
  );
  const conocidas = new Set(propias.map((f) => f.item_id));
  const ajenas = porRevisar.filter((id) => !conocidas.has(id));
  if (ajenas.length) {
    return NextResponse.json({ error: `Publicaciones fuera del catálogo: ${ajenas.join(", ")}.` }, { status: 400 });
  }

  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
  if (!cliente) {
    return NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 });
  }

  const itemDeUserProducts = async (ups: string[]): Promise<string | null> => {
    const filas = await porTandas(ups, 100, (tanda) =>
      traerTodo<{ item_id: string | null; activo: boolean | null }>(supabase, "skus", "item_id, activo, sku", (q) =>
        q.eq("account_id", cuenta.id).in("user_product_id", tanda).not("item_id", "is", null),
      ),
    );
    const elegida = filas.find((f) => f.activo && !itemIds.includes(f.item_id!)) ?? filas.find((f) => !itemIds.includes(f.item_id!));
    return elegida?.item_id ?? null;
  };

  try {
    const familia = await resolverFamilia(cliente, destino, itemDeUserProducts);
    const resumen = {
      familyId: familia.familyId,
      familyName: familia.familyName,
      itemId: familia.itemId,
      categoria: familia.categoria,
    };
    if (soloRevisar) return NextResponse.json({ ok: true, familia: resumen, resultados: [] });

    const resultados = await agruparEnFamilia(cliente, itemIds, familia);
    const ok = resultados.every((r) => r.estado === "agrupado" || r.estado === "ya_estaba");
    return NextResponse.json({ ok, familia: resumen, resultados });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
