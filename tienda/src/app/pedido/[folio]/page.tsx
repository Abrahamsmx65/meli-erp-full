import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { aplicarPago, pedidoPorFolio } from "@/lib/pedidos";
import { clienteActual, mismoToken } from "@/lib/sesion";
import { ESTADO_PARA_CLIENTE, pesos } from "@/lib/tienda";

export const metadata: Metadata = { title: "Tu pedido", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * El pedido se ve con su liga (token) o con la sesión del cliente dueño.
 * Al volver de Mercado Pago se lee el pago en el acto, sin esperar el aviso.
 */
export default async function Pedido({
  params,
  searchParams,
}: {
  params: Promise<{ folio: string }>;
  searchParams: Promise<{ t?: string; payment_id?: string; collection_id?: string }>;
}) {
  const [{ folio }, sp] = await Promise.all([params, searchParams]);
  let pedido = await pedidoPorFolio(folio);
  if (!pedido) notFound();
  const cliente = await clienteActual();
  const autorizado = (sp.t && mismoToken(sp.t, pedido.token)) || (cliente && cliente.email === pedido.email);
  if (!autorizado) notFound();

  const pagoId = sp.payment_id ?? sp.collection_id;
  if (pagoId && /^\d+$/.test(pagoId) && pedido.estado === "pendiente_pago") {
    await aplicarPago(pagoId);
    pedido = (await pedidoPorFolio(folio)) ?? pedido;
  }
  const estado = ESTADO_PARA_CLIENTE[pedido.estado] ?? { titulo: pedido.estado, detalle: "" };
  const d = pedido.direccion;

  return (
    <div className="contenedor pagina">
      <div>
        <div className="mono suave">PEDIDO</div>
        <h1 className="modelo" style={{ fontSize: 56 }}>
          {pedido.folio}
        </h1>
      </div>
      <div className="estado-pedido" role="status">
        <h2>{estado.titulo}</h2>
        <p style={{ margin: 0 }}>{estado.detalle}</p>
        {pedido.guia && (
          <p style={{ margin: 0 }}>
            Guía <span className="mono">{pedido.guia}</span>
            {pedido.paqueteria ? ` · ${pedido.paqueteria}` : ""}
          </p>
        )}
      </div>

      <div className="dos-columnas">
        <div className="panel">
          {pedido.items.map((it, i) => (
            <div key={i} className="renglon">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {it.imagen ? <img src={it.imagen} alt="" /> : <span />}
              <div>
                <div style={{ fontWeight: 600 }}>{it.titulo}</div>
                <div className="datos-chicos">
                  {[it.color, it.talla ? `Talla ${it.talla}` : null].filter(Boolean).join(" · ")} · ×{it.cantidad}
                </div>
              </div>
              <div style={{ fontWeight: 600 }}>{pesos(it.precio * it.cantidad)}</div>
            </div>
          ))}
        </div>
        <div className="panel" style={{ display: "grid", gap: 6 }}>
          <div className="suma">
            <span>Subtotal</span>
            <span>{pesos(pedido.subtotal)}</span>
          </div>
          <div className="suma">
            <span>Envío</span>
            <span>{pedido.envio ? pesos(pedido.envio) : "Gratis"}</span>
          </div>
          <div className="suma suma-total">
            <span>Total</span>
            <span>{pesos(pedido.total)}</span>
          </div>
          <div className="datos-chicos" style={{ marginTop: 10 }}>
            Se envía a {pedido.nombre}: {[d.calle, d.numero, d.interior && `int. ${d.interior}`, d.colonia, d.cp, d.ciudad, d.estado].filter(Boolean).join(", ")}
          </div>
        </div>
      </div>
      <p>
        <Link href="/">Seguir comprando</Link>
      </p>
    </div>
  );
}
