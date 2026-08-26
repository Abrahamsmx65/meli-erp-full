import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
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
      { attributes: "id,status,permalink,video_id,family_name,catalog_product_id,tags" },
    );
  } catch (err) {
    pruebas["GET /items/{id} (campos de video y agrupador)"] = detalleError(err);
  }

  return NextResponse.json({ itemId, pruebas });
}
