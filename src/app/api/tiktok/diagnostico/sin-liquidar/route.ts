import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { ErrorTikTok } from "@/lib/tiktok/client";
import { clienteDeCuenta } from "@/lib/servicios/tiktok";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Las rutas candidatas del endpoint «Get Unsettled Transactions» de
 * finanzas de TikTok (la lista oficial lo tiene junto a Get Statements,
 * Get Payments, Get Transactions by Order…; la documentación no se alcanza
 * desde el entorno de Claude). Se prueban todas: la que exista contesta
 * 200; las demás, 36009004 (versión inválida) o 404.
 */
const CANDIDATAS = [
  "/finance/202501/transactions/unsettled",
  "/finance/202309/transactions/unsettled",
  "/finance/202501/unsettled_transactions",
  "/finance/202309/unsettled_transactions",
  "/finance/202501/orders/unsettled_transactions",
  "/finance/202507/transactions/unsettled",
  "/finance/202509/transactions/unsettled",
  "/finance/202506/transactions/unsettled",
];

/**
 * Sonda de las transacciones NO liquidadas de la tienda, sin escribir
 * nada. Le pega a cada ruta candidata con una ventana de 30 días y una
 * página chica, y contesta por ruta: si existió, qué llaves trae y los
 * primeros dos renglones crudos. Es para ver con qué forma llega lo que
 * TikTok todavía no paga (25-sep-2026: por pedido, `…/orders/{id}/
 * statement_transactions` contesta vacío hasta que liquida).
 *
 *   /api/tiktok/diagnostico/sin-liquidar
 *   /api/tiktok/diagnostico/sin-liquidar?dias=60&pagina=50
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const dias = Math.max(1, Number(req.nextUrl.searchParams.get("dias") ?? 30) || 30);
  const pagina = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get("pagina") ?? 5) || 5));
  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id, 100_000);
  if (!cliente || !cliente.tienda.shopCipher) return NextResponse.json({ error: "TikTok Shop no está conectado." }, { status: 400 });

  const ahora = Math.floor(Date.now() / 1000);
  const desde = ahora - dias * 86_400;
  const resultado: Record<string, unknown> = { ventana: { desde, hasta: ahora, dias }, rutas: {} as Record<string, unknown> };
  const rutas = resultado.rutas as Record<string, unknown>;
  for (const ruta of CANDIDATAS) {
    try {
      const d = await cliente.llamar<any>("GET", ruta, {
        params: { page_size: pagina, search_time_ge: desde, search_time_lt: ahora, sort_field: "order_create_time", sort_order: "DESC" },
      });
      const lista = d && typeof d === "object" ? Object.values(d).find((v) => Array.isArray(v)) : null;
      rutas[ruta] = {
        existe: true,
        llaves: d && typeof d === "object" ? Object.keys(d) : null,
        total: (d as any)?.total_count ?? null,
        renglones: Array.isArray(lista) ? lista.length : null,
        primeros: Array.isArray(lista) ? lista.slice(0, 2) : d,
      };
    } catch (err) {
      const e = err as ErrorTikTok;
      rutas[ruta] = { existe: false, codigo: e instanceof ErrorTikTok ? e.codigo : null, error: (err as Error).message.slice(0, 300) };
    }
  }
  return NextResponse.json(resultado);
}
