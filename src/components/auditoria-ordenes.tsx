import type { AuditoriaFinanzas, OrdenAuditada } from "@/lib/servicios/finanzas/tipos";
import { BotonDescarga } from "@/components/ui/boton-descarga";

/** Centavos → "$1,234.56". Lo único que este componente "calcula". */
function pesos(c: number | null): string {
  if (c == null) return "—";
  const signo = c < 0 ? "−" : "";
  return `${signo}$${(Math.abs(c) / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Fila({ o }: { o: OrdenAuditada }) {
  const retenciones = o.isr + o.iva + o.retencionSinSeparar;
  const fuente =
    o.fuente === "v1/payments" ? "pago real" : o.fuente === "collections" ? "forma vieja" : "sin leer";
  return (
    <tr>
      <td className="cifra">
        <a
          href={`https://www.mercadolibre.com.mx/ventas/${o.orderId}/detalle`}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--acento)" }}
          title="Abrir la venta en Mercado Libre"
        >
          {o.orderId}
        </a>
      </td>
      <td className="cifra">{o.fecha}</td>
      <td>{o.tipoVenta === "reventa" ? "Reventa" : "Directa"}</td>
      <td className="num cifra">{pesos(o.total)}</td>
      <td className="num cifra" style={{ color: "var(--ink-2)" }}>{o.tipoVenta === "reventa" ? pesos(o.totalComprador) : ""}</td>
      <td className="num cifra">{pesos(-o.comision)}</td>
      <td className="num cifra">{pesos(-o.envio)}</td>
      <td className="num cifra">{pesos(-retenciones)}</td>
      <td className="num cifra" style={{ color: o.otros + o.sinDesglosar !== 0 ? "var(--estado-alerta)" : "var(--ink-2)" }}>
        {pesos(-(o.otros + o.sinDesglosar))}
      </td>
      <td className="num cifra font-semibold">{pesos(o.neto)}</td>
      <td className="text-xs" style={{ color: o.fuente === "v1/payments" ? "var(--ink-2)" : "var(--estado-alerta)" }}>
        {fuente}
        {o.completa === false ? " · comisión a medias" : ""}
        {o.reembolsado > 0 ? ` · reembolso ${pesos(o.reembolsado)}` : ""}
      </td>
    </tr>
  );
}

function Tabla({ titulo, nota, ordenes }: { titulo: string; nota: string; ordenes: OrdenAuditada[] }) {
  return (
    <div>
      <h3 className="px-4 pt-3 text-sm font-semibold">{titulo}</h3>
      <p className="px-4 pb-2 text-xs" style={{ color: "var(--ink-2)" }}>
        {nota}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="datos">
          <thead>
            <tr>
              <th>Orden</th>
              <th>Fecha</th>
              <th>Tipo</th>
              <th className="num">Total</th>
              <th className="num">Precio público</th>
              <th className="num">Comisión</th>
              <th className="num">Envío</th>
              <th className="num">Retenciones</th>
              <th className="num">Otros / sin desglosar</th>
              <th className="num">Neto</th>
              <th>Desglose</th>
            </tr>
          </thead>
          <tbody>
            {ordenes.length ? (
              ordenes.map((o) => <Fila key={o.orderId} o={o} />)
            ) : (
              <tr>
                <td colSpan={11} className="text-sm" style={{ color: "var(--ink-2)" }}>
                  Sin órdenes en el rango.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Auditoría por orden: la cascada de cada venta tal como quedó guardada,
 * para abrirla en Mercado Pago y cotejar. Solo presenta lo que ya viene en
 * el renglón masticado; el Excel completo se pide aparte.
 */
export function AuditoriaOrdenes({
  auditoria,
  rango,
}: {
  auditoria: AuditoriaFinanzas | undefined;
  rango: { desde: string; hasta: string };
}) {
  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4 hairline">
        <div>
          <h2 className="text-base font-semibold">Auditoría por orden</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Cada renglón es una venta con lo que Mercado Pago cobró y depositó, para abrirla y
            cotejarla al centavo. «Pago real» = leída de Mercado Pago con retenciones y envío
            exactos; «forma vieja» o «sin leer» se recargan en segundo plano.
          </p>
        </div>
        <BotonDescarga
          href={`/api/ventas/auditoria?desde=${rango.desde}&hasta=${rango.hasta}`}
          nombre={`auditoria-ordenes-${rango.desde}_${rango.hasta}.xlsx`}
          chico
        >
          Excel de todas las órdenes
        </BotonDescarga>
      </header>
      {auditoria ? (
        <>
          <Tabla
            titulo="Las 20 órdenes más grandes del periodo"
            nota="Donde un error de cargos pesa más."
            ordenes={auditoria.mayores}
          />
          <Tabla
            titulo="Las 20 leídas más recientemente"
            nota="Lo último que el trabajo de fondo escribió; aquí se ve avanzar la recarga."
            ordenes={auditoria.recientes}
          />
        </>
      ) : (
        <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
          La muestra se arma en el siguiente refresco del periodo; el Excel ya está disponible.
        </p>
      )}
    </section>
  );
}
