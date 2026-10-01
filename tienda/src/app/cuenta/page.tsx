import type { Metadata } from "next";
import Link from "next/link";
import { pedidosDeCliente } from "@/lib/pedidos";
import { clienteActual } from "@/lib/sesion";
import { ESTADO_PARA_CLIENTE, pesos } from "@/lib/tienda";
import { Entrar, Salir } from "@/components/entrar";

export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Cuenta({ searchParams }: { searchParams: Promise<{ volver?: string }> }) {
  const { volver } = await searchParams;
  const cliente = await clienteActual();
  if (!cliente) {
    return (
      <div className="contenedor pagina" style={{ maxWidth: 480 }}>
        <h1>Entra a tu cuenta</h1>
        <p className="suave" style={{ margin: 0 }}>
          Sin contraseña: te mandamos un código de 6 dígitos a tu correo.
        </p>
        <Entrar volver={volver && volver.startsWith("/") && !volver.startsWith("//") ? volver : "/cuenta"} />
      </div>
    );
  }
  const pedidos = await pedidosDeCliente(cliente.id, cliente.email);
  return (
    <div className="contenedor pagina">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1>Mis pedidos</h1>
        <span className="datos-chicos">
          {cliente.email} · <Salir />
        </span>
      </div>
      {!pedidos.length ? (
        <p className="nota">
          Todavía no tienes pedidos. <Link href="/">Ver el catálogo</Link>
        </p>
      ) : (
        <div className="panel">
          {pedidos.map((p) => (
            <Link key={p.id} href={`/pedido/${p.folio}?t=${p.token}`} className="renglon" style={{ textDecoration: "none" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.items[0]?.imagen ? <img src={p.items[0].imagen} alt="" /> : <span />}
              <div>
                <div className="mono">{p.folio}</div>
                <div style={{ fontWeight: 600 }}>{ESTADO_PARA_CLIENTE[p.estado]?.titulo ?? p.estado}</div>
                <div className="datos-chicos">
                  {new Date(p.creadoEn).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })} ·{" "}
                  {p.items.reduce((s, i) => s + i.cantidad, 0)} pares
                </div>
              </div>
              <div style={{ fontWeight: 600 }}>{pesos(p.total)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
