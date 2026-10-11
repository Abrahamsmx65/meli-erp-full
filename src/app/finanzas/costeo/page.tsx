import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { leerCacheAppGuardado } from "@/lib/servicios/cache-app";
import { CLAVE_COSTEO, EDAD_COSTEO_MS, recalcularCosteo, type ResultadoCosteo } from "@/lib/servicios/costeo";
import { marcarRefrescando } from "@/lib/servicios/marca-refresco";
import { Ficha } from "@/components/tiles";
import { AccionesCosteo, CostosPorModelo } from "@/components/costeo";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla, Vacio } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";

export const dynamic = "force-dynamic";

function pesos(x: number | null | undefined, dec = 0): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return "$" + x.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/**
 * Costeo real por contenedor (dueño, 11-oct-2026). Lo pagado sale del sheet
 * de cuentas (solo lectura), lo que traía cada contenedor del Excel de
 * costeo o del packing list, y el reparto es el del dueño: fábrica y
 * comisión por valor, flete y aduana por CBM. Un contenedor solo cuenta ya
 * ENTREGADO y con la aduana apuntada. Se calcula por atrás (cron diario y
 * botón) y aquí solo se lee.
 */
export default async function Costeo() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Costeo" />;

  const guardado = await leerCacheAppGuardado<ResultadoCosteo>(supabase as DB, cuenta.id, CLAVE_COSTEO);
  const r = guardado.estado === "encontrado" ? guardado.valor.datos : null;
  const viejo = guardado.estado === "encontrado" && Date.now() - Date.parse(guardado.valor.generadoEn) > EDAD_COSTEO_MS;
  if (viejo) {
    marcarRefrescando();
    try {
      const { after } = await import("next/server");
      const { clienteAdmin } = await import("@/lib/supabase/admin");
      after(() => recalcularCosteo(clienteAdmin() as DB, cuenta.id).then(() => undefined).catch(() => undefined));
    } catch {
      /* sin contexto de request: lo guardado sirve igual */
    }
  }

  const encabezado = (
    <Encabezado
      ceja="Negocio"
      titulo="Costeo"
      descripcion="Costo real por par de cada contenedor: fábrica, flete, aduana y comisión."
      frescura={r?.generadoEn ?? null}
      refrescando={viejo}
      acciones={<AccionesCosteo />}
    />
  );

  if (!r) {
    return (
      <Pagina>
        {encabezado}
        <Vacio>Todavía no se ha calculado. Dale «Actualizar» y sube el Excel de costeo de la fábrica.</Vacio>
      </Pagina>
    );
  }

  const cuentan = r.contenedores.filter((c) => c.cuenta);
  const pendientes = r.contenedores.filter((c) => !c.cuenta);
  const conReal = r.modelos.filter((m) => m.real != null);
  const noCuadran = conReal.filter(
    (m) => m.costoActual == null || m.costoActual <= 0 || Math.abs(m.real! - m.costoActual) / m.costoActual >= 0.01,
  );
  const sinDetalle = pendientes.filter((c) => c.fuente == null);

  return (
    <Pagina>
      {encabezado}
      {!r.fuentes.cuentas.ok ? (
        <Aviso tono="critico" titulo="No se pudo leer el sheet de cuentas">{r.fuentes.cuentas.error}</Aviso>
      ) : null}
      {!r.fuentes.excel ? (
        <Aviso tono="alerta" titulo="Falta el Excel de costeo">
          Sin él, solo se costean los contenedores que tienen packing list en el ERP. Súbelo con «Subir Excel de costeo».
        </Aviso>
      ) : null}
      {r.avisos.map((a, i) => (
        <Aviso key={i} tono="alerta">{a}</Aviso>
      ))}
      <Cifras columnas={4}>
        <Ficha titulo="Contenedores que cuentan" valor={cuentan.length} nota="Entregados y con aduana" />
        <Ficha titulo="Pendientes" valor={pendientes.length} nota="En camino o sin aduana" tono={pendientes.length ? "alerta" : "neutro"} />
        <Ficha titulo="Modelos con costo real" valor={conReal.length} />
        <Ficha titulo="No cuadran con el catálogo" valor={noCuadran.length} tono={noCuadran.length ? "alerta" : "bien"} />
      </Cifras>
      <Pestanas
        pestanas={[
          {
            id: "modelos",
            titulo: "Por modelo",
            cuenta: conReal.length,
            contenido: (
              <Seccion titulo="Costo por par">
                <CostosPorModelo modelos={r.modelos} />
              </Seccion>
            ),
          },
          {
            id: "contenedores",
            titulo: "Por contenedor",
            cuenta: r.contenedores.length,
            alerta: sinDetalle.length > 0,
            contenido: (
              <Seccion sinRelleno>
                <Tabla alta vacia={!r.contenedores.length}>
                  <table className="datos">
                    <thead>
                      <tr>
                        <th>Contenedor</th>
                        <th>Estatus</th>
                        <th className="num">Pares</th>
                        <th className="num">Fábrica</th>
                        <th className="num">Flete</th>
                        <th className="num">Aduana</th>
                        <th className="num">Comisión</th>
                        <th className="num">Total</th>
                        <th className="num">Por par</th>
                        <th>Modelos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.contenedores.map((c) => (
                        <tr key={c.id}>
                          <td className="font-medium">
                            {c.id}
                            <div className="texto-tenue text-[11px]">{c.iso ?? ""}</div>
                          </td>
                          <td className="text-[12px]">
                            <span style={{ color: c.cuenta ? "var(--exito-texto)" : "var(--alerta-texto)" }}>
                              {c.cuenta ? "Cuenta" : c.estatus}
                            </span>
                            {c.motivo ? <div className="texto-tenue">{c.motivo}</div> : null}
                            {c.avisos.map((a, i) => (
                              <div key={i} className="texto-tenue">{a}</div>
                            ))}
                            <div className="texto-tenue">
                              {c.fuente === "excel" ? "Detalle: Excel de costeo" : c.fuente === "packing" ? "Detalle: packing list" : ""}
                              {c.metodoCbm === "numeros" ? " · CBM de Números" : c.metodoCbm === "pares" ? " · reparto por pares" : ""}
                            </div>
                          </td>
                          <td className="num cifra">{c.pares ? c.pares.toLocaleString("es-MX") : "—"}</td>
                          <td className="num cifra">{pesos(c.pesosCosto)}</td>
                          <td className="num cifra">{pesos(c.pesosEnvio)}</td>
                          <td className="num cifra">{pesos(c.aduana)}</td>
                          <td className="num cifra">{c.comision ? pesos(c.comision) : "—"}</td>
                          <td className="num cifra font-semibold">{pesos(c.totalMxn)}</td>
                          <td className="num cifra">{c.pares && c.pesosCosto ? pesos(c.totalMxn / c.pares, 2) : "—"}</td>
                          <td className="text-[12px]">
                            {c.modelos.length ? (
                              <details>
                                <summary className="enlace cursor-pointer">{c.modelos.length} modelos</summary>
                                <table className="datos mt-2">
                                  <thead>
                                    <tr>
                                      <th>Modelo</th>
                                      <th className="num">Pares</th>
                                      <th className="num">USD/par</th>
                                      <th className="num">CBM</th>
                                      <th className="num">Fábrica</th>
                                      <th className="num">Flete</th>
                                      <th className="num">Aduana</th>
                                      <th className="num">Por par</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.modelos.map((m) => (
                                      <tr key={m.modelo}>
                                        <td>{m.modelo}</td>
                                        <td className="num cifra">{m.pares.toLocaleString("es-MX")}</td>
                                        <td className="num cifra">{m.usdPar == null ? "—" : m.usdPar.toFixed(2)}</td>
                                        <td className="num cifra">{m.cbm.toFixed(2)}</td>
                                        <td className="num cifra">{pesos(m.fabricaMxn)}</td>
                                        <td className="num cifra">{pesos(m.fleteMxn)}</td>
                                        <td className="num cifra">{pesos(m.aduanaMxn)}</td>
                                        <td className="num cifra font-semibold">{c.pesosCosto ? pesos(m.porPar, 2) : "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </details>
                            ) : (
                              <span className="texto-tenue">{c.productos}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Tabla>
              </Seccion>
            ),
          },
          {
            id: "fuentes",
            titulo: "Fuentes",
            contenido: (
              <Seccion titulo="De dónde sale cada número">
                <ul className="texto-2 flex list-disc flex-col gap-1.5 pl-5 text-[13px]">
                  <li>
                    Sheet de cuentas (solo lectura, nunca se escribe):{" "}
                    {r.fuentes.cuentas.ok ? `${r.fuentes.cuentas.contenedores} contenedores en COSTING GETAC.` : `no se pudo leer: ${r.fuentes.cuentas.error}`}
                  </li>
                  <li>
                    Números (CBM por par de respaldo):{" "}
                    {r.fuentes.numeros.ok ? `${r.fuentes.numeros.modelos} modelos.` : `no se pudo leer: ${r.fuentes.numeros.error}`}
                  </li>
                  <li>
                    Excel de costeo:{" "}
                    {r.fuentes.excel
                      ? `${r.fuentes.excel.nombre}, ${r.fuentes.excel.contenedores} contenedores, subido el ${new Date(r.fuentes.excel.subidoEn).toLocaleDateString("es-MX")}.`
                      : "no se ha subido."}
                  </li>
                  <li>Packing lists del ERP: {r.fuentes.packing} contenedores costeados con ellos.</li>
                </ul>
              </Seccion>
            ),
          },
        ]}
      />
    </Pagina>
  );
}
