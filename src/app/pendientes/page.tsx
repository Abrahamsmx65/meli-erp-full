import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { leerPlanParcial, obtenerPlan, type PlanGuardado } from "@/lib/servicios/cache";
import { FormularioCorrida, FormularioMapeo } from "@/components/pendientes";
import { Encabezado, Pagina, Seccion, SinCuenta, Vacio } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";

export const dynamic = "force-dynamic";

export default async function Pendientes() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) return <SinCuenta titulo="Pendientes" />;

  // Esta pantalla solo usa los pendientes del plan: se leen esas claves del
  // caché sin bajar el JSON completo (pesa varios megas); si no hay plan
  // guardado todavía, se cae a obtenerPlan como siempre.
  const [parcial, { data: rojosRaw }, { data: ttSinAmarreRaw }, { data: desfasesRaw }] = await Promise.all([
    leerPlanParcial(supabase, cuenta.id, ["pendientes"]),
    // TikTok: un saldo negativo es que se vendió algo que nunca entró al
    // kardex. No se puede frenar a TikTok, pero sí gritar aquí.
    supabase.from("tiktok_inventario").select("sku, saldo, apartado").eq("account_id", cuenta.id).lt("saldo", 0),
    supabase
      .from("tiktok_skus")
      .select("sku_id, seller_sku, titulo")
      .eq("account_id", cuenta.id)
      .eq("activo", true)
      .eq("estado", "ACTIVATE")
      .is("sku_interno", null),
    // La guardia del cron: SKUs donde el kardex quedó ARRIBA del estante.
    supabase
      .from("tiktok_desfases")
      .select("sku, kardex, estante, desde, motivo")
      .eq("account_id", cuenta.id)
      .order("desde", { ascending: true }),
  ]);
  const pendientes = (parcial?.pendientes ??
    (await obtenerPlan(supabase, cuenta.id)).plan.pendientes) as PlanGuardado["pendientes"];
  const { sinCorrida, sinAmarre } = pendientes;
  const rojosTikTok = (rojosRaw ?? []) as { sku: string; saldo: number; apartado: number }[];
  const tiktokSinAmarre = (ttSinAmarreRaw ?? []) as { sku_id: string; seller_sku: string | null; titulo: string | null }[];
  const desfasesTikTok = (desfasesRaw ?? []) as {
    sku: string; kardex: number; estante: number | null; desde: string; motivo: string;
  }[];

  const hayTikTok = rojosTikTok.length > 0 || tiktokSinAmarre.length > 0 || desfasesTikTok.length > 0;
  const nadaPendiente = sinCorrida.length === 0 && sinAmarre.length === 0 && !hayTikTok;

  const paresBloqueados = sinCorrida.reduce(
    (a, s) => a + s.cajasDisponibles * s.paresPorCaja,
    0,
  );

  return (
    <Pagina>
      <Encabezado
        ceja="Sistema"
        titulo="Pendientes por resolver"
        descripcion="Inventario que existe pero que el sistema todavía no puede planear. Nada se descarta en silencio."
      />

      {nadaPendiente ? (
        <Vacio>
          Nada pendiente: todas las cajas de corrida tienen su receta, todo lo de bodega está amarrado a Mercado Libre y
          el almacén de TikTok cuadra.
        </Vacio>
      ) : null}

      <Pestanas
        pestanas={[
          sinCorrida.length > 0 && {
            id: "corridas",
            titulo: "Cajas sin receta",
            cuenta: sinCorrida.length,
            contenido: (
              <>
                <Seccion
                  titulo="Cajas de corrida sin receta"
                  descripcion={`${sinCorrida.length} combinaciones. Sin saber qué tallas trae la caja, no se puede decidir si conviene mandarla. Son ${paresBloqueados.toLocaleString("es-MX")} pares fuera del plan.`}
                  sinRelleno
                >

                    <div className="max-h-[30rem] overflow-auto">
                      <table className="datos">
                        <thead>
                          <tr>
                            <th>Caja</th>
                            <th>Almacén</th>
                            <th>Pedido</th>
                            <th className="num">Cajas</th>
                            <th className="num">Pares/caja</th>
                            <th>Capturar corrida</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sinCorrida.map((s) => (
                            <tr key={`${s.almacen}-${s.skuCaja}`}>
                              <td>
                                <div className="font-medium">{s.skuCaja}</div>
                                <div className="text-xs texto-tenue">
                                  {s.modelo} · {s.color}
                                </div>
                              </td>
                              <td className="text-sm">{s.almacen}</td>
                              <td className="text-sm">{s.pedido}</td>
                              <td className="num cifra">{s.cajasDisponibles}</td>
                              <td className="num cifra">{s.paresPorCaja}</td>
                              <td>
                                <FormularioCorrida
                                  pedido={s.pedido}
                                  modelo={s.modelo}
                                  color={s.color}
                                  paresPorCaja={s.paresPorCaja}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                </Seccion>
              </>
            ),
          },
          sinAmarre.length > 0 && {
            id: "amarre",
            titulo: "SKUs sin amarre",
            cuenta: sinAmarre.length,
            contenido: (
              <>
                <Seccion
                  titulo="SKUs de bodega sin publicación en MELI"
                  descripcion={`${sinAmarre.length} SKUs armados como MODELO-COLOR-TALLA que no existen tal cual en tu catálogo: están escritos distinto en la publicación o no están publicados.`}
                  sinRelleno
                >

                    <div className="max-h-[30rem] overflow-auto">
                      <table className="datos">
                        <thead>
                          <tr>
                            <th>SKU de bodega</th>
                            <th>Modelo</th>
                            <th>Color</th>
                            <th>Talla</th>
                            <th className="num">Pares</th>
                            <th>Amarrar a SKU de MELI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sinAmarre.slice(0, 400).map((s) => (
                            <tr key={s.skuConstruido}>
                              <td className="font-medium">{s.skuConstruido}</td>
                              <td className="text-sm">{s.modelo}</td>
                              <td className="text-sm">{s.color}</td>
                              <td className="text-sm">{s.talla}</td>
                              <td className="num cifra">{s.paresAfectados.toLocaleString("es-MX")}</td>
                              <td>
                                <FormularioMapeo skuConstruido={s.skuConstruido} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                </Seccion>
              </>
            ),
          },
          hayTikTok && {
            id: "tiktok",
            titulo: "TikTok",
            cuenta: rojosTikTok.length + desfasesTikTok.length + tiktokSinAmarre.length,
            alerta: rojosTikTok.length + desfasesTikTok.length > 0,
            contenido: (
              <>
                <Seccion titulo="TikTok Shop" descripcion="Lo que el almacén de TikTok no puede resolver solo." sinRelleno>
                  {rojosTikTok.length ? (
                    <div className="px-4 pt-3">
                      <h3 className="text-sm font-semibold" style={{ color: "var(--critico-texto)" }}>
                        {rojosTikTok.length} SKU con saldo negativo
                      </h3>
                      <p className="text-xs texto-2">
                        Se vendieron pares que nunca entraron al kardex. Falta la entrada de Industher o
                        un conteo. Mientras, a TikTok no se le escribe nada de estos SKU.
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                        {rojosTikTok.map((r) => (
                          <li key={r.sku} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--grid)" }}>
                            <span className="font-medium">{r.sku}</span>
                            <span className="cifra ml-2" style={{ color: "var(--critico-texto)" }}>{r.saldo}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {desfasesTikTok.length ? (
                    <div className="px-4 pt-3">
                      <h3 className="text-sm font-semibold" style={{ color: "var(--critico-texto)" }}>
                        {desfasesTikTok.length} SKU donde el kardex trae más que la bodega
                      </h3>
                      <p className="text-xs texto-2">
                        A TikTok se le publica el número más bajo de los dos, así que no se está vendiendo de
                        más — pero la diferencia sigue abierta y se cierra con un conteo cíclico.
                      </p>
                      <ul className="mt-2 flex flex-col gap-1 text-sm">
                        {desfasesTikTok.slice(0, 40).map((d) => (
                          <li key={d.sku} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--grid)" }}>
                            <span className="font-medium">{d.sku}</span>
                            <span className="ml-2 texto-2">
                              kardex <b className="cifra">{d.kardex}</b> · bodega{" "}
                              <b className="cifra">{d.estante ?? "—"}</b> · desde{" "}
                              {new Date(d.desde).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {tiktokSinAmarre.length ? (
                    <div className="px-4 py-3">
                      <h3 className="text-sm font-semibold">{tiktokSinAmarre.length} publicaciones activas de TikTok sin SKU del ERP</h3>
                      <p className="text-xs texto-2">
                        Sus ventas no descuentan y su disponible no se publica. Se amarran en Almacén TikTok.
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                        {tiktokSinAmarre.slice(0, 60).map((s) => (
                          <li key={s.sku_id} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--grid)" }}>
                            {s.seller_sku ?? s.sku_id}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </Seccion>
              </>
            ),
          },
        ]}
      />
    </Pagina>
  );
}
