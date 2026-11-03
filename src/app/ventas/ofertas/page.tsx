import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { leerConfigOfertas, leerOfertasGuardadas } from "@/lib/servicios/ofertas-meli";
import type { DecisionOferta } from "@/lib/precios/ofertas-aporte";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";
import { Ficha } from "@/components/tiles";
import { ControlesOfertas } from "@/components/ofertas-meli";
import { ConfirmarBuenFin, ConfirmarRelampagos } from "@/components/confirmar-relampagos";
import { TablaOfertas, TablaPromocionesOfertas } from "@/components/tabla-ofertas";

export const dynamic = "force-dynamic";

/**
 * Ofertas MELI (dueño, 19-oct-2026): las ofertas CON APORTE de Mercado Libre
 * a las que invitan al calzado. Se aceptan las que, con el aporte de MELI
 * (y restando el envío si el aporte cruza los $299), quedan en el PV normal
 * de Números o arriba. La revisión corre cada hora por atrás.
 */
export default async function OfertasMeli() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Ofertas MELI" />;
  const db = supabase as DB;
  const [revision, config] = await Promise.all([leerOfertasGuardadas(db, cuenta.id), leerConfigOfertas(db, cuenta.id)]);
  const de = (d: DecisionOferta[]) => (revision?.renglones ?? []).filter((r) => d.includes(r.decision));
  const cumplen = de(["aceptar"]);
  const noCumplen = de(["no_cumple"]);
  const faltan = de(["sin_precio", "sin_datos"]);
  const aceptadas = de(["aceptada"]);
  const sinAporte = de(["sin_aporte"]);
  const ultima = revision?.ultimaAceptacion ?? null;

  return (
    <Pagina>
      <Encabezado
        ceja="Mercado Libre"
        titulo="Ofertas MELI"
        descripcion="Ofertas con aporte de MELI que cumplen el PV normal de Números."
        frescura={revision?.generadoEn ?? null}
        acciones={<ControlesOfertas automatico={config.automatico} hayParaAceptar={cumplen.length > 0} />}
      />
      {!revision ? <Aviso tono="info">Todavía no hay revisión. Dale a «Revisar ahora» o espera la de cada hora.</Aviso> : null}
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
      <Seccion titulo="Relámpagos" descripcion="Inscribe todas las relámpago que te propuso MELI (o cargó tu asesor) al precio relámpago de Números. Corre sola a las 10:00 y a las 00:30.">
        <ConfirmarRelampagos />
      </Seccion>
      <Seccion titulo="Buen Fin" descripcion="Activa o corrige todas las promociones de Buen Fin al PV normal de Números (a .99). Corre sola con las relámpago a las 10:00 y a las 00:30.">
        <ConfirmarBuenFin />
      </Seccion>
      <Cifras columnas={4}>
        <Ficha titulo="Cumplen, por aceptar" valor={String(cumplen.length)} />
        <Ficha titulo="No cumplen" valor={String(noCumplen.length)} />
        <Ficha titulo="Sin precio o sin datos" valor={String(faltan.length)} />
        <Ficha titulo="Ya aceptadas" valor={String(aceptadas.length)} />
      </Cifras>
      <Seccion sinRelleno>
        <Pestanas
          pestanas={[
            { id: "aceptar", titulo: "Por aceptar", cuenta: cumplen.length, alerta: cumplen.length > 0, contenido: <TablaOfertas renglones={cumplen} /> },
            { id: "no", titulo: "No cumplen", cuenta: noCumplen.length, contenido: <TablaOfertas renglones={noCumplen} /> },
            { id: "faltan", titulo: "Sin precio o sin datos", cuenta: faltan.length, contenido: <TablaOfertas renglones={faltan} /> },
            { id: "sin-aporte", titulo: "Sin aporte de MELI", cuenta: sinAporte.length, contenido: <TablaOfertas renglones={sinAporte} /> },
            { id: "aceptadas", titulo: "Aceptadas", cuenta: aceptadas.length, contenido: <TablaOfertas renglones={aceptadas} /> },
            {
              id: "promos",
              titulo: "Promociones",
              cuenta: revision?.promociones.length ?? 0,
              contenido: <TablaPromocionesOfertas promociones={revision?.promociones ?? []} renglones={revision?.renglones ?? []} />,
            },
          ]}
        />
      </Seccion>
    </Pagina>
  );
}
