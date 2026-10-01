import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { rolDeSesion } from "@/lib/acceso/roles";
import { cargarMonitor, fechaMx } from "@/lib/servicios/ventas-monitor";
import { modeloDeSku } from "@/lib/tiktok/ventas";
import {
  factorNeto,
  netoTikTok,
  NOMBRES_NIVEL,
  parametrosDesde,
  PARAMETROS_POR_OMISION,
  renglonesDePrecio,
  type EntradaModelo,
  type ParametrosPrecioTikTok,
} from "@/lib/tiktok/precios";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}
function pesosC(x: number): string {
  return "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DIAS_POR_OMISION = 30;

const CAMPOS: { clave: keyof ParametrosPrecioTikTok; nombre: string; unidad: string; paso: string }[] = [
  { clave: "comisionPct", nombre: "Comisión de TikTok", unidad: "% del precio", paso: "0.1" },
  { clave: "cargoPorPar", nombre: "Cargo fijo por par", unidad: "$", paso: "0.5" },
  { clave: "afiliadoPct", nombre: "Afiliados (creadores)", unidad: "% del precio", paso: "0.5" },
  { clave: "ivaRetenidoPct", nombre: "IVA retenido", unidad: "% de la base sin IVA", paso: "0.5" },
  { clave: "isrRetenidoPct", nombre: "ISR retenido", unidad: "% de la base sin IVA", paso: "0.1" },
  { clave: "ivaPct", nombre: "IVA de la venta", unidad: "%", paso: "1" },
  { clave: "envioPorPedido", nombre: "Envío que pago por pedido", unidad: "$ (ya con subsidio)", paso: "1" },
  { clave: "escalonPct", nombre: "Escalón entre niveles", unidad: "%", paso: "0.5" },
];

/**
 * Precios para TikTok: por modelo, el precio que deja el MISMO neto por par
 * que deja MELI, descontando lo que TikTok cobra. Tres niveles (relámpago
 * live, relámpago normal +5 %, campaña regular +5 % más). Los parámetros
 * van en la URL para cambiarlos y compartirlos; el neto de MELI sale del
 * monitor de ventas (depósito real, nada estimado) del periodo elegido.
 * Solo el dueño: lleva netos de MELI y costos.
 */
export default async function PreciosTikTok({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta || rolDeSesion(user) !== "dueño") {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Esta pantalla es del dueño</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Lleva lo que deja MELI por par y los costos.
        </p>
      </div>
    );
  }

  const p = parametrosDesde(sp);
  const diasRaw = Number(Array.isArray(sp.dias) ? sp.dias[0] : sp.dias);
  const dias = Number.isInteger(diasRaw) && diasRaw >= 7 && diasRaw <= 180 ? diasRaw : DIAS_POR_OMISION;
  const rango = { desde: fechaMx(dias - 1), hasta: fechaMx(0) };

  const admin = clienteAdmin();
  const [monitor, costosRaw, skusTikTok] = await Promise.all([
    cargarMonitor(admin, cuenta.id, rango),
    traerTodo<any>(admin, "productos_config", "modelo, costo_mxn", (q) => q.eq("account_id", cuenta.id).not("costo_mxn", "is", null)),
    traerTodo<any>(admin, "tiktok_skus", "sku_interno, seller_sku, precio, activo", (q) => q.eq("account_id", cuenta.id).eq("activo", true).not("precio", "is", null)),
  ]);

  const costoDe = new Map<string, number>();
  for (const c of costosRaw ?? []) {
    const modelo = String(c.modelo ?? "").toUpperCase();
    if (modelo && c.costo_mxn != null && !costoDe.has(modelo)) costoDe.set(modelo, Number(c.costo_mxn));
  }
  const precioTikTok = new Map<string, { suma: number; n: number }>();
  for (const s of skusTikTok ?? []) {
    const modelo = modeloDeSku(s.sku_interno ?? s.seller_sku ?? "");
    const precio = Number(s.precio);
    if (!modelo || !Number.isFinite(precio) || precio <= 0) continue;
    const acc = precioTikTok.get(modelo) ?? { suma: 0, n: 0 };
    acc.suma += precio;
    acc.n += 1;
    precioTikTok.set(modelo, acc);
  }

  const entradas = new Map<string, EntradaModelo>();
  for (const m of monitor.porModelo) {
    const modelo = m.modelo.toUpperCase();
    entradas.set(modelo, {
      modelo,
      categoria: m.categoria,
      paresMeli: m.unidades7,
      netoMeli: m.neto7,
      costo: costoDe.get(modelo) ?? null,
      precioTikTok: null,
    });
  }
  for (const [modelo, acc] of precioTikTok) {
    const e = entradas.get(modelo) ?? { modelo, categoria: null, paresMeli: 0, netoMeli: 0, costo: costoDe.get(modelo) ?? null, precioTikTok: null };
    e.precioTikTok = acc.suma / acc.n;
    entradas.set(modelo, e);
  }
  const renglones = renglonesDePrecio([...entradas.values()], p);
  const conObjetivo = renglones.filter((r) => r.niveles);
  const enTikTok = renglones.filter((r) => r.precioTikTok != null);
  const porDebajo = enTikTok.filter((r) => r.niveles && (r.precioTikTok as number) < r.niveles[0].precio).length;
  const k = factorNeto(p);
  const ejemplo = netoTikTok(500, p);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="titulo-pagina">Precios para TikTok</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            El precio que deja en TikTok el mismo neto por par que deja MELI ({rango.desde} → {rango.hasta}, depósito real de Mercado Pago).
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
          Por cada par vendido a $500, TikTok se queda {pesosC(ejemplo.comision)} de comisión + {pesosC(ejemplo.cargo)} fijos +{" "}
          {pesosC(ejemplo.afiliado)} de afiliados + {pesosC(ejemplo.ivaRetenido + ejemplo.isrRetenido)} de IVA e ISR retenidos +{" "}
          {pesosC(ejemplo.envio)} de envío: me paga {pesosC(ejemplo.neto)}. Del precio llega el {Math.round(k * 1000) / 10} % menos lo fijo.
          Afiliados al {p.afiliadoPct} % fijo aunque la comisión real sea otra (regla del dueño). Los de omisión son los de TikTok MX
          verificados en lo liquidado: {PARAMETROS_POR_OMISION.comisionPct} % + ${PARAMETROS_POR_OMISION.cargoPorPar} por par, IVA{" "}
          {PARAMETROS_POR_OMISION.ivaRetenidoPct} % e ISR {PARAMETROS_POR_OMISION.isrRetenidoPct} % sobre la base sin IVA, envío ~$
          {PARAMETROS_POR_OMISION.envioPorPedido}.
        </p>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Ficha titulo="Modelos con neto de MELI" valor={n(conObjetivo.length)} nota={`vendieron en MELI en ${dias} días`} />
        <Ficha titulo="Publicados en TikTok" valor={n(enTikTok.length)} nota="con precio activo en TikTok" />
        <Ficha
          titulo="Hoy por debajo del live"
          valor={n(porDebajo)}
          nota="el precio actual de TikTok deja menos que MELI"
          tono={porDebajo ? "alerta" : "bien"}
        />
        <Ficha titulo="Escalón" valor={`${p.escalonPct}%`} nota="live → relámpago normal → campaña regular" />
      </div>

      <section className="tarjeta overflow-hidden">
        <div className="px-4 pt-4">
          <h2 className="text-sm font-semibold">Precio por modelo</h2>
          <p className="text-xs" style={{ color: "var(--ink-2)" }}>
            «Neto MELI/par» es lo que Mercado Pago depositó por par en el periodo: el objetivo. «TikTok hoy» es el precio promedio de las
            tallas activas en TikTok y lo que deja a ese precio. Los tres niveles dejan al menos el objetivo: {NOMBRES_NIVEL.live} es el
            piso, {NOMBRES_NIVEL.normal} {p.escalonPct} % arriba y {NOMBRES_NIVEL.campana} otro {p.escalonPct} %. Un modelo sin venta
            en MELI no tiene objetivo.
          </p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                <th className="px-4 py-2 font-semibold">Modelo</th>
                <th className="px-4 py-2 text-right font-semibold">Pares MELI</th>
                <th className="px-4 py-2 text-right font-semibold">Neto MELI/par</th>
                <th className="px-4 py-2 text-right font-semibold">Costo</th>
                <th className="px-4 py-2 text-right font-semibold">TikTok hoy</th>
                <th className="px-4 py-2 text-right font-semibold">{NOMBRES_NIVEL.live}</th>
                <th className="px-4 py-2 text-right font-semibold">{NOMBRES_NIVEL.normal}</th>
                <th className="px-4 py-2 text-right font-semibold">{NOMBRES_NIVEL.campana}</th>
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => {
                const bajo = r.niveles && r.precioTikTok != null && r.precioTikTok < r.niveles[0].precio;
                return (
                  <tr key={r.modelo} className="hairline align-top">
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.modelo}</div>
                      {r.categoria ? (
                        <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                          {r.categoria}
                        </div>
                      ) : null}
                    </td>
                    <td className="num px-4 py-2 text-right">{r.paresMeli ? n(r.paresMeli) : "—"}</td>
                    <td className="num px-4 py-2 text-right font-medium" title={r.paresMeli ? `${pesos(r.netoMeli)} netos en ${n(r.paresMeli)} pares` : "sin venta en MELI en el periodo"}>
                      {r.netoPorPar != null ? pesosC(r.netoPorPar) : "—"}
                    </td>
                    <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }}>
                      {r.costo != null ? pesos(r.costo) : "sin costo"}
                    </td>
                    <td className="num px-4 py-2 text-right" style={{ color: bajo ? "var(--estado-alerta)" : undefined }} title={r.netoTikTokActual != null ? `deja ${pesosC(r.netoTikTokActual)} por par` : "no está en TikTok"}>
                      {r.precioTikTok != null ? (
                        <>
                          {pesos(r.precioTikTok)}
                          <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                            deja {pesosC(r.netoTikTokActual ?? 0)}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    {(r.niveles ?? [null, null, null]).map((nivel, i) => (
                      <td key={i} className="num px-4 py-2 text-right">
                        {nivel ? (
                          <>
                            <span className={i === 0 ? "font-semibold" : "font-medium"}>{pesos(nivel.precio)}</span>
                            <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                              deja {pesosC(nivel.neto)}
                              {r.costo != null ? ` · gano ${pesos(nivel.neto - r.costo)}` : ""}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!renglones.length ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm" colSpan={8} style={{ color: "var(--ink-2)" }}>
                    Sin ventas en MELI ni productos en TikTok.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
