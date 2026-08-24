import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { MeliClient } from "@/lib/meli/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Explorador TEMPORAL del API de datos fiscales de MELI (solo México):
 * https://api.mercadolibre.com/fiscal_information/graphql
 *
 * La documentación pública no se puede leer desde este entorno, así que se
 * le pregunta el esquema AL PROPIO API (introspección GraphQL): qué
 * consultas y mutaciones existen y con qué campos. También intenta leer la
 * información fiscal de un SKU real del catálogo, para ver la forma de una
 * respuesta de verdad. Con ese JSON se construye la edición masiva sin
 * suponer un solo campo. Borrable después.
 */
const INTROSPECCION = `query Esquema {
  __schema {
    queryType {
      fields {
        name
        args { name type { kind name ofType { kind name } } }
        type { kind name ofType { kind name } }
      }
    }
    mutationType {
      fields {
        name
        args { name type { kind name ofType { kind name } } }
        type { kind name ofType { kind name } }
      }
    }
  }
}`;

const TIPOS = `query Tipos {
  __schema {
    types {
      kind
      name
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
      fields { name type { kind name ofType { kind name ofType { kind name } } } }
    }
  }
}`;

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

  const cliente = new MeliClient({
    clientId: process.env.MELI_CLIENT_ID!,
    clientSecret: process.env.MELI_CLIENT_SECRET!,
    credenciales: {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiraEn: new Date(tok.expira_en).getTime(),
    },
    alRenovar: async () => {},
  });

  const resultado: Record<string, unknown> = {};

  // 1) Qué consultas y mutaciones expone el API.
  try {
    resultado.esquema = await cliente.post("/fiscal_information/graphql", {
      query: INTROSPECCION,
    });
  } catch (err) {
    resultado.esquema = { error: (err as Error).message.slice(0, 600) };
  }

  // 2) Los tipos completos (campos de entrada de las mutaciones incluidos).
  //    Puede ser grande: se recorta a los tipos propios (sin __internos).
  try {
    const tipos = (await cliente.post("/fiscal_information/graphql", {
      query: TIPOS,
    })) as any;
    const lista = tipos?.data?.__schema?.types ?? [];
    resultado.tipos = lista.filter(
      (t: any) => t?.name && !String(t.name).startsWith("__") &&
        (t.inputFields?.length || t.fields?.length),
    );
  } catch (err) {
    resultado.tipos = { error: (err as Error).message.slice(0, 600) };
  }

  // 3) La información fiscal de un SKU real, para ver una respuesta viva.
  try {
    const { data: unSku } = await supabase
      .from("skus")
      .select("sku")
      .eq("account_id", cuenta.id)
      .eq("activo", true)
      .limit(1)
      .maybeSingle();
    if (unSku?.sku) {
      resultado.skuProbado = unSku.sku;
      resultado.consultaSku = await cliente.post("/fiscal_information/graphql", {
        query: `query PorSku($sku: String!) { getFiscalInformationBySku(sku: $sku) { __typename } }`,
        variables: { sku: unSku.sku },
      });
    }
  } catch (err) {
    resultado.consultaSku = { error: (err as Error).message.slice(0, 600) };
  }

  return NextResponse.json(resultado);
}
