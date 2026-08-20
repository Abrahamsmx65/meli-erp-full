import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { MeliClient } from "@/lib/meli/client";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaAmazon } from "@/lib/servicios/amazon";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico temporal de la auditoría: ventas por día de la última semana,
 * estado de la reparación del historial, y avance de los pagos de Amazon.
 * Se abre logueado en el navegador y se comparte el JSON. Borrable después.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const desde = new Date(Date.now() - 6 * 3_600_000 - 8 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const inicioMes = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 8) + "01";

  const [ventas, netos, reparacion, amazon] = await Promise.all([
    supabase
      .from("ventas_diarias")
      .select("fecha, unidades, ordenes, importe")
      .eq("account_id", cuenta.id)
      .gte("fecha", desde),
    // Radiografía del neto del MES: cuántas filas tienen neto real, cuántas
    // traen un 0 sospechoso y cuántas siguen sin dato.
    supabase
      .from("ventas_diarias")
      .select("importe, comision, neto, unidades")
      .eq("account_id", cuenta.id)
      .gte("fecha", inicioMes)
      .limit(10000),
    supabase
      .from("sync_log")
      .select("inicio, detalle")
      .eq("account_id", cuenta.id)
      .eq("tarea", "reparacion_ventas_v3")
      .order("inicio", { ascending: false })
      .limit(1)
      .maybeSingle(),
    (async () => {
      const cta = await cuentaAmazon(supabase);
      if (!cta) return { conectado: false };
      const [pagos, logPagos] = await Promise.all([
        supabase
          .from("amazon_pagos")
          .select("fecha, neto")
          .eq("account_id", cta.id),
        supabase
          .from("amazon_sync_log")
          .select("inicio, estado, detalle")
          .eq("account_id", cta.id)
          .eq("tarea", "cron_pagos")
          .order("inicio", { ascending: false })
          .limit(3),
      ]);
      const filas = pagos.data ?? [];
      return {
        conectado: true,
        pagosFilas: filas.length,
        pagosDesde: filas.length ? filas.reduce((a, f) => (f.fecha < a ? f.fecha : a), filas[0].fecha) : null,
        pagosHasta: filas.length ? filas.reduce((a, f) => (f.fecha > a ? f.fecha : a), filas[0].fecha) : null,
        pagosNetoTotal: Math.round(filas.reduce((a, f) => a + (Number(f.neto) || 0), 0)),
        ultimasCorridas: (logPagos.data ?? []).map((l) => ({
          inicio: l.inicio,
          estado: l.estado,
          detalle: l.detalle,
        })),
        errorPagos: pagos.error?.message ?? null,
      };
    })(),
  ]);

  const porDia = new Map<string, { unidades: number; ordenes: number; importe: number }>();
  for (const v of ventas.data ?? []) {
    const d = porDia.get(v.fecha) ?? { unidades: 0, ordenes: 0, importe: 0 };
    d.unidades += v.unidades ?? 0;
    d.ordenes += v.ordenes ?? 0;
    d.importe += v.importe ?? 0;
    porDia.set(v.fecha, d);
  }

  const nf = netos.data ?? [];
  const conNeto = nf.filter((f: any) => f.neto != null && Number(f.neto) > 0);
  const netoCero = nf.filter((f: any) => f.neto != null && Number(f.neto) <= 0);
  const sinNeto = nf.filter((f: any) => f.neto == null);
  const suma = (l: any[], k: string) => Math.round(l.reduce((a, f) => a + (Number(f[k]) || 0), 0));

  // ?probar=YYYY-MM-DD: pregunta a MELI cuántas órdenes pagadas hay en la
  // ventana del día de México, SIN escribir nada. Para verificar que la
  // ventana con offset -06:00 regresa el día completo.
  let prueba: unknown = null;
  const dia = req.nextUrl.searchParams.get("probar");
  if (dia && /^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    try {
      const { data: tok } = await clienteAdmin()
        .from("meli_tokens")
        .select("access_token, refresh_token, expira_en")
        .eq("account_id", cuenta.id)
        .single();
      if (tok) {
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
        const r = await cliente.get<any>("/orders/search", {
          seller: cuenta.meli_user_id,
          "order.date_created.from": `${dia}T00:00:00.000-06:00`,
          "order.date_created.to": `${dia}T23:59:59.999-06:00`,
          "order.status": "paid",
          sort: "date_asc",
          limit: 51,
          offset: 0,
        });
        const lote = r?.results ?? [];
        prueba = {
          dia,
          totalSegunMeli: r?.paging?.total ?? null,
          primeraPagina: lote.length,
          primeraFecha: lote[0]?.date_created ?? null,
          ultimaFechaPagina: lote[lote.length - 1]?.date_created ?? null,
        };
      }
    } catch (err) {
      prueba = { dia, error: (err as Error).message.slice(0, 400) };
    }
  }

  return NextResponse.json({
    prueba,
    netoDelMes: {
      filasConNetoReal: conNeto.length,
      filasConNetoCeroSospechoso: netoCero.length,
      filasSinNeto: sinNeto.length,
      importeConNetoReal: suma(conNeto, "importe"),
      netoRealSumado: suma(conNeto, "neto"),
      importeNetoCero: suma(netoCero, "importe"),
      importeSinNeto: suma(sinNeto, "importe"),
      comisionMes: suma(nf, "comision"),
      importeMes: suma(nf, "importe"),
      unidadesMes: suma(nf, "unidades"),
    },
    ventasMeliPorDia: [...porDia.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([fecha, d]) => ({ fecha, ...d, importe: Math.round(d.importe) })),
    reparacionHistorial: reparacion.data
      ? { ultimaCorrida: reparacion.data.inicio, avance: reparacion.data.detalle }
      : "aún no corre (arranca con el latido, con la app abierta)",
    amazonPagos: amazon,
  });
}
