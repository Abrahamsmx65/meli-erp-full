import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { MeliClient, MeliError } from "@/lib/meli/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Explorador TEMPORAL del API de datos fiscales de MELI (solo México):
 * https://api.mercadolibre.com/fiscal_information/graphql
 *
 * La introspección GraphQL la bloquea el PolicyAgent de MELI (403), pero la
 * documentación oficial ("Envío de datos fiscales") publica el esquema:
 *   - query getFiscalInformationBySku(sku) → sku, sat, upc, iva, ieps,
 *     description, measureUnit, measureUnitDescription
 *   - query getFiscalInformationsByItem(itemId, variationId, allVariations)
 *   - mutation updateFiscalInformationMLM(where: {sku}, input: {...})
 *
 * Este explorador prueba las consultas DOCUMENTADAS con un SKU y un item
 * reales del catálogo, y junta el diagnóstico de permisos (usuario del token
 * y datos de la app) para entender un 403: ¿le falta un scope a la app, está
 * suspendido el usuario, o el recurso pide otra cosa? Borrable después.
 */
const CONSULTA_POR_SKU = `query PorSku($sku: String!) {
  getFiscalInformationBySku(sku: $sku) {
    sku
    sat
    upc
    iva
    ieps
    description
    measureUnit
    measureUnitDescription
  }
}`;

const CONSULTA_POR_ITEM = `query PorItem($itemId: String!, $allVariations: Boolean) {
  getFiscalInformationsByItem(itemId: $itemId, allVariations: $allVariations) {
    itemId
    variationId
    type
    components {
      sku
      quantity
      percentageShare
    }
  }
}`;

/** Deja el cuerpo completo del error de MELI, no solo el mensaje recortado. */
function detalleError(err: unknown): Record<string, unknown> {
  if (err instanceof MeliError) {
    return { status: err.status, cuerpo: err.cuerpo ?? err.message.slice(0, 1200) };
  }
  return { error: (err as Error).message.slice(0, 1200) };
}

export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const { data: tok } = await clienteAdmin()
    .from("meli_tokens")
    .select("access_token, refresh_token, expira_en")
    .eq("account_id", cuenta.id)
    .single();
  if (!tok) return NextResponse.json({ error: "Sin tokens de MELI." }, { status: 400 });

  const clientId = process.env.MELI_CLIENT_ID!;
  const cliente = new MeliClient({
    clientId,
    clientSecret: process.env.MELI_CLIENT_SECRET!,
    credenciales: {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiraEn: new Date(tok.expira_en).getTime(),
    },
    alRenovar: async () => {},
  });

  const resultado: Record<string, unknown> = {};

  // 1) Diagnóstico de permisos: a quién pertenece el token y cómo está la app.
  try {
    const yo = (await cliente.get("/users/me")) as Record<string, unknown>;
    resultado.usuarioToken = {
      id: yo.id,
      nickname: yo.nickname,
      site_id: yo.site_id,
      status: yo.status,
    };
  } catch (err) {
    resultado.usuarioToken = detalleError(err);
  }
  try {
    const app = (await cliente.get(`/applications/${clientId}`)) as Record<string, unknown>;
    resultado.app = {
      id: app.id,
      name: app.name,
      scopes: app.scopes,
      active: app.active,
      max_requests_per_hour: app.max_requests_per_hour,
    };
  } catch (err) {
    resultado.app = detalleError(err);
  }

  // 2) La consulta documentada por SKU, con los campos reales de la doc.
  try {
    const { data: unSku } = await supabase
      .from("skus")
      .select("sku, item_id")
      .eq("account_id", cuenta.id)
      .eq("activo", true)
      .not("item_id", "is", null)
      .limit(1)
      .maybeSingle();

    if (unSku?.sku) {
      resultado.skuProbado = unSku.sku;
      try {
        resultado.consultaPorSku = await cliente.post("/fiscal_information/graphql", {
          query: CONSULTA_POR_SKU,
          variables: { sku: unSku.sku },
        });
      } catch (err) {
        resultado.consultaPorSku = detalleError(err);
      }

      // 3) La consulta documentada por item (con todas sus variantes).
      if (unSku.item_id) {
        resultado.itemProbado = unSku.item_id;
        try {
          resultado.consultaPorItem = await cliente.post("/fiscal_information/graphql", {
            query: CONSULTA_POR_ITEM,
            variables: { itemId: unSku.item_id, allVariations: true },
          });
        } catch (err) {
          resultado.consultaPorItem = detalleError(err);
        }
      }
    } else {
      resultado.skuProbado = null;
    }
  } catch (err) {
    resultado.consultaPorSku = detalleError(err);
  }

  return NextResponse.json(resultado);
}
