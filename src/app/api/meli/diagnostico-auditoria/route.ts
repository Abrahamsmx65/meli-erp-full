import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { MeliClient } from "@/lib/meli/client";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
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

  // OJO: estas dos lecturas van PAGINADAS con traerTodo. Con la consulta
  // plana, Supabase corta en 1,000 filas y una semana de ventas trae más:
  // el diagnóstico mostraba días "encogidos" o "vacíos" que en la base
  // estaban completos, y nos tuvo persiguiendo un fantasma que no existía.
  const [ventas, netos, reparacion, reparacionNetos, barridos, amazon] = await Promise.all([
    traerTodo<any>(supabase, "ventas_diarias", "fecha, unidades, ordenes, importe", (q) =>
      q.eq("account_id", cuenta.id).gte("fecha", desde),
    ),
    // Radiografía del neto del MES: cuántas filas tienen neto real, cuántas
    // traen un 0 sospechoso y cuántas siguen sin dato.
    traerTodo<any>(supabase, "ventas_diarias", "importe, comision, neto, unidades", (q) =>
      q.eq("account_id", cuenta.id).gte("fecha", inicioMes),
    ),
    supabase
      .from("sync_log")
      .select("inicio, detalle")
      .eq("account_id", cuenta.id)
      .eq("tarea", "reparacion_ventas_v7")
      .order("inicio", { ascending: false })
      .limit(4),
    supabase
      .from("sync_log")
      .select("inicio, detalle")
      .eq("account_id", cuenta.id)
      .eq("tarea", "reparacion_netos_v2")
      .order("inicio", { ascending: false })
      .limit(3),
    supabase
      .from("sync_log")
      .select("inicio, detalle")
      .eq("account_id", cuenta.id)
      .eq("tarea", "barrido_dia")
      .order("inicio", { ascending: false })
      .limit(25),
    (async () => {
      const cta = await cuentaAmazon(supabase);
      if (!cta) return { conectado: false };
      const [conteo, primera, ultima, netosPagos, logPagos] = await Promise.all([
        supabase
          .from("amazon_pagos")
          .select("fecha", { count: "exact", head: true })
          .eq("account_id", cta.id),
        supabase
          .from("amazon_pagos")
          .select("fecha")
          .eq("account_id", cta.id)
          .order("fecha", { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("amazon_pagos")
          .select("fecha")
          .eq("account_id", cta.id)
          .order("fecha", { ascending: false })
          .limit(1)
          .maybeSingle(),
        traerTodo<any>(supabase, "amazon_pagos", "neto", (q) => q.eq("account_id", cta.id)),
        supabase
          .from("amazon_sync_log")
          .select("inicio, estado, detalle")
          .eq("account_id", cta.id)
          .in("tarea", ["cron_pagos", "cron_economia"])
          .order("inicio", { ascending: false })
          .limit(6),
      ]);
      return {
        conectado: true,
        pagosFilas: conteo.count ?? 0,
        pagosDesde: primera.data?.fecha ?? null,
        pagosHasta: ultima.data?.fecha ?? null,
        pagosNetoTotal: Math.round(
          (netosPagos ?? []).reduce((a: number, f: any) => a + (Number(f.neto) || 0), 0),
        ),
        ultimasCorridas: (logPagos.data ?? []).map((l) => ({
          inicio: l.inicio,
          estado: l.estado,
          detalle: l.detalle,
        })),
        errorPagos: conteo.error?.message ?? null,
      };
    })(),
  ]);

  const porDia = new Map<string, { unidades: number; ordenes: number; importe: number }>();
  for (const v of ventas ?? []) {
    const d = porDia.get(v.fecha) ?? { unidades: 0, ordenes: 0, importe: 0 };
    d.unidades += v.unidades ?? 0;
    d.ordenes += v.ordenes ?? 0;
    d.importe += v.importe ?? 0;
    porDia.set(v.fecha, d);
  }

  const nf = netos ?? [];
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
        // La MISMA ventana y formato que usa el barrido (UTC), y varias
        // páginas: verifica que la paginación llegue al total.
        const desdeP = new Date(`${dia}T00:00:00.000-06:00`).toISOString();
        const hastaP = new Date(`${dia}T23:59:59.999-06:00`).toISOString();
        const paginas: { offset: number; filas: number; primera: string | null }[] = [];
        let totalSegunMeli: number | null = null;
        let leidas = 0;
        for (const offset of [0, 51, 102, 510, 1020]) {
          const r = await cliente.get<any>("/orders/search", {
            seller: cuenta.meli_user_id,
            "order.date_created.from": desdeP,
            "order.date_created.to": hastaP,
            "order.status": "paid",
            sort: "date_asc",
            limit: 51,
            offset,
          });
          const lote = r?.results ?? [];
          if (offset === 0) totalSegunMeli = r?.paging?.total ?? null;
          leidas += lote.length;
          paginas.push({ offset, filas: lote.length, primera: lote[0]?.date_created ?? null });
          if (!lote.length) break;
        }
        prueba = { dia, ventana: [desdeP, hastaP], totalSegunMeli, paginas, leidas };
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
    barridosRecientes: (barridos.data ?? []).map((b: any) => ({ en: b.inicio, ...b.detalle })),
    reparacionHistorial: reparacion.data?.length
      ? (reparacion.data as any[]).map((r) => ({ corrida: r.inicio, avance: r.detalle }))
      : "aún no corre (arranca con el latido, con la app abierta)",
    reparacionNetos: reparacionNetos.data?.length
      ? (reparacionNetos.data as any[]).map((r) => ({ corrida: r.inicio, avance: r.detalle }))
      : "aún no corre (arranca cuando la reparación del historial termina)",
    amazonPagos: amazon,
  });
}
