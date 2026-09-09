import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { Cliente, cuentasAmazon } from "@/lib/amazon/spapi";
import { cascadaDePedido, clasificarEventos, eventosDePedido, eventosDesde, gruposFinancieros, paginaDeEventosDeGrupo } from "@/lib/amazon/finanzas";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Radiografía del dinero de Amazon tal como lo asienta la Finances API,
 * SIN guardar nada. Es la sonda previa a rehacer las ventas de Amazon con
 * números reales por pedido (hoy salen de agregados: SKU Economics y las
 * liquidaciones colapsadas en una sola columna).
 *
 *   /api/amazon/diagnostico-finanzas?pedido=702-1234567-1234567
 *
 * Devuelve: los eventos del pedido (venta y reembolsos) crudos y
 * clasificados (principal, impuesto, comisión, FBA, retenido, promociones,
 * neto), una página de eventos recientes para ver qué otras listas trae
 * Amazon (ProductAdsPayment, ServiceFee…), y los grupos de liquidación de
 * los últimos 120 días con su total y estado de transferencia (para ver si
 * falta alguna liquidación, que es la sospecha de "julio al 10 %").
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const pedido = (req.nextUrl.searchParams.get("pedido") ?? "").trim();
  if (pedido && !/^\d{3}-\d{7}-\d{7}$/.test(pedido)) {
    return NextResponse.json({ error: "El pedido de Amazon tiene la forma 702-1234567-1234567." }, { status: 400 });
  }
  const grupo = (req.nextUrl.searchParams.get("grupo") ?? "").trim();

  // Las credenciales viven en amazon_tokens (solo service_role); la sesión
  // ya validó quién pregunta.
  const cuentas = await cuentasAmazon(clienteAdmin());
  const cuenta = cuentas[0];
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta de Amazon conectada." }, { status: 400 });
  const cliente = new Cliente(cuenta, Date.now() + 100_000);

  const salida: Record<string, unknown> = { cuenta: cuenta.nombre, marketplace: cuenta.marketplaceId };

  if (pedido) {
    try {
      const eventos = await eventosDePedido(cliente, pedido);
      salida.pedido = {
        id: pedido,
        listas: eventos ? Object.keys(eventos).filter((k) => Array.isArray((eventos as Record<string, unknown>)[k]) && ((eventos as Record<string, unknown>)[k] as unknown[]).length) : [],
        cascada: eventos ? cascadaDePedido(eventos) : null,
        crudo: eventos,
      };
    } catch (err) {
      salida.pedido = { id: pedido, error: (err as Error).message };
    }
  }

  // ?grupo=<id>: la primera página de eventos de un grupo de liquidación,
  // clasificada como la guarda la ingesta (para ver qué listas trae un
  // grupo y si alguna queda sin clasificar).
  if (grupo) {
    try {
      const pagina = await paginaDeEventosDeGrupo(cliente, grupo);
      const eventos = pagina ? clasificarEventos(pagina.eventos) : [];
      const porLista: Record<string, { eventos: number; monto: number; sinClasificar: number }> = {};
      for (const e of eventos) {
        const p = (porLista[e.lista] ??= { eventos: 0, monto: 0, sinClasificar: 0 });
        p.eventos++;
        p.monto = Math.round((p.monto + (e.monto ?? 0)) * 100) / 100;
        if (!e.clasificado) p.sinClasificar++;
      }
      salida.grupo = {
        id: grupo,
        hayMasPaginas: Boolean(pagina?.siguiente),
        porLista,
        sinClasificar: eventos.filter((e) => !e.clasificado).map((e) => ({ lista: e.lista, crudo: e.crudo })).slice(0, 5),
        muestraOtros: eventos.filter((e) => !e.cascada).slice(0, 10),
      };
    } catch (err) {
      salida.grupo = { id: grupo, error: (err as Error).message };
    }
  }

  try {
    const desde = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const grupos = await gruposFinancieros(cliente, desde);
    salida.liquidaciones = grupos.map((g) => ({
      id: g.FinancialEventGroupId,
      inicio: g.FinancialEventGroupStart,
      fin: g.FinancialEventGroupEnd,
      estado: g.ProcessingStatus,
      transferencia: g.FundTransferStatus,
      transferidoEn: g.FundTransferDate,
      total: g.OriginalTotal?.CurrencyAmount ?? null,
      moneda: g.OriginalTotal?.CurrencyCode ?? null,
    }));
  } catch (err) {
    salida.liquidaciones = { error: (err as Error).message };
  }

  try {
    const hace7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const muestra = await eventosDesde(cliente, hace7, 20);
    salida.muestraReciente = muestra
      ? {
          listas: Object.fromEntries(
            Object.entries(muestra)
              .filter(([, v]) => Array.isArray(v) && v.length)
              .map(([k, v]) => [k, (v as unknown[]).length]),
          ),
          publicidad: (muestra.ProductAdsPaymentEventList ?? []).slice(0, 5),
          cargosDeServicio: (muestra.ServiceFeeEventList ?? []).slice(0, 5),
          primerEnvio: (muestra.ShipmentEventList ?? [])[0] ?? null,
        }
      : null;
  } catch (err) {
    salida.muestraReciente = { error: (err as Error).message };
  }

  return NextResponse.json(salida, { headers: { "Cache-Control": "no-store" } });
}
