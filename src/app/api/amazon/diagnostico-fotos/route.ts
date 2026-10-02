import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { Cliente, cuentasAmazon, ErrorAmazon } from "@/lib/amazon/spapi";
import { imagenesDeAsins } from "@/lib/amazon/catalogo";
import { fotosDeAtributos, padreDeAtributos } from "@/lib/amazon/fotos-publicacion";
import { partirEnLotes } from "@/lib/amazon/fnskus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Radiografía de las FOTOS de un modelo en Amazon, SIN guardar nada: qué
 * contesta Listings Items por CADA talla (atributos crudos de la primera,
 * nombres de atributos y fotos de las demás, y el error de cada lote si lo
 * hubo — un lote rechazado se salta en silencio en el camino normal) y qué
 * contesta el catálogo público por los ASIN hijos y el padre. Es la sonda
 * para el caso GT211 (1-oct-2026): el dueño subió fotos y ningún camino
 * las ve.
 *
 *   /api/amazon/diagnostico-fotos?modelo=GT211
 *
 * Entra con sesión o con el bearer del cron (como /api/cron/amazon), para
 * poderla disparar desde la base con pg_net.
 */
export async function GET(req: NextRequest) {
  const admin = clienteAdmin();

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let autorizado = Boolean(user);
  if (!autorizado) {
    const auth = req.headers.get("authorization") ?? "";
    const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (presentado) {
      autorizado = Boolean(process.env.CRON_SECRET) && presentado === process.env.CRON_SECRET;
      if (!autorizado) {
        const { data } = await admin
          .from("app_secretos")
          .select("valor")
          .eq("clave", "cron_amazon")
          .maybeSingle();
        autorizado = Boolean(data?.valor) && presentado === data!.valor;
      }
    }
  }
  if (!autorizado) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const modelo = (req.nextUrl.searchParams.get("modelo") ?? "").trim().toUpperCase();
  // ?sku=A,B pregunta SKUs sueltos tal cual (p. ej. el SKU padre generado
  // por Amazon, V1-KW9T-E95I, que no empieza con el modelo). ?asin=B0…
  // pregunta por ASIN: Amazon contesta TODOS los SKUs del vendedor amarrados
  // a ese ASIN, aunque el ERP no los conozca (un SKU recreado, por ejemplo).
  const skusSueltos = (req.nextUrl.searchParams.get("sku") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9 \/._-]{1,60}$/.test(s));
  const asinsSueltos = (req.nextUrl.searchParams.get("asin") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^B0[A-Z0-9]{8}$/.test(s));
  if (!skusSueltos.length && !asinsSueltos.length && !/^[A-Z0-9]{3,12}$/.test(modelo)) {
    return NextResponse.json(
      { error: "Falta ?modelo=GT211 (o ?sku=A,B, o ?asin=B0…,B0…)." },
      { status: 400 },
    );
  }

  const cuentas = await cuentasAmazon(admin);
  const cuenta = cuentas[0];
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta de Amazon conectada." }, { status: 400 });
  const cliente = new Cliente(cuenta, Date.now() + 100_000);

  const porAsinSuelto = asinsSueltos.length > 0;
  let filas: { seller_sku: string; asin: string | null }[] = porAsinSuelto
    ? asinsSueltos.map((a) => ({ seller_sku: a, asin: a }))
    : skusSueltos.map((s) => ({ seller_sku: s, asin: null }));
  if (!skusSueltos.length && !porAsinSuelto) {
    const { data, error } = await admin
      .from("amazon_listings")
      .select("seller_sku, asin, estado")
      .eq("account_id", cuenta.accountId)
      .ilike("seller_sku", `${modelo}-%`)
      .order("seller_sku");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) {
      return NextResponse.json({ error: `No hay SKUs de ${modelo} en amazon_listings.` }, { status: 404 });
    }
    filas = data;
  }

  const salida: Record<string, unknown> = {
    cuenta: cuenta.nombre,
    marketplace: cuenta.marketplaceId,
    sellerId: cuenta.sellingPartnerId ?? null,
    modelo,
    skus: filas.length,
  };

  // 1. Listings Items por SKU, lote por lote, con el error de cada lote.
  const porSku: Record<string, unknown>[] = [];
  const lotes: Record<string, unknown>[] = [];
  let crudoPrimero: unknown = null;
  if (cuenta.sellingPartnerId) {
    const { lotes: grupos } = partirEnLotes(filas.map((f) => String(f.seller_sku)));
    for (const lote of grupos) {
      try {
        const r = await cliente.llamar<{
          items?: {
            sku?: string;
            attributes?: Record<string, unknown[]>;
            summaries?: { lastUpdatedDate?: string; mainImage?: { link?: string }; status?: string[] }[];
            issues?: { code?: string; message?: string; severity?: string }[];
          }[];
        }>(
          "GET",
          `/listings/2021-08-01/items/${encodeURIComponent(cuenta.sellingPartnerId)}`,
          "searchListingsItems",
          {
            params: {
              marketplaceIds: cuenta.marketplaceId,
              identifiers: lote.join(","),
              identifiersType: porAsinSuelto ? "ASIN" : "SKU",
              pageSize: 20,
              includedData: "attributes,summaries,issues",
            },
          },
        );
        if (r === null) {
          lotes.push({ skus: lote, resultado: "se acabó el plazo" });
          break;
        }
        const contestados = new Set<string>();
        for (const item of r.items ?? []) {
          const sku = String(item.sku ?? "").trim();
          if (!sku) continue;
          contestados.add(sku.toUpperCase());
          const fotos = fotosDeAtributos(item.attributes as never, cuenta.marketplaceId);
          if (crudoPrimero === null) crudoPrimero = item;
          const resumen = item.summaries?.[0];
          porSku.push({
            sku,
            fotos: fotos.length,
            primera: fotos[0] ?? null,
            padre: padreDeAtributos(item.attributes as never),
            mainImage: resumen?.mainImage?.link ?? null,
            actualizado: resumen?.lastUpdatedDate ?? null,
            estado: resumen?.status ?? null,
            issues: (item.issues ?? []).slice(0, 5).map((i) => `${i.severity ?? ""} ${i.code ?? ""}: ${i.message ?? ""}`.trim()),
            atributos: Object.keys(item.attributes ?? {}).sort(),
          });
        }
        const sinContestar = lote.filter((s) => !contestados.has(s.toUpperCase()));
        lotes.push({ skus: lote.length, contestados: contestados.size, sinContestar });
      } catch (err) {
        lotes.push({
          skus: lote,
          error: (err as Error).message,
          status: err instanceof ErrorAmazon ? err.status : null,
        });
      }
    }
  } else {
    salida.aviso = "Sin selling_partner_id: no se puede preguntar Listings Items.";
  }
  salida.listings = { lotes, porSku, crudoPrimero };

  // 2. El catálogo público: los ASIN hijos y el padre.
  const asins = [...new Set(filas.map((f) => String(f.asin ?? "")).filter(Boolean))];
  const { data: padres } = await admin
    .from("amazon_padres")
    .select("asin, parent_asin")
    .eq("account_id", cuenta.accountId)
    .in("asin", asins);
  const asinsPadre = [...new Set((padres ?? []).map((p) => String(p.parent_asin ?? "")).filter(Boolean))];
  try {
    const catalogo = await imagenesDeAsins(cliente, [...asins, ...asinsPadre]);
    salida.catalogo = {
      padres: asinsPadre,
      porAsin: Object.fromEntries(
        [...asins, ...asinsPadre].map((a) => [
          a,
          { fotos: catalogo.get(a)?.length ?? 0, primera: catalogo.get(a)?.[0]?.link ?? null },
        ]),
      ),
    };
  } catch (err) {
    salida.catalogo = { error: (err as Error).message };
  }

  return NextResponse.json(salida);
}
