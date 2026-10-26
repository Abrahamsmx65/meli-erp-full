import { clienteServidor } from "@/lib/supabase/server";
import type { DB } from "@/lib/datos/repos";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { leerConfigOfertasFundas, leerOfertasFundas } from "@/lib/servicios/fundas-ofertas";
import type { DecisionOferta } from "@/lib/precios/ofertas-aporte";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";
import { Ficha } from "@/components/tiles";
import { ControlesOfertas } from "@/components/ofertas-meli";
import { API_FUNDAS, ConfirmarBuenFin, ConfirmarRelampagos } from "@/components/confirmar-relampagos";
import { TablaOfertas, TablaPromocionesOfertas } from "@/components/tabla-ofertas";

export const dynamic = "force-dynamic";

const din = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Ofertas de las fundas (dueño, 23-oct-2026): relámpago, Buen Fin, oferta
 * de todos los días y ofertas con aporte de MELI, con los precios por diseño
 * de la pestaña FUNDAS del sheet de Números. Corren solas: relámpago, Buen
 * Fin y todos los días a las 10:05 y 00:35; las de aporte cada hora.
 */
export default async function OfertasFundas() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta servicio="yapanizcel" titulo="Ofertas fundas" />;
  const db = supabase as DB;
  const [revision, config] = await Promise.all([leerOfertasFundas(db, cuenta.id), leerConfigOfertasFundas(db, cuenta.id)]);
  const de = (d: DecisionOferta[]) => (revision?.renglones ?? []).filter((r) => d.includes(r.decision));
  const cumplen = de(["aceptar"]);
  const noCumplen = de(["no_cumple"]);
  const faltan = de(["sin_precio", "sin_datos"]);
  const aceptadas = de(["aceptada"]);
  const sinAporte = de(["sin_aporte"]);
  const ultima = revision?.ultimaAceptacion ?? null;
  const precios = revision?.precios ?? [];

  return (
    <Pagina>
      <Encabezado
        ceja="Fundas"
        titulo="Ofertas fundas"
        descripcion="Relámpago, Buen Fin, todos los días y ofertas con aporte de MELI con los precios de la pestaña FUNDAS de Números."
        frescura={revision?.generadoEn ?? null}
        acciones={
          <ControlesOfertas
            automatico={config.automatico}
            hayParaAceptar={cumplen.length > 0}
            api="/api/yapanizcel/ofertas"
            textoAutomatico="Confirmar solas"
            fuente="la pestaña FUNDAS de Números"
          />
        }
      />
      {!config.automatico ? (
        <Aviso tono="alerta">«Confirmar solas» está apagado: nada se inscribe ni se acepta por atrás.</Aviso>
      ) : null}
      {!revision ? <Aviso tono="info">Todavía no hay revisión de ofertas con aporte. Dale a «Revisar ahora» o espera la de cada hora.</Aviso> : null}
      {revision?.avisos.map((a, i) => (
        <Aviso key={i} tono="alerta">{a}</Aviso>
      ))}
      {ultima ? (
        <Aviso tono={ultima.fallidas.length ? "alerta" : "bien"}>
          {ultima.origen === "cron" ? "Aceptación automática" : "Aceptación a mano"} del {new Date(ultima.en).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}:{" "}
          {ultima.aceptadas.length} aceptadas · {ultima.fallidas.length} rechazadas por MELI
          {ultima.fallidas.length ? (
            <ul className="mt-1 text-xs">
              {ultima.fallidas.slice(0, 20).map((f, i) => (
                <li key={i}>
                  {f.modelo} · {f.itemId} · {f.nombre}: {f.error}
                </li>
              ))}
            </ul>
          ) : null}
        </Aviso>
      ) : null}
      <Seccion titulo="Relámpagos" descripcion="Inscribe las relámpago que te propuso MELI al precio relámpago del diseño. Corre sola a las 10:05 y a las 00:35.">
        <ConfirmarRelampagos api={API_FUNDAS} />
      </Seccion>
      <Seccion titulo="Buen Fin y todos los días" descripcion="Activa o corrige Buen Fin y la oferta de todos los días al PV MELI del diseño (a .99). Corre sola con las relámpago.">
        <ConfirmarBuenFin api={API_FUNDAS} />
      </Seccion>
      <Cifras columnas={4}>
        <Ficha titulo="Con aporte, por aceptar" valor={String(cumplen.length)} />
        <Ficha titulo="No cumplen" valor={String(noCumplen.length)} />
        <Ficha titulo="Sin precio o sin datos" valor={String(faltan.length)} />
        <Ficha titulo="Ya aceptadas" valor={String(aceptadas.length)} />
      </Cifras>
      <Seccion sinRelleno>
        <Pestanas
          pestanas={[
            { id: "aceptar", titulo: "Por aceptar", cuenta: cumplen.length, alerta: cumplen.length > 0, contenido: <TablaOfertas renglones={cumplen} etiqueta="Diseño" precio="PV MELI" /> },
            { id: "no", titulo: "No cumplen", cuenta: noCumplen.length, contenido: <TablaOfertas renglones={noCumplen} etiqueta="Diseño" precio="PV MELI" /> },
            { id: "faltan", titulo: "Sin precio o sin datos", cuenta: faltan.length, contenido: <TablaOfertas renglones={faltan} etiqueta="Diseño" precio="PV MELI" /> },
            { id: "sin-aporte", titulo: "Sin aporte de MELI", cuenta: sinAporte.length, contenido: <TablaOfertas renglones={sinAporte} etiqueta="Diseño" precio="PV MELI" /> },
            { id: "aceptadas", titulo: "Aceptadas", cuenta: aceptadas.length, contenido: <TablaOfertas renglones={aceptadas} etiqueta="Diseño" precio="PV MELI" /> },
            {
              id: "promos",
              titulo: "Promociones",
              cuenta: revision?.promociones.length ?? 0,
              contenido: (
                <TablaPromocionesOfertas promociones={revision?.promociones ?? []} renglones={revision?.renglones ?? []} publicaciones="Publicaciones de fundas" />
              ),
            },
            {
              id: "precios",
              titulo: "Precios del sheet",
              cuenta: precios.length,
              contenido: (
                <Tabla vacia={!precios.length} textoVacio="Todavía no se ha leído el sheet: sale con la primera revisión.">
                  <table className="datos">
                    <thead>
                      <tr>
                        <th>Diseño</th>
                        <th>Bloque</th>
                        <th className="num">PV MELI</th>
                        <th className="num">Relámpago</th>
                        <th>Renglones del sheet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {precios.map((p) => (
                        <tr key={p.diseno}>
                          <td className="cifra">{p.diseno}</td>
                          <td>{p.bloque}</td>
                          <td className="num cifra">{din(p.pvMeli)}</td>
                          <td className="num cifra">
                            {p.relampago == null ? <span className="texto-tenue">sin relámpago</span> : din(p.relampago)}
                          </td>
                          <td className="text-xs">{p.renglones.join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Tabla>
              ),
            },
          ]}
        />
      </Seccion>
    </Pagina>
  );
}
