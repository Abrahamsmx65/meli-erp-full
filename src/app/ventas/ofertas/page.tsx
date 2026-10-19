import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { leerConfigOfertas, leerOfertasGuardadas } from "@/lib/servicios/ofertas-meli";
import type { DecisionOferta, RenglonOferta } from "@/lib/precios/ofertas-aporte";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla, Vacio } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";
import { Ficha } from "@/components/tiles";
import { ControlesOfertas } from "@/components/ofertas-meli";

export const dynamic = "force-dynamic";

const din = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fecha = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short" });
};

function TablaOfertas({ renglones }: { renglones: RenglonOferta[] }) {
  if (!renglones.length) return <Vacio>Nada por aquí.</Vacio>;
  return (
    <Tabla alta>
      <table className="datos">
        <thead>
          <tr>
            <th>Modelo</th>
            <th>Publicación</th>
            <th>Oferta</th>
            <th className="num">Precio al cliente</th>
            <th className="num">Aporte MELI</th>
            <th className="num">Te queda</th>
            <th className="num">PV normal</th>
            <th>Vence</th>
            <th>Por qué</th>
          </tr>
        </thead>
        <tbody>
          {renglones.map((r) => (
            <tr key={`${r.itemId}|${r.promoId}`}>
              <td className="cifra">{r.modelo ?? "—"}</td>
              <td className="cifra">{r.itemId}</td>
              <td>{r.nombre}</td>
              <td className="num cifra">{din(r.precio)}</td>
              <td className="num cifra">{din(r.aporte)}</td>
              <td className="num cifra">{din(r.efectivo)}</td>
              <td className="num cifra">{din(r.pvNormal)}</td>
              <td>{fecha(r.fin)}</td>
              <td className="texto-2 text-xs">{r.motivo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Tabla>
  );
}

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
              contenido: (
                <Tabla vacia={!revision?.promociones.length} textoVacio="MELI no tiene promociones con aporte para la cuenta.">
                  <table className="datos">
                    <thead>
                      <tr><th>Promoción</th><th>Tipo</th><th>Estado</th><th>Vence</th><th className="num">Publicaciones de calzado</th><th className="num">Con aporte</th><th>Error</th></tr>
                    </thead>
                    <tbody>
                      {(revision?.promociones ?? []).map((p) => (
                        <tr key={p.id}>
                          <td>{p.nombre}</td>
                          <td className="cifra">{p.tipo}</td>
                          <td>{p.estado}</td>
                          <td>{fecha(p.fin)}</td>
                          <td className="num cifra">{p.invitadas}</td>
                          <td className="num cifra">{(revision?.renglones ?? []).filter((r) => r.promoId === p.id && r.decision !== "sin_aporte").length}</td>
                          <td className="text-xs">{p.error ?? ""}</td>
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
