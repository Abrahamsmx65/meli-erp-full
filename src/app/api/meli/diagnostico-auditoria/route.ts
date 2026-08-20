import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaAmazon } from "@/lib/servicios/amazon";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico temporal de la auditoría: ventas por día de la última semana,
 * estado de la reparación del historial, y avance de los pagos de Amazon.
 * Se abre logueado en el navegador y se comparte el JSON. Borrable después.
 */
export async function GET() {
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

  return NextResponse.json({
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
