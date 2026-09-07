import Link from "next/link";
import {
  nombreDelPeriodo,
  periodoAnterior,
  periodoSiguiente,
  type CorteGuardado,
  type EstadoResultados,
} from "@/lib/servicios/corte-meli";
import { Ficha } from "@/components/tiles";
import { AccionesCorte, GastosDelMes } from "@/components/cortes-meli";

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
 */
export function CorteVista({
  titulo,
  intro,
  ruta,
  apiBase,
  periodo,
  hoy,
  e,
  cortes,
}: {
  titulo: string;
  intro: string;
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">{titulo}</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          {intro}
        </p>
      </div>

      {/* ---- Mes --------------------------------------------------------- */}
      <div className="tarjeta flex flex-wrap items-center gap-3 p-3 text-sm">
        <Link href={`${ruta}?mes=${periodoAnterior(periodo)}`} className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: "var(--borde)" }}>
          ← {nombreDelPeriodo(periodoAnterior(periodo))}
        </Link>
        <span className="text-base font-semibold">{nombreDelPeriodo(periodo)}</span>
        {periodo < hoy ? (
          <Link href={`${ruta}?mes=${periodoSiguiente(periodo)}`} className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: "var(--borde)" }}>
            {nombreDelPeriodo(periodoSiguiente(periodo))} →
          </Link>
        ) : null}
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {e.desde} → {e.hasta} · {e.dias} días{periodo === hoy ? " · mes en curso" : ""}
        </span>
        <span
          className="ml-auto rounded-full px-3 py-1 text-xs font-semibold"
          style={
            e.revision.exacto
              ? { background: "var(--acento-suave)", color: "var(--exito-texto)" }
              : { background: "#fff4d6", color: "#8a5a00" }
          }
        >
          {e.revision.exacto ? "Exacto" : `${e.avisos.length} pendientes para ser exacto`}
        </span>
      </div>

      <AccionesCorte apiBase={apiBase} periodo={periodo} pendientes={e.revision.pendientes} cargosLeidos={e.cargosLeidos} corteId={corteDelMes?.id ?? null} />
      {corteDelMes ? (
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          Corte guardado el{" "}
          {new Date(corteDelMes.creadoEn).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}{" "}
          con utilidad neta {pesos(corteDelMes.utilidadNeta)}. Lo de abajo es el cálculo de HOY; rehacer el corte lo vuelve a congelar.
        </p>
      ) : null}

      {/* ---- Cifras ------------------------------------------------------ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha titulo="Venta bruta" valor={pesos(e.ventaBruta)} nota={`${n(e.unidades)} pares · ${n(e.ordenes)} órdenes`} />
        <Ficha titulo="Neto depositado" valor={pesos(e.netoDepositado)} nota={`${pct(e.ventaBruta > 0 ? e.netoDepositado / e.ventaBruta : null)} de la venta · ${Math.round(e.coberturaNetoReal * 100)}% real`} />
        <Ficha titulo="Utilidad bruta" valor={pesos(e.utilidadBruta)} nota="Neto − devoluciones − costo" tono={e.utilidadBruta < 0 ? "critico" : "neutro"} />
        <Ficha titulo="Utilidad neta" valor={pesos(e.utilidadNeta)} nota={e.gananciaPorPar != null ? `${pesos(e.gananciaPorPar)} por par` : ""} tono={e.utilidadNeta < 0 ? "critico" : "bien"} />
        <Ficha titulo="Margen" valor={pct(e.margenSobreVenta)} nota={`sobre el neto: ${pct(e.margenSobreNeto)}`} />
      </div>

      {/* ---- Cascada ----------------------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">De la venta a la ganancia</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Cada renglón es dinero real. La comisión es el sale fee de cada orden; «envíos y otros» es lo demás que MELI
            descuenta antes de depositar (envío de Full, retenciones de ISR/IVA) y sale por diferencia contra el depósito.
          </p>
        </header>
        <Cascada e={e} />
      </section>

      {/* ---- Exactitud --------------------------------------------------- */}
      <section className="tarjeta p-4">
        <h2 className="text-sm font-semibold">{e.revision.exacto ? "Corte exacto" : "Qué le falta al corte para ser exacto"}</h2>
        <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
          {n(e.revision.revisadas)} de {n(e.revision.ordenes)} órdenes con neto ya revisadas contra devoluciones y cancelaciones ·{" "}
          {n(e.cancelaciones.ordenes)} canceladas por {pesos(e.cancelaciones.importe)} fuera del corte · {n(e.devoluciones.ordenes)} devueltas por{" "}
          {pesos(e.devoluciones.monto)}.
        </p>
        {e.avisos.length ? (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {e.avisos.map((a) => (
              <li key={a} className="flex gap-2">
                <span style={{ color: "var(--acento)" }}>•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm" style={{ color: "var(--exito-texto)" }}>
            Todas las órdenes tienen su depósito real, su revisión y su costo; publicidad y cargos de MELI leídos del API.
          </p>
        )}
      </section>

      {/* ---- Gastos ------------------------------------------------------ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Gastos capturados a mano</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Lo que no llega por API: almacenamiento de Full si la facturación no se pudo leer, publicidad fuera de Product
              Ads, cualquier otro gasto del mes. Se restan de la utilidad neta.
            </p>
          </header>
          <GastosDelMes apiBase={apiBase} gastos={e.gastosManuales} desde={e.desde} hasta={e.hasta} />
        </section>

        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Facturado por MELI en el periodo</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Por tipo de cargo. Solo «Full» y «Otro» se restan: comisión y envío ya van dentro del neto, Product Ads ya
              cuenta desde el API de publicidad, y los pagos son abonos.
            </p>
          </header>
          {e.cargosPorTipo.length ? (
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
                    <td>{({ full: "Full (se resta)", otro: "Otro (se resta)", venta: "En el neto", publicidad: "Publicidad (API)", pago: "Pago / abono", resumen: "Resumen (no se resta)" } as Record<string, string>)[k.clase] ?? k.clase}</td>
                    <td className="num cifra">{n(k.renglones)}</td>
                    <td className="num cifra">{pesos(k.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
              Todavía no se lee la facturación de este periodo. Dale a «Leer facturación de MELI»; si MELI no la entrega,
              captura el almacenamiento de Full a mano.
            </p>
          )}
        </section>
      </div>

      {/* ---- Por modelo y por categoría ---------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por modelo</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Neto = depósito real repartido por SKU; ganancia = neto − costo − publicidad del modelo. Las devoluciones y los
            gastos de Full no se reparten por modelo.
          </p>
        </header>
        <div className="max-h-[36rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Categoría</th>
                <th className="num">Pares</th>
                <th className="num">Venta</th>
                <th className="num">Comisión</th>
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
                  <td style={{ color: "var(--ink-2)" }}>{m.categoria ?? "—"}</td>
                  <td className="num cifra">{n(m.unidades)}</td>
                  <td className="num cifra">{pesos(m.importe)}</td>
                  <td className="num cifra" style={{ color: "var(--ink-muted)" }}>{pesos(m.comision)}</td>
                  <td className="num cifra">{pesos(m.neto)}</td>
                  <td className="num cifra" style={{ color: m.costo == null ? "var(--estado-alerta)" : "var(--ink-1)" }}>{m.costo == null ? "sin costo" : pesos(m.costo)}</td>
                  <td className="num cifra">{m.publicidad ? pesos(m.publicidad) : "—"}</td>
                  <td className="num cifra font-semibold" style={{ color: m.ganancia == null ? "var(--ink-muted)" : m.ganancia < 0 ? "var(--estado-critico)" : "var(--exito-texto)" }}>
                    {m.ganancia == null ? "—" : pesos(m.ganancia)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por categoría</h2>
        </header>
        <table className="datos">
          <thead>
            <tr>
              <th>Categoría</th>
              <th className="num">Pares</th>
              <th className="num">Venta</th>
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
                <td className="num cifra">{pesos(k.neto)}</td>
                <td className="num cifra">{k.costo == null ? "sin costo" : pesos(k.costo)}</td>
                <td className="num cifra">{k.publicidad ? pesos(k.publicidad) : "—"}</td>
                <td className="num cifra font-semibold" style={{ color: k.ganancia == null ? "var(--ink-muted)" : k.ganancia < 0 ? "var(--estado-critico)" : "var(--exito-texto)" }}>
                  {k.ganancia == null ? "—" : pesos(k.ganancia)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ---- Cortes guardados -------------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Cortes guardados</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Cada corte queda congelado con las cifras del momento; su PDF se puede bajar cuantas veces haga falta.
          </p>
        </header>
        {cortes.length ? (
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
                    <Link href={`${ruta}?mes=${c.periodo}`} style={{ color: "var(--acento)" }}>
                      {nombreDelPeriodo(c.periodo)}
                    </Link>
                  </td>
                  <td className="cifra">{new Date(c.creadoEn).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="num cifra">{pesos(c.ventaBruta)}</td>
                  <td className="num cifra">{pesos(c.netoDepositado)}</td>
                  <td className="num cifra font-semibold" style={{ color: c.utilidadNeta < 0 ? "var(--estado-critico)" : "var(--exito-texto)" }}>{pesos(c.utilidadNeta)}</td>
                  <td>{c.exacto ? "Exacto" : "Con pendientes"}</td>
                  <td className="num">
                    <a href={`${apiBase}/cortes/${c.id}/pdf`} target="_blank" rel="noreferrer" style={{ color: "var(--acento)" }}>
                      PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
            Todavía no hay cortes guardados. Haz el primero con el botón de arriba.
          </p>
        )}
      </section>
    </div>
  );
}


function Cascada({ e }: { e: EstadoResultados }) {
  const filas: { etiqueta: string; nota?: string; monto: number; tipo: "base" | "resta" | "total" | "final" }[] = [
    { etiqueta: "Venta bruta", nota: "precio × pares de las órdenes pagadas", monto: e.ventaBruta, tipo: "base" },
    { etiqueta: "Comisión de MELI", nota: "sale fee de cada orden", monto: -e.comision, tipo: "resta" },
    { etiqueta: "Envíos y otros cargos", nota: "envío de Full, retenciones de ISR/IVA: diferencia contra el depósito", monto: -e.enviosYOtros, tipo: "resta" },
    { etiqueta: "Neto depositado por Mercado Pago", nota: e.netoEstimado > 0 ? `${pesos(e.netoEstimado)} todavía estimado (sin depósito real)` : "depósito real de todas las órdenes", monto: e.netoDepositado, tipo: "total" },
    ...(e.cargosFacturados?.ordenes
      ? [{ etiqueta: "Comisión y envío cobrados aparte", nota: `${n(e.cargosFacturados.ordenes)} órdenes depositadas completas por ${pesos(e.cargosFacturados.base)}: MELI las cobra por facturación${e.cargosFacturados.ratio != null ? ` (estimado al ${((1 - e.cargosFacturados.ratio) * 100).toFixed(1)}%)` : ""}`, monto: -e.cargosFacturados.monto, tipo: "resta" as const }]
      : []),
    { etiqueta: "Devoluciones", nota: `${n(e.devoluciones.ordenes)} órdenes devueltas o con contracargo`, monto: -e.devoluciones.monto, tipo: "resta" },
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
          const color = f.tipo === "final" ? (f.monto < 0 ? "var(--estado-critico)" : "var(--exito-texto)") : total ? "var(--ink-1)" : "var(--ink-2)";
          return (
            <tr key={f.etiqueta} style={total ? { background: "var(--surface-2)" } : undefined}>
              <td className={total ? "font-semibold" : ""} style={{ color: f.tipo === "final" ? color : undefined }}>
                {f.etiqueta}
                {f.nota ? (
                  <div className="text-xs font-normal" style={{ color: "var(--ink-muted)" }}>
                    {f.nota}
                  </div>
                ) : null}
              </td>
              <td className="hidden w-[40%] md:table-cell">
                <div className="h-2 rounded-full" style={{ width: `${Math.min(100, Math.abs(f.monto) * escala)}%`, background: f.tipo === "resta" ? "#f3b3ba" : f.tipo === "final" ? color : f.tipo === "total" ? "var(--acento)" : "var(--axis)" }} />
              </td>
              <td className={`num cifra ${total ? "font-semibold" : ""}`} style={{ color, fontSize: f.tipo === "final" ? "1.1rem" : undefined }}>
                {pesos(f.monto)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
