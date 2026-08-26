import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cerrarSync, cuentaActiva, registrarSync } from "@/lib/datos/repos";
import { MeliClient, MeliError } from "@/lib/meli/client";
import { descubrirRutaClips, normalizarClips } from "@/lib/servicios/clips";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Explorador del API de clips de MELI (?item=MLM123 para uno concreto; sin
 * parámetro toma una publicación activa del catálogo).
 *
 * La documentación pública solo muestra la variante de Global Selling
 * (/marketplace/items/{id}/clips), así que este diagnóstico prueba las rutas
 * candidatas con una publicación real y regresa las respuestas CRUDAS: con
 * eso se ve qué contesta MELI de verdad — forma del JSON, nombre del campo
 * de la URL del video, estados — y se ajusta el servicio sin adivinar.
 */
function detalleError(err: unknown): Record<string, unknown> {
  if (err instanceof MeliError) {
    return { status: err.status, cuerpo: err.cuerpo ?? err.message.slice(0, 1200) };
  }
  return { error: (err as Error).message.slice(0, 1200) };
}

export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const admin = clienteAdmin();
  const { data: tok } = await admin
    .from("meli_tokens")
    .select("access_token, refresh_token, expira_en")
    .eq("account_id", cuenta.id)
    .single();
  if (!tok) return NextResponse.json({ error: "La cuenta no tiene tokens." }, { status: 400 });

  const cliente = new MeliClient({
    clientId: process.env.MELI_CLIENT_ID!,
    clientSecret: process.env.MELI_CLIENT_SECRET!,
    credenciales: {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiraEn: new Date(tok.expira_en).getTime(),
    },
    alRenovar: async (c) => {
      await admin
        .from("meli_tokens")
        .update({
          access_token: c.accessToken,
          refresh_token: c.refreshToken,
          expira_en: new Date(c.expiraEn).toISOString(),
          actualizado_en: new Date().toISOString(),
        })
        .eq("account_id", cuenta.id);
    },
  });

  let itemId = req.nextUrl.searchParams.get("item")?.trim() ?? "";
  if (!itemId) {
    const { data } = await supabase
      .from("skus")
      .select("item_id")
      .eq("account_id", cuenta.id)
      .eq("activo", true)
      .eq("estado", "active")
      .not("item_id", "is", null)
      .limit(1)
      .maybeSingle();
    itemId = (data?.item_id as string) ?? "";
  }
  if (!itemId) {
    return NextResponse.json({ error: "No hay publicaciones activas que probar." }, { status: 400 });
  }

  const pruebas: Record<string, unknown> = {};

  const { data: up } = await supabase
    .from("skus")
    .select("user_product_id")
    .eq("account_id", cuenta.id)
    .eq("item_id", itemId)
    .not("user_product_id", "is", null)
    .limit(1)
    .maybeSingle();
  const { ruta, respuesta, sondeos } = await descubrirRutaClips(
    cliente,
    itemId,
    cuenta.meli_user_id,
    (up?.user_product_id as string) ?? undefined,
  );
  pruebas["sondeo de rutas"] = sondeos;
  pruebas["ruta elegida"] = ruta?.nombre ?? "NINGUNA contestó";
  if (ruta) {
    pruebas["clips normalizados"] = normalizarClips(respuesta);
  }

  try {
    pruebas["GET /items/{id} (campos de video y agrupador)"] = await cliente.get(
      `/items/${itemId}`,
      {
        attributes:
          "id,status,permalink,video_id,family_name,catalog_product_id,tags,videos,clips,short_videos",
      },
    );
  } catch (err) {
    pruebas["GET /items/{id} (campos de video y agrupador)"] = detalleError(err);
  }

  // Los user products de TODAS las tallas del item: si el clip vive ahí,
  // basta con que una talla conteste 200 para amarrar la ruta. Primero los
  // del catálogo local; si el item no está en el ERP, se sacan del item.
  let ups: string[] = [];
  {
    const { data } = await supabase
      .from("skus")
      .select("user_product_id")
      .eq("account_id", cuenta.id)
      .eq("item_id", itemId)
      .not("user_product_id", "is", null)
      .limit(30);
    ups = [...new Set((data ?? []).map((r) => r.user_product_id as string))];
  }
  if (!ups.length) {
    try {
      const item = await cliente.get<{
        variations?: { user_product_id?: string | null }[];
      }>(`/items/${itemId}`, { attributes: "variations" });
      ups = [
        ...new Set(
          (item.variations ?? [])
            .map((v) => v.user_product_id)
            .filter(Boolean) as string[],
        ),
      ];
    } catch {
      // Sin variaciones legibles: el sondeo de arriba ya dijo lo suyo.
    }
  }

  const clipsPorUp: Record<string, unknown> = {};
  for (const up of ups.slice(0, 15)) {
    try {
      clipsPorUp[up] = await cliente.get(`/user-products/${up}/clips`);
    } catch (err) {
      clipsPorUp[up] = detalleError(err);
    }
  }
  pruebas["GET /user-products/{up}/clips (todas las tallas)"] = clipsPorUp;

  // El cuerpo COMPLETO de un user product: si el clip viene incrustado ahí
  // (campo clips/videos/multimedia), aquí se ve.
  if (ups.length) {
    try {
      const cuerpo = await cliente.get(`/user-products/${ups[0]}`);
      // Como texto recortado: un JSON truncado no se puede re-parsear.
      pruebas["GET /user-products/{up} (cuerpo completo)"] =
        JSON.stringify(cuerpo).slice(0, 4000);
    } catch (err) {
      pruebas["GET /user-products/{up} (cuerpo completo)"] = detalleError(err);
    }
  }

  // A la bitácora: así el resultado se puede revisar desde fuera sin copiar
  // JSON del navegador. Es diagnóstico, no una corrida del proceso.
  try {
    const logId = await registrarSync(admin, cuenta.id, "clips_diagnostico");
    await cerrarSync(admin, logId, "ok", { itemId, pruebas } as never);
  } catch {
    // Si la bitácora no guarda, el JSON del navegador sigue completo.
  }

  return NextResponse.json({ itemId, pruebas });
}
