import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { cargarMonitor, fechaMx } from "@/lib/servicios/ventas-monitor";
import { modeloDeSku } from "@/lib/tiktok/ventas";
import {
  factorNeto,
  netoTikTok,
  parametrosDesde,
  PARAMETROS_POR_OMISION,
  renglonesDePrecio,
  type EntradaModelo,
  type ParametrosPrecioTikTok,
} from "@/lib/tiktok/precios";
import { Ficha } from "@/components/tiles";
import { TablaPreciosTikTok } from "@/components/tabla-precios-tiktok";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pesosC(x: number): string {
  return "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DIAS_POR_OMISION = 30;
/** Días de pedidos de TikTok para el precio real pagado (ofertas y relámpagos incluidos). */
const DIAS_PRECIO_REAL = 14;

const CAMPOS: { clave: keyof ParametrosPrecioTikTok; nombre: string; unidad: string; paso: string }[] = [
  { clave: "comisionPct", nombre: "Comisión de TikTok", unidad: "% del precio", paso: "0.1" },
  { clave: "cargoPorPar", nombre: "Cargo fijo por par", unidad: "$", paso: "0.5" },
  { clave: "afiliadoPct", nombre: "Afiliados (creadores)", unidad: "% del precio", paso: "0.5" },
  { clave: "ivaRetenidoPct", nombre: "IVA retenido", unidad: "% de la base sin IVA", paso: "0.5" },
  { clave: "isrRetenidoPct", nombre: "ISR retenido", unidad: "% de la base sin IVA", paso: "0.1" },
  { clave: "ivaPct", nombre: "IVA de la venta", unidad: "%", paso: "1" },
  { clave: "envioPct", nombre: "Envío que pago", unidad: "% del precio", paso: "0.5" },
  { clave: "empaquePorPar", nombre: "Empaque", unidad: "$ por par", paso: "0.5" },
  { clave: "escalonPct", nombre: "Escalón entre niveles", unidad: "%", paso: "0.5" },
];

/**
 * Precios para TikTok: por modelo, el precio que deja el MISMO neto por par
 * que deja MELI, descontando lo que TikTok cobra. Tres niveles (relámpago
 * live, relámpago normal +5 %, campaña regular +5 % más). Los parámetros
 * van en la URL para cambiarlos y compartirlos; el neto de MELI sale del
 * monitor de ventas (depósito real, nada estimado) del periodo elegido.
 * Lleva netos de MELI y costos; desde el 2-oct-2026 también la ve el rol
 * de TikTok (dueño: «acceso a todas las secciones adentro de TikTok»).
 */
export default async function PreciosTikTok({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta || !user) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre primero</h1>
      </div>
    );
  }

  const p = parametrosDesde(sp);
  const diasRaw = Number(Array.isArray(sp.dias) ? sp.dias[0] : sp.dias);
  const dias = Number.isInteger(diasRaw) && diasRaw >= 7 && diasRaw <= 180 ? diasRaw : DIAS_POR_OMISION;
  const rango = { desde: fechaMx(dias - 1), hasta: fechaMx(0) };

  const admin = clienteAdmin();
  // «TikTok hoy» es el precio REAL que pagan los clientes en los pedidos de
  // los últimos días (relámpagos y ofertas incluidos), no el de lista del
  // catálogo (dueño, 1-oct-2026: «toma el real que está en oferta, no el
  // precio base»); el de lista solo cuando el modelo no vendió.
  const desdePedidos = new Date(Date.now() - DIAS_PRECIO_REAL * 86_400_000).toISOString();
  const [monitor, costosRaw, skusTikTok, pedidosRpc, relampagoRpc, misPreciosRaw] = await Promise.all([
    cargarMonitor(admin, cuenta.id, rango),
    traerTodo<any>(admin, "productos_config", "modelo, costo_mxn", (q) => q.eq("account_id", cuenta.id).not("costo_mxn", "is", null)),
    traerTodo<any>(admin, "tiktok_skus", "sku_interno, seller_sku, precio, activo", (q) => q.eq("account_id", cuenta.id).eq("activo", true).not("precio", "is", null)),
    admin.rpc("tiktok_ventas_pedidos", { p_account: cuenta.id, p_desde: desdePedidos, p_hasta: new Date(Date.now() + 86_400_000).toISOString() }),
    // El RELÁMPAGO de MELI por modelo: el escalón de precio más bajo con
    // volumen y su neto por par (dueño, 1-oct-2026: «el neto de cuando se
    // vende el relámpago»; el GT148 relámpago $128.99 deja $128.99).
    admin.rpc("meli_neto_relampago_por_modelo", { p_account: cuenta.id, p_desde: rango.desde }),
    traerTodo<any>(admin, "tiktok_precios_objetivo", "modelo, precio, quitar_retencion", (q) => q.eq("account_id", cuenta.id)),
  ]);
  if (relampagoRpc.error) throw new Error(`meli_neto_relampago_por_modelo: ${relampagoRpc.error.message}`);
  const relampago = new Map<string, { precio: number | null; pares: number; neto: number | null; paresTotal: number; netoTotal: number | null }>();
  for (const f of (relampagoRpc.data ?? []) as any[]) {
    relampago.set(String(f.modelo).toUpperCase(), {
      precio: f.precio_relampago != null ? Number(f.precio_relampago) : null,
      pares: Number(f.pares_relampago ?? 0) || 0,
      neto: f.neto_relampago != null ? Number(f.neto_relampago) : null,
      paresTotal: Number(f.pares_total ?? 0) || 0,
      netoTotal: f.neto_total != null ? Number(f.neto_total) : null,
    });
  }
  const misPrecios = new Map<string, number>();
  // Modelos que el dueño pidió calcular como si MELI retuviera el 10.5 % (2-oct-2026).
  const quitarRetencion = new Set<string>();
  for (const f of misPreciosRaw ?? []) {
    const modelo = String(f.modelo ?? "").toUpperCase();
    if (!modelo) continue;
    const precio = Number(f.precio);
    if (Number.isFinite(precio) && precio > 0) misPrecios.set(modelo, precio);
    if (f.quitar_retencion) quitarRetencion.add(modelo);
  }

  const costoDe = new Map<string, number>();
  for (const c of costosRaw ?? []) {
    const modelo = String(c.modelo ?? "").toUpperCase();
    if (modelo && c.costo_mxn != null && !costoDe.has(modelo)) costoDe.set(modelo, Number(c.costo_mxn));
  }
  const precioLista = new Map<string, { suma: number; n: number }>();
  for (const s of skusTikTok ?? []) {
    const modelo = modeloDeSku(s.sku_interno ?? s.seller_sku ?? "");
    const precio = Number(s.precio);
    if (!modelo || !Number.isFinite(precio) || precio <= 0) continue;
    const acc = precioLista.get(modelo) ?? { suma: 0, n: 0 };
    acc.suma += precio;
    acc.n += 1;
    precioLista.set(modelo, acc);
  }
  const precioPagado = new Map<string, { suma: number; pares: number }>();
  if (!pedidosRpc.error) {
    const fuera = new Set<string>();
    for (const o of (pedidosRpc.data?.ordenes ?? []) as any[]) {
      const estado = String(o.estado ?? "").toUpperCase();
      if (estado.startsWith("CANCEL") || estado === "UNPAID" || o.esMuestra) fuera.add(String(o.orderId));
    }
    for (const r of (pedidosRpc.data?.renglones ?? []) as any[]) {
      if (fuera.has(String(r.orderId)) || String(r.estado ?? "").toUpperCase().startsWith("CANCEL")) continue;
      const modelo = modeloDeSku(r.skuInterno ?? r.sellerSku ?? "");
      const precio = Number(r.precio);
      const pares = Number(r.cantidad ?? 0) || 0;
      if (!modelo || !Number.isFinite(precio) || precio <= 0 || pares <= 0) continue;
      const acc = precioPagado.get(modelo) ?? { suma: 0, pares: 0 };
      acc.suma += precio * pares;
      acc.pares += pares;
      precioPagado.set(modelo, acc);
    }
  }

  const entradas = new Map<string, EntradaModelo>();
  const nueva = (modelo: string, categoria: string | null = null): EntradaModelo => {
    const r = relampago.get(modelo);
    return {
      modelo,
      categoria,
      paresMeli: r?.paresTotal ?? 0,
      netoMeli: r && r.netoTotal != null ? r.netoTotal * r.paresTotal : 0,
      precioRelampagoMeli: r?.precio ?? null,
      paresRelampago: r?.pares ?? 0,
      netoRelampago: r?.neto ?? null,
      miPrecio: misPrecios.get(modelo) ?? null,
      quitarRetencion: quitarRetencion.has(modelo),
      costo: costoDe.get(modelo) ?? null,
      precioTikTok: null,
    };
  };
  for (const m of monitor.porModelo) {
    const modelo = m.modelo.toUpperCase();
    entradas.set(modelo, nueva(modelo, m.categoria));
  }
  for (const modelo of relampago.keys()) if (!entradas.has(modelo)) entradas.set(modelo, nueva(modelo));
  for (const modelo of [...misPrecios.keys(), ...quitarRetencion]) if (!entradas.has(modelo)) entradas.set(modelo, nueva(modelo));
  for (const modelo of new Set([...precioLista.keys(), ...precioPagado.keys()])) {
    const e = entradas.get(modelo) ?? nueva(modelo);
    const pagado = precioPagado.get(modelo);
    const lista = precioLista.get(modelo);
    if (pagado && pagado.pares > 0) {
      e.precioTikTok = pagado.suma / pagado.pares;
      e.origenPrecio = "pedidos";
    } else if (lista) {
      e.precioTikTok = lista.suma / lista.n;
      e.origenPrecio = "lista";
    }
    entradas.set(modelo, e);
  }
  const renglones = renglonesDePrecio([...entradas.values()], p);
  const conObjetivo = renglones.filter((r) => r.niveles);
  const conMiPrecio = renglones.filter((r) => r.origenNivel === "mi-precio").length;
  const enTikTok = renglones.filter((r) => r.precioTikTok != null);
  const porDebajo = enTikTok.filter((r) => r.niveles && (r.precioTikTok as number) < r.niveles[1].precio).length;
  const k = factorNeto(p);
  const ejemplo = netoTikTok(500, p);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="titulo-pagina">Precios para TikTok</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            El precio que deja en TikTok el mismo neto por par que deja el RELÁMPAGO de MELI ({rango.desde} → {rango.hasta}, depósito real
            de Mercado Pago), o el precio que tú pongas.
          </p>
        </div>
      </div>

      <form method="get" className="tarjeta p-4">
        <div className="flex flex-wrap items-end gap-3">
          {CAMPOS.map((c) => (
            <label key={c.clave} className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
              <span>
                {c.nombre} <span style={{ color: "var(--ink-muted)" }}>({c.unidad})</span>
              </span>
              <input name={c.clave} type="number" step={c.paso} min="0" defaultValue={p[c.clave]} className="mt-1 w-32 rounded-lg border px-2 py-1.5 text-sm" />
            </label>
          ))}
          <label className="flex flex-col text-xs" style={{ color: "var(--ink-2)" }}>
            <span>Días de MELI</span>
            <input name="dias" type="number" step="1" min="7" max="180" defaultValue={dias} className="mt-1 w-24 rounded-lg border px-2 py-1.5 text-sm" />
          </label>
          <button type="submit" className="boton-primario">
            Recalcular
          </button>
          <a href="/tiktok/precios" className="text-xs underline" style={{ color: "var(--ink-2)" }}>
            Volver a los de omisión
          </a>
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
          Por cada par vendido a $500: {pesosC(ejemplo.comision)} de comisión + {pesosC(ejemplo.cargo)} fijos + {pesosC(ejemplo.afiliado)} de
          afiliados + {pesosC(ejemplo.envio)} de envío + {pesosC(ejemplo.ivaRetenido + ejemplo.isrRetenido)} de IVA e ISR retenidos +{" "}
          {pesosC(ejemplo.empaque)} de empaque: me quedan {pesosC(ejemplo.neto)}. Del precio llega el {Math.round(k * 1000) / 10} % menos lo
          fijo. Por omisión: comisión {PARAMETROS_POR_OMISION.comisionPct} % (todavía no la cobran, pero va a empezar), ${PARAMETROS_POR_OMISION.cargoPorPar} por par,
          afiliados {PARAMETROS_POR_OMISION.afiliadoPct} % fijo aunque la comisión real sea otra, envío {PARAMETROS_POR_OMISION.envioPct} %, IVA{" "}
          {PARAMETROS_POR_OMISION.ivaRetenidoPct} % e ISR {PARAMETROS_POR_OMISION.isrRetenidoPct} % sobre la base sin IVA y ${PARAMETROS_POR_OMISION.empaquePorPar} de
          empaque por par.
        </p>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Ficha titulo="Modelos con objetivo" valor={n(conObjetivo.length)} nota={`${n(conMiPrecio)} con tu precio · el resto por el relámpago de MELI en ${dias} días`} />
        <Ficha titulo="Publicados en TikTok" valor={n(enTikTok.length)} nota="con precio activo en TikTok" />
        <Ficha
          titulo="Hoy por debajo del normal"
          valor={n(porDebajo)}
          nota="el precio real de TikTok deja menos que MELI"
          tono={porDebajo ? "alerta" : "bien"}
        />
        <Ficha titulo="Escalón" valor={`${p.escalonPct}%`} nota="live abajo del normal · campaña arriba del normal" />
      </div>

      <TablaPreciosTikTok renglones={renglones} escalonPct={p.escalonPct} diasPrecioReal={DIAS_PRECIO_REAL} retencionPct={p.ivaRetenidoPct + p.isrRetenidoPct} />
    </div>
  );
}
