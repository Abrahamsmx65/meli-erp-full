import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { diasDeRango, fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import {
  cargarPublicidad,
  type CampanaAds,
  type SugerenciaAds,
} from "@/lib/servicios/publicidad";
import { Ficha } from "@/components/tiles";
import { FiltroFechas } from "@/components/filtro-fechas";
import { BotonAnuncio, BotonCampana, EditorCampana } from "@/components/publicidad-acciones";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

function pesosFinos(x: number): string {
  return (
    "$" +
    x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/**
 * Publicidad de Mercado Libre por modelo (el "parent": MY2307, GT128…).
 *
 * Aparte del monitor de ventas a propósito: aquí la pregunta no es "¿cómo
 * vendo?", sino "¿cuánto me cuesta la publicidad por cada par que vendo y
 * cuánta ganancia queda después de pagarla?". Por omisión, los últimos 30 días.
 */
export default async function Publicidad({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;
  // Sin rango en la URL, los últimos 30 días (no los 7 del monitor de ventas).
  const rango = normalizarRango(sp.desde ?? fechaMx(29), sp.hasta);
  const dias = diasDeRango(rango);

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          La publicidad sale de tu cuenta de Mercado Libre; primero hay que conectarla
          en Ajustes.
        </p>
      </div>
    );
  }

  const p = await cargarPublicidad(supabase, cuenta, rango);
  const t = p.totales;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Publicidad</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Product Ads por modelo: qué se vendió, qué se ganó y cuánto costó la
          publicidad por unidad vendida en el periodo ({dias} días · {rango.desde} →{" "}
          {rango.hasta}).
        </p>
      </div>

      <FiltroFechas base="/publicidad" desde={rango.desde} hasta={rango.hasta} hoy={fechaMx(0)} />

      {p.errorAds ? (
        <div
          className="tarjeta border p-4 text-sm"
          style={{ borderColor: "var(--estado-alerta)" }}
        >
          <div className="font-semibold">Sin datos de Product Ads</div>
          <p className="mt-1" style={{ color: "var(--ink-2)" }}>
            {p.errorAds}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
            Las ventas y la ganancia de abajo sí están completas; solo falta el gasto
            de publicidad.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha
          titulo="Gasto en publicidad"
          valor={p.errorAds ? "—" : pesos(t.gastoAds)}
          nota={p.errorAds ? "Sin datos de ads" : `${pct(t.tacos ?? 0)} de la venta del periodo`}
          tono={p.errorAds ? "neutro" : "alerta"}
        />
        <Ficha
          titulo="Venta del periodo"
          valor={pesos(t.importe)}
          nota={`${n(t.unidades)} unidades`}
        />
        <Ficha
          titulo="Venta por publicidad"
          valor={p.errorAds ? "—" : pesos(t.ventaAds)}
          nota={
            p.errorAds
              ? "Sin datos de ads"
              : `${n(t.unidadesAds)} unidades atribuidas · ACOS ${
                  t.acos != null ? pct(t.acos) : "—"
                }`
          }
        />
        <Ficha
          titulo="Costo por unidad vendida"
          valor={!p.errorAds && t.costoPorUnidad != null ? pesosFinos(t.costoPorUnidad) : "—"}
          nota="Gasto en ads ÷ TODAS las unidades vendidas"
          tono="neutro"
        />
        <Ficha
          titulo="Ganancia después de ads"
          valor={t.coberturaCosto > 0 && !p.errorAds ? pesos(t.ganancia - t.gastoAds) : "—"}
          nota={
            t.coberturaCosto > 0
              ? `Ganancia ${pesos(t.ganancia)} − ads · ${pct(t.coberturaCosto)} de la venta con costo`
              : "Captura costos en Productos y costos"
          }
          tono={
            t.coberturaCosto > 0 && !p.errorAds
              ? t.ganancia - t.gastoAds < 0
                ? "critico"
                : "bien"
              : "neutro"
          }
        />
      </div>

      {p.sugerencias.length > 0 ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Sugerencias</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Publicidad cruzada con el stock de Full y el margen de cada modelo. Los
              botones escriben directo en Product Ads; al pausar por stock, el sistema
              te recuerda encenderlo cuando rellenes.
            </p>
          </header>
          <ul>
            {p.sugerencias.map((s) => (
              <Sugerencia
                key={`${s.accion}|${s.modelo}`}
                s={s}
                campanaDe={new Map(p.campanas.map((c) => [c.id, c]))}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {p.campanas.length > 0 ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Campañas</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              El presupuesto diario y el ACOS objetivo se editan aquí y se guardan
              directo en Mercado Libre. ACOS objetivo = % de la venta que aceptas
              gastar en ads (ROAS objetivo = 100 ÷ ACOS).
            </p>
          </header>
          <table className="datos">
            <thead>
              <tr>
                <th>Campaña</th>
                <th>Estado</th>
                <th className="num">Anuncios</th>
                <th className="num">Gasto del periodo</th>
                <th>Presupuesto y ACOS objetivo</th>
              </tr>
            </thead>
            <tbody>
              {p.campanas.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">
                    {c.nombre}
                    {c.estrategia ? (
                      <span className="ml-1.5 text-[10px]" style={{ color: "var(--ink-muted)" }}>
                        {c.estrategia}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className="text-xs font-semibold"
                      style={{
                        color:
                          c.estado === "active"
                            ? "var(--exito-texto)"
                            : c.estado === "paused"
                              ? "var(--estado-critico)"
                              : "var(--ink-2)",
                      }}
                    >
                      {c.estado === "active"
                        ? "Activa"
                        : c.estado === "paused"
                          ? "Pausada"
                          : (c.estado ?? "—")}
                    </span>
                  </td>
                  <td className="num cifra">{c.anuncios}</td>
                  <td className="num cifra">{pesos(c.gasto)}</td>
                  <td>
                    <EditorCampana
                      id={c.id}
                      presupuesto={c.presupuesto}
                      acosObjetivo={c.acosObjetivo}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {p.sinAmarre.anuncios > 0 ? (
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {p.sinAmarre.anuncios} anuncios con {pesos(p.sinAmarre.gasto)} de gasto no
          amarraron a ningún modelo del catálogo (publicaciones fuera de la
          sincronización); ese gasto sí cuenta en el total de arriba.
        </p>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por modelo</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Todas las tallas y colores de cada modelo, juntos. Venta y unidades son
            TODAS las ventas del periodo; “$ ads/unidad” reparte el gasto de
            publicidad entre ellas. Un anuncio compartido por varios modelos se
            reparte entre ellos según sus ventas. Ganancia neta = ganancia (neto −
            costo) − ads.
          </p>
        </header>
        <div className="max-h-[40rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th className="num">Unidades</th>
                <th className="num">Venta</th>
                <th className="num">Ganancia</th>
                <th className="num">Gasto ads</th>
                <th className="num">$ ads/unidad</th>
                <th className="num">% de la venta</th>
                <th className="num">Venta por ads</th>
                <th className="num">Ganancia neta</th>
              </tr>
            </thead>
            <tbody>
              {p.filas.map((f) => (
                <tr key={f.modelo}>
                  <td className="font-medium">
                    {f.modelo}
                    {f.anuncios > 0 ? (
                      <span className="ml-1.5 text-[10px]" style={{ color: "var(--ink-muted)" }}>
                        {f.anuncios} {f.anuncios === 1 ? "anuncio" : "anuncios"}
                      </span>
                    ) : null}
                  </td>
                  <td className="num cifra font-semibold">{n(f.unidades)}</td>
                  <td className="num cifra">{pesos(f.importe)}</td>
                  <td
                    className="num cifra"
                    style={{
                      color:
                        f.ganancia != null && f.ganancia < 0
                          ? "var(--estado-critico)"
                          : "var(--ink-1)",
                    }}
                  >
                    {f.ganancia == null ? "—" : pesos(f.ganancia)}
                  </td>
                  <td className="num cifra">{f.gastoAds > 0 ? pesos(f.gastoAds) : "—"}</td>
                  <td className="num cifra font-semibold">
                    {f.gastoAds > 0 && f.costoPorUnidad != null
                      ? pesosFinos(f.costoPorUnidad)
                      : "—"}
                  </td>
                  <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                    {f.gastoAds > 0 && f.tacos != null ? pct(f.tacos) : "—"}
                  </td>
                  <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                    {f.ventaAds > 0 ? pesos(f.ventaAds) : "—"}
                  </td>
                  <td
                    className="num cifra"
                    style={{
                      color:
                        f.gananciaNeta != null && f.gananciaNeta < 0
                          ? "var(--estado-critico)"
                          : "var(--ink-1)",
                    }}
                  >
                    {f.gananciaNeta == null ? "—" : pesos(f.gananciaNeta)}
                  </td>
                </tr>
              ))}
              {p.filas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
                    Sin ventas ni anuncios en el periodo.
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

const ETIQUETA_ACCION: Record<
  SugerenciaAds["accion"],
  { texto: string; color: string }
> = {
  pausar: { texto: "Pausar", color: "var(--estado-critico)" },
  encender: { texto: "Encender", color: "var(--exito-texto)" },
  apagar: { texto: "Apagar", color: "var(--estado-critico)" },
  bajar: { texto: "Bajar gasto", color: "var(--estado-alerta)" },
  subir: { texto: "Subir gasto", color: "var(--exito-texto)" },
  activar: { texto: "Candidato", color: "var(--acento)" },
};

function Sugerencia({
  s,
  campanaDe,
}: {
  s: SugerenciaAds;
  campanaDe: Map<string, CampanaAds>;
}) {
  const etiqueta = ETIQUETA_ACCION[s.accion];
  const conBotones = s.accion === "pausar" || s.accion === "encender" || s.accion === "apagar";
  // Las campañas donde vive este modelo, para aplicar la sugerencia de un clic.
  const campanas =
    s.accion === "bajar" || s.accion === "subir"
      ? [...new Set(s.items.map((i) => i.campanaId).filter((x): x is string => !!x))]
          .map((id) => campanaDe.get(id))
          .filter((c): c is CampanaAds => !!c)
      : [];
  return (
    <li className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0 hairline">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
          style={{ borderColor: etiqueta.color, color: etiqueta.color }}
        >
          {etiqueta.texto}
        </span>
        <span className="text-sm font-semibold">{s.modelo}</span>
        {s.recordatorio ? (
          <span className="text-[10px] font-semibold" style={{ color: "var(--exito-texto)" }}>
            Recordatorio
          </span>
        ) : null}
        <span className="cifra ml-auto text-xs" style={{ color: "var(--ink-muted)" }}>
          {s.gastoAds > 0 ? `${pesos(s.gastoAds)} en ads` : ""}
          {s.coberturaDias != null && Number.isFinite(s.coberturaDias)
            ? ` · ${Math.round(s.coberturaDias)}d de stock`
            : ""}
        </span>
      </div>
      <p className="text-xs" style={{ color: "var(--ink-2)" }}>
        {s.razon}
      </p>
      {(s.accion === "bajar" || s.accion === "subir") &&
      s.roasActual != null &&
      s.roasEquilibrio != null ? (
        <p className="cifra text-[11px]" style={{ color: "var(--ink-muted)" }}>
          ROAS actual {s.roasActual.toFixed(1)} · equilibrio {s.roasEquilibrio.toFixed(1)} ·
          ACOS sano ≤{Math.round(s.acosObjetivoPct ?? 0)}%
        </p>
      ) : null}
      {campanas.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {campanas.map((c) => {
            const acosSano =
              s.acosObjetivoPct != null ? Math.round(s.acosObjetivoPct * 10) / 10 : null;
            if (s.accion === "bajar") {
              return acosSano != null ? (
                <BotonCampana
                  key={c.id}
                  campanaId={c.id}
                  acosObjetivo={acosSano}
                  etiqueta={`ACOS objetivo → ${acosSano}% · ${c.nombre}`}
                />
              ) : null;
            }
            // subir: +20% de presupuesto y, si el ACOS objetivo está por
            // debajo del margen, también soltarlo hasta el margen.
            const nuevoPresupuesto =
              c.presupuesto != null ? Math.ceil(c.presupuesto * 1.2) : null;
            return (
              <span key={c.id} className="inline-flex flex-wrap items-center gap-2">
                {nuevoPresupuesto != null ? (
                  <BotonCampana
                    campanaId={c.id}
                    presupuesto={nuevoPresupuesto}
                    etiqueta={`Presupuesto +20% → ${pesos(nuevoPresupuesto)}/día · ${c.nombre}`}
                  />
                ) : null}
                {acosSano != null && c.acosObjetivo != null && c.acosObjetivo < acosSano ? (
                  <BotonCampana
                    campanaId={c.id}
                    acosObjetivo={acosSano}
                    etiqueta={`ACOS objetivo → ${acosSano}% · ${c.nombre}`}
                  />
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}
      {conBotones && s.items.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {s.items.map((i) => (
            <span key={i.itemId} className="inline-flex items-center gap-1">
              <BotonAnuncio
                itemId={i.itemId}
                estado={i.estado}
                modelo={s.modelo}
                motivo={s.accion === "pausar" ? "stock" : ""}
                campanaId={i.campanaId}
              />
              <span className="text-[10px]" style={{ color: "var(--ink-muted)" }}>
                {i.itemId}
                {i.compartido ? " (compartido)" : ""}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}
