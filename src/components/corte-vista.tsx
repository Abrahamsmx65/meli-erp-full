import Link from "next/link";
import {
  nombreDelPeriodo,
  periodoAnterior,
  periodoSiguiente,
  type CorteGuardado,
  type EstadoResultados,
} from "@/lib/servicios/corte-meli";
import { puenteVentaANeto } from "@/lib/servicios/corte-meli-cascada";
import { Ficha } from "@/components/tiles";
import { AccionesCorte, GastosDelMes } from "@/components/cortes-meli";
import { Aviso, Ayuda, Cifras, Encabezado, Pagina, Seccion, Tabla } from "@/components/ui/pagina";

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pct(x: number | null): string {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}

/**
 * La pantalla del corte mensual, la misma para calzado (/ventas/cortes) y
 * fundas (/yapanizcel/cortes): cambian la ruta, el API y los textos; el
 * estado de resultados es el mismo motor.
 *
 * `intro` es la explicación larga: si llega `descripcion` (una línea), la
 * intro se pliega en «¿Cómo se calcula?»; sin `descripcion`, la intro se
 * enseña como descripción (compatibilidad con las pantallas que aún no la
 * pasan).
 */
export function CorteVista({
  titulo,
  intro,
  descripcion,
  ceja,
  ruta,
  apiBase,
  periodo,
  hoy,
  e,
  cortes,
}: {
  titulo: string;
  intro: string;
  /** Una sola línea para el encabezado; con ella `intro` va plegada. */
  descripcion?: string;
  /** Grupo del menú («Mercado Libre», «Fundas»). */
  ceja?: string;
  /** ruta de la página, p. ej. "/ventas/cortes" */
  ruta: string;
  /** base del API, p. ej. "/api/ventas" */
  apiBase: string;
  periodo: string;
  /** el mes en curso (YYYY-MM) */
  hoy: string;
  e: EstadoResultados;
  cortes: CorteGuardado[];
}) {
  const corteDelMes = cortes.find((c) => c.periodo === periodo) ?? null;
  return (
    <Pagina>
      <Encabezado
        ceja={ceja}
        titulo={titulo}
        descripcion={descripcion ?? intro}
        frescura={e.generadoEn}
        acciones={
          <span className={`chip ${e.revision.exacto ? "aviso-bien" : "aviso-alerta"}`}>
            {e.revision.exacto ? "Exacto" : `${e.avisos.length} pendientes para ser exacto`}
          </span>
        }
        ayuda={descripcion ? <p>{intro}</p> : undefined}
      />

      {/* ---- Mes --------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={`${ruta}?mes=${periodoAnterior(periodo)}`} className="boton boton-borde boton-chico">
          ← {nombreDelPeriodo(periodoAnterior(periodo))}
        </Link>
        <span className="seccion-titulo capitalize">{nombreDelPeriodo(periodo)}</span>
        {periodo < hoy ? (
          <Link href={`${ruta}?mes=${periodoSiguiente(periodo)}`} className="boton boton-borde boton-chico">
            {nombreDelPeriodo(periodoSiguiente(periodo))} →
          </Link>
        ) : null}
        <span className="texto-tenue text-xs">
          {e.desde} → {e.hasta} · {e.dias} días{periodo === hoy ? " · mes en curso" : ""}
        </span>
      </div>

      <AccionesCorte apiBase={apiBase} periodo={periodo} pendientes={e.revision.pendientes} cargosLeidos={e.cargosLeidos} corteId={corteDelMes?.id ?? null} />
      {corteDelMes ? (
        <p className="texto-tenue text-xs">
          Corte guardado el{" "}
          {new Date(corteDelMes.creadoEn).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}{" "}
          con utilidad neta {pesos(corteDelMes.utilidadNeta)}. Lo de abajo es el cálculo de HOY; rehacer el corte lo vuelve a congelar.
        </p>
      ) : null}

      {/* ---- Cifras ------------------------------------------------------ */}
      <Cifras columnas={5}>
        <Ficha titulo="Venta bruta" valor={pesos(e.ventaBruta)} nota={`${n(e.unidades)} pares · ${n(e.ordenes)} órdenes`} />
        <Ficha titulo="Neto depositado" valor={pesos(e.netoDepositado)} nota={`${pct(e.ventaBruta > 0 ? e.netoDepositado / e.ventaBruta : null)} de la venta · ${Math.round(e.coberturaNetoReal * 100)}% real`} />
        <Ficha titulo="Utilidad bruta" valor={pesos(e.utilidadBruta)} nota="Neto − devoluciones − costo" tono={e.utilidadBruta < 0 ? "critico" : "neutro"} />
        <Ficha titulo="Utilidad neta" valor={pesos(e.utilidadNeta)} nota={e.gananciaPorPar != null ? `${pesos(e.gananciaPorPar)} por par` : ""} tono={e.utilidadNeta < 0 ? "critico" : "bien"} />
        <Ficha titulo="Margen" valor={pct(e.margenSobreVenta)} nota={`sobre el neto: ${pct(e.margenSobreNeto)}`} />
      </Cifras>

      {/* ---- Cascada ----------------------------------------------------- */}
      <Seccion titulo="De la venta a la ganancia" descripcion="Cada renglón es dinero real." sinRelleno>
        <div className="px-4 pt-3">
          <Ayuda>
            <p>
              Cada renglón es dinero real. La comisión es el sale fee de cada orden; «envíos y otros» es lo demás que MELI
              descuenta antes de depositar (envío de Full, retenciones de ISR/IVA) y sale por diferencia contra el depósito.
            </p>
          </Ayuda>
        </div>
        <Tabla>
          <Cascada e={e} />
        </Tabla>
      </Seccion>

      {/* ---- Exactitud --------------------------------------------------- */}
      <Seccion
        titulo={e.revision.exacto ? "Corte exacto" : "Qué le falta al corte para ser exacto"}
        descripcion={
          <>
            {n(e.revision.revisadas)} de {n(e.revision.ordenes)} órdenes con neto ya revisadas contra devoluciones y cancelaciones ·{" "}
            {n(e.cancelaciones.ordenes)} canceladas por {pesos(e.cancelaciones.importe)} fuera del corte · {n(e.devoluciones.ordenes)} devueltas por{" "}
            {pesos(e.devoluciones.monto)}.
          </>
        }
      >
        {e.avisos.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {e.avisos.map((a) => (
              <li key={a} className="flex gap-2">
                <span style={{ color: "var(--acento)" }}>•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Aviso tono="bien">
            Todas las órdenes tienen su depósito real, su revisión y su costo; publicidad y cargos de MELI leídos del API.
          </Aviso>
        )}
      </Seccion>

      {/* ---- Gastos ------------------------------------------------------ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Gastos capturados a mano" descripcion="Lo que no llega por API; se resta de la utilidad neta." sinRelleno>
          <div className="px-4 pt-3">
            <Ayuda titulo="¿Qué se captura aquí?">
              <p>
                Lo que no llega por API: almacenamiento de Full si la facturación no se pudo leer, publicidad fuera de
                Product Ads, cualquier otro gasto del mes. Se restan de la utilidad neta.
              </p>
            </Ayuda>
          </div>
          <GastosDelMes apiBase={apiBase} gastos={e.gastosManuales} desde={e.desde} hasta={e.hasta} />
        </Seccion>

        <Seccion titulo="Facturado por MELI en el periodo" descripcion="Por tipo de cargo. Solo «Full» y «Otro» se restan." sinRelleno>
          <div className="px-4 pt-3">
            <Ayuda>
              <p>
                Por tipo de cargo. Solo «Full» y «Otro» se restan: comisión y envío ya van dentro del neto, Product Ads ya
                cuenta desde el API de publicidad, y los pagos son abonos.
              </p>
            </Ayuda>
          </div>
          {e.cargosPorTipo.length ? (
            <Tabla>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Clase</th>
                    <th className="num">Renglones</th>
                    <th className="num">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {e.cargosPorTipo.map((k) => (
                    <tr key={k.tipo}>
                      <td className="font-medium">{k.tipo}</td>
                      <td>{({ full: "Full (se resta)", otro: "Otro (se resta)", venta: "En el neto", publicidad: "Publicidad", pago: "Pago / abono", bonificacion: "Anulación (no se suma)", resumen: "Resumen (no se resta)" } as Record<string, string>)[k.clase] ?? k.clase}</td>
                      <td className="num cifra">{n(k.renglones)}</td>
                      <td className="num cifra">{pesos(k.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Tabla>
          ) : (
            <p className="texto-2 p-4 text-sm">
              Todavía no se lee la facturación de este periodo. Dale a «Leer facturación de MELI»; si MELI no la entrega,
              captura el almacenamiento de Full a mano.
            </p>
          )}
        </Seccion>
      </div>

      {/* ---- Por modelo y por categoría ---------------------------------- */}
      <Seccion titulo="Por modelo" descripcion="Ganancia = neto − costo − publicidad del modelo." sinRelleno>
        <div className="px-4 pt-3">
          <Ayuda>
            <p>
              Neto = depósito real repartido por SKU; ganancia = neto − costo − publicidad del modelo. Las devoluciones y
              los gastos de Full no se reparten por modelo.
            </p>
          </Ayuda>
        </div>
        <Tabla alta>
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Categoría</th>
                <th className="num">Pares</th>
                <th className="num">Venta</th>
                <th className="num">Comisión</th>
                <th className="num">Envío</th>
                <th className="num">ISR</th>
                <th className="num">IVA</th>
                <th className="num">Otros</th>
                <th className="num">Neto</th>
                <th className="num">Costo</th>
                <th className="num">Publicidad</th>
                <th className="num">Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {e.porModelo.map((m) => (
                <tr key={m.modelo}>
                  <td className="font-medium">{m.modelo}</td>
                  <td className="texto-2">{m.categoria ?? "—"}</td>
                  <td className="num cifra">{n(m.unidades)}</td>
                  <td className="num cifra">{pesos(m.importe)}</td>
                  <td className="num cifra texto-tenue">{pesos(m.comision)}</td>
                  <td className="num cifra texto-tenue">{pesos(m.envio ?? 0)}</td>
                  <td className="num cifra texto-tenue">{pesos(m.isr ?? 0)}</td>
                  <td className="num cifra texto-tenue">{pesos(m.iva ?? 0)}</td>
                  <td className="num cifra texto-tenue">{pesos(m.otrosCargos ?? 0)}</td>
                  <td className="num cifra">{pesos(m.neto)}</td>
                  <td className="num cifra" style={{ color: m.costo == null ? "var(--alerta-texto)" : "var(--ink-1)" }}>{m.costo == null ? "sin costo" : pesos(m.costo)}</td>
                  <td className="num cifra">{m.publicidad ? pesos(m.publicidad) : "—"}</td>
                  <td className="num cifra font-semibold" style={{ color: colorGanancia(m.ganancia) }}>
                    {m.ganancia == null ? "—" : pesos(m.ganancia)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabla>
      </Seccion>

      <Seccion titulo="Por categoría" sinRelleno>
        <Tabla>
          <table className="datos">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Pares</th>
                <th className="num">Venta</th>
                <th className="num">Comisión</th>
                <th className="num">Envío</th>
                <th className="num">ISR</th>
                <th className="num">IVA</th>
                <th className="num">Otros</th>
                <th className="num">Neto</th>
                <th className="num">Costo</th>
                <th className="num">Publicidad</th>
                <th className="num">Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {e.porCategoria.map((k) => (
                <tr key={k.categoria}>
                  <td className="font-medium">{k.categoria}</td>
                  <td className="num cifra">{n(k.unidades)}</td>
                  <td className="num cifra">{pesos(k.importe)}</td>
                  <td className="num cifra texto-tenue">{pesos(k.comision ?? 0)}</td>
                  <td className="num cifra texto-tenue">{pesos(k.envio ?? 0)}</td>
                  <td className="num cifra texto-tenue">{pesos(k.isr ?? 0)}</td>
                  <td className="num cifra texto-tenue">{pesos(k.iva ?? 0)}</td>
                  <td className="num cifra texto-tenue">{pesos(k.otrosCargos ?? 0)}</td>
                  <td className="num cifra">{pesos(k.neto)}</td>
                  <td className="num cifra">{k.costo == null ? "sin costo" : pesos(k.costo)}</td>
                  <td className="num cifra">{k.publicidad ? pesos(k.publicidad) : "—"}</td>
                  <td className="num cifra font-semibold" style={{ color: colorGanancia(k.ganancia) }}>
                    {k.ganancia == null ? "—" : pesos(k.ganancia)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabla>
      </Seccion>

      {/* ---- Cortes guardados -------------------------------------------- */}
      <Seccion
        titulo="Cortes guardados"
        descripcion="Cada corte queda congelado con las cifras del momento; su PDF se puede bajar cuantas veces haga falta."
        sinRelleno
      >
        {cortes.length ? (
          <Tabla>
            <table className="datos">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Hecho el</th>
                  <th className="num">Venta bruta</th>
                  <th className="num">Neto</th>
                  <th className="num">Utilidad neta</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cortes.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium">
                      <Link href={`${ruta}?mes=${c.periodo}`} className="enlace">
                        {nombreDelPeriodo(c.periodo)}
                      </Link>
                    </td>
                    <td className="cifra">{new Date(c.creadoEn).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="num cifra">{pesos(c.ventaBruta)}</td>
                    <td className="num cifra">{pesos(c.netoDepositado)}</td>
                    <td className="num cifra font-semibold" style={{ color: c.utilidadNeta < 0 ? "var(--critico-texto)" : "var(--exito-texto)" }}>{pesos(c.utilidadNeta)}</td>
                    <td>{c.exacto ? "Exacto" : "Con pendientes"}</td>
                    <td className="num">
                      <a href={`${apiBase}/cortes/${c.id}/pdf`} target="_blank" rel="noreferrer" className="enlace">
                        PDF
                      </a>
                      {" · "}
                      <a href={`${apiBase}/cortes/${c.id}/excel`} className="enlace">
                        Excel
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tabla>
        ) : (
          <p className="texto-2 p-4 text-sm">Todavía no hay cortes guardados. Haz el primero con el botón de arriba.</p>
        )}
      </Seccion>
    </Pagina>
  );
}

const colorGanancia = (g: number | null | undefined) =>
  g == null ? "var(--ink-muted)" : g < 0 ? "var(--critico-texto)" : "var(--exito-texto)";

function Cascada({ e }: { e: EstadoResultados }) {
  const puente = puenteVentaANeto(e);
  const filas: { etiqueta: string; nota?: string; monto: number; tipo: "base" | "resta" | "suma" | "total" | "final" }[] = [
    { etiqueta: "Venta bruta", nota: "precio × pares de las órdenes pagadas", monto: puente.ventaBruta, tipo: "base" },
    { etiqueta: "Comisión de MELI", nota: `sale fee de cada orden${e.reventa?.ordenes ? (e.reventa.reconstruidas ? `; ${n(e.reventa.reconstruidas)} ventas en reventa reconstruidas al precio público (${pesos(e.reventa.totalComprador ?? e.reventa.importe)}): su comisión y envío se contemplan aunque MELI los absorbe` : `; ${n(e.reventa.ordenes)} ventas en reventa por ${pesos(e.reventa.importe)} ya vienen netas (MELI absorbe comisión y envío)`) : ""}`, monto: -puente.comision, tipo: "resta" },
    { etiqueta: "Envío", nota: "cargo de envío asociado a las ventas", monto: -puente.envio, tipo: "resta" },
    { etiqueta: "Retención ISR", nota: "impuesto adelantado enterado por MELI al SAT", monto: -puente.isr, tipo: "resta" },
    { etiqueta: "Retención IVA", nota: "impuesto adelantado enterado por MELI al SAT", monto: -puente.iva, tipo: "resta" },
    ...(puente.retencionSinSeparar ? [{ etiqueta: "Retenciones sin separar", nota: "ISR + IVA que Mercado Pago entregó sumados, sin desglosar", monto: -puente.retencionSinSeparar, tipo: "resta" as const }] : []),
    { etiqueta: "Otros cargos", nota: e.cargosSinDesglosar ? `incluye ${pesos(e.cargosSinDesglosar)} aún sin concepto por operación` : "otros descuentos incluidos en el depósito", monto: -puente.otros, tipo: "resta" },
    ...(puente.ajusteLiquidacion ? [{ etiqueta: "Ajuste posterior de liquidación", nota: "cambio del saldo de Mercado Pago después del depósito original", monto: -puente.ajusteLiquidacion, tipo: "resta" as const }] : []),
    ...(puente.devolucionesIncluidasEnNeto ? [{ etiqueta: "Reembolsos ya reflejados en el neto", nota: "Mercado Pago ya redujo el saldo actual; se muestran aquí para cuadrar la cascada", monto: -puente.devolucionesIncluidasEnNeto, tipo: "resta" as const }] : []),
    { etiqueta: "Neto depositado por Mercado Pago", nota: e.ventaSinDeposito ? `${pesos(e.ventaSinDeposito)} de venta aún sin depósito leído: NO está incluida (nada se estima)` : e.netoEstimado > 0 ? `${pesos(e.netoEstimado)} estimado en este corte guardado (los cortes nuevos ya no estiman)` : "depósito real de todas las órdenes", monto: puente.netoDepositado, tipo: "total" },
    { etiqueta: "Devoluciones", nota: `${n(e.devoluciones.ordenes)} órdenes: ${pesos(e.devoluciones.incluidoEnNeto ?? 0)} ya bajó el neto; aquí solo se resta lo restante`, monto: -e.devoluciones.monto, tipo: "resta" },
    ...(e.devoluciones.ordenes
      ? [{ etiqueta: "Costo recuperado de devoluciones", nota: `${n(e.devoluciones.unidades)} pares que regresan al stock${e.devoluciones.costoEstimado ? ` (${pesos(e.devoluciones.costoEstimado)} estimado)` : ""}`, monto: e.devoluciones.costoRecuperado, tipo: "suma" as const }]
      : []),
    { etiqueta: "Costo de producto", nota: `${n(e.unidadesConCosto)} de ${n(e.unidades)} pares con costo capturado`, monto: -e.costoProducto, tipo: "resta" },
    { etiqueta: "Utilidad bruta", monto: e.utilidadBruta, tipo: "total" },
    { etiqueta: "Publicidad", nota: `Product Ads ${pesos(e.publicidad.ads)}${e.publicidad.manual ? ` + a mano ${pesos(e.publicidad.manual)}` : ""}${e.publicidad.sinAmarre ? ` (incluye ${pesos(e.publicidad.sinAmarre)} de anuncios sin amarre a modelo)` : ""}`, monto: -e.publicidad.total, tipo: "resta" },
    { etiqueta: "Gastos de Full", nota: `facturado por MELI ${pesos(e.full.cargosMeli)}${e.full.manual ? ` + a mano ${pesos(e.full.manual)}` : ""}`, monto: -e.full.total, tipo: "resta" },
    { etiqueta: "Otros gastos", nota: `otros cargos de MELI ${pesos(e.otros.cargosMeli)}${e.otros.manual ? ` + a mano ${pesos(e.otros.manual)}` : ""}`, monto: -e.otros.total, tipo: "resta" },
    { etiqueta: "Utilidad neta", monto: e.utilidadNeta, tipo: "final" },
  ];
  const escala = e.ventaBruta > 0 ? 100 / e.ventaBruta : 0;
  return (
    <table className="datos">
      <tbody>
        {filas.map((f) => {
          const total = f.tipo === "total" || f.tipo === "final";
          const color = f.tipo === "final" ? (f.monto < 0 ? "var(--critico-texto)" : "var(--exito-texto)") : f.tipo === "suma" ? "var(--exito-texto)" : total ? "var(--ink-1)" : "var(--ink-2)";
          return (
            <tr key={f.etiqueta} style={total ? { background: "var(--surface-2)" } : undefined}>
              <td className={total ? "font-semibold" : ""} style={{ color: f.tipo === "final" ? color : undefined }}>
                {f.etiqueta}
                {f.nota ? (
                  <div className="texto-tenue text-xs font-normal">
                    {f.nota}
                  </div>
                ) : null}
              </td>
              <td className="hidden w-[40%] md:table-cell">
                <div className="h-2 rounded-full" style={{ width: `${Math.min(100, Math.abs(f.monto) * escala)}%`, background: f.tipo === "resta" ? "#f3b3ba" : f.tipo === "suma" ? "#b7e4c7" : f.tipo === "final" ? color : f.tipo === "total" ? "var(--acento)" : "var(--axis)" }} />
              </td>
              <td className={`num cifra ${total ? "font-semibold" : ""}`} style={{ color, fontSize: f.tipo === "final" ? "1.1rem" : undefined }}>
                {f.tipo === "suma" ? "+" : ""}
                {pesos(f.monto)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
