"use client";

import Link from "next/link";
import { pesos } from "@/lib/tienda";
import { useCarrito } from "./carrito";
import { useResumen } from "./resumen-carrito";

export function Carrito() {
  const { renglones, fijar } = useCarrito();
  const { resumen, cargando } = useResumen(renglones);

  if (!renglones.length) {
    return (
      <p className="nota">
        Tu carrito está vacío. <Link href="/">Ver el catálogo</Link>
      </p>
    );
  }
  if (!resumen) return <p className="suave">{cargando ? "Revisando existencias…" : "No pudimos revisar tu carrito. Recarga la página."}</p>;

  const problemas = resumen.renglones.filter((r) => r.noDisponible || (r.disponible ?? 0) < r.cantidad);
  const faltaParaGratis = resumen.regla.gratisDesde != null ? resumen.regla.gratisDesde - resumen.subtotal : null;

  return (
    <div className="dos-columnas">
      <div className="panel">
        {resumen.renglones.map((r) => {
          const sin = r.noDisponible || (r.disponible ?? 0) <= 0;
          return (
            <div key={r.skuId} className="renglon">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {r.imagen ? <img src={r.imagen} alt="" /> : <span />}
              <div>
                <div style={{ fontWeight: 600 }}>
                  {r.modelo && <span className="modelo" style={{ fontSize: 20, marginRight: 6 }}>{r.modelo}</span>}
                  {r.titulo ?? "Producto que ya no está a la venta"}
                </div>
                <div className="datos-chicos">{[r.color, r.talla ? `Talla ${r.talla}` : null].filter(Boolean).join(" · ")}</div>
                {sin ? (
                  <div className="datos-chicos" style={{ color: "var(--alerta)" }}>Agotado: quítalo para pagar</div>
                ) : (r.disponible ?? 0) < r.cantidad ? (
                  <div className="datos-chicos" style={{ color: "var(--alerta)" }}>Solo quedan {r.disponible}</div>
                ) : null}
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6 }}>
                  {!sin && (
                    <select
                      value={r.cantidad}
                      onChange={(e) => fijar(r.skuId, Number(e.target.value))}
                      aria-label="Cantidad"
                      style={{ height: 32, borderRadius: 4, border: "1px solid var(--linea)", background: "var(--hoja)" }}
                    >
                      {Array.from({ length: Math.max(r.cantidad, Math.min(10, r.disponible ?? 1)) }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  )}
                  <button className="enlace" onClick={() => fijar(r.skuId, 0)}>
                    Quitar
                  </button>
                </div>
              </div>
              <div style={{ fontWeight: 600 }}>{r.precio != null ? pesos(r.precio * r.cantidad) : "—"}</div>
            </div>
          );
        })}
      </div>

      <div className="panel" style={{ display: "grid", gap: 6 }}>
        <div className="suma">
          <span>Subtotal</span>
          <span>{pesos(resumen.subtotal)}</span>
        </div>
        <div className="suma">
          <span>Envío</span>
          <span>{resumen.envio ? pesos(resumen.envio) : "Gratis"}</span>
        </div>
        {faltaParaGratis != null && faltaParaGratis > 0 && resumen.envio > 0 && (
          <div className="datos-chicos">Te faltan {pesos(faltaParaGratis)} para el envío gratis.</div>
        )}
        <div className="suma suma-total">
          <span>Total</span>
          <span>{pesos(resumen.subtotal + resumen.envio)}</span>
        </div>
        {problemas.length > 0 && <p className="nota nota-error">Ajusta lo que está marcado en rojo para continuar.</p>}
        <Link
          href="/pagar"
          className="boton boton-comprar boton-ancho"
          aria-disabled={problemas.length > 0}
          style={problemas.length ? { pointerEvents: "none", opacity: 0.5 } : undefined}
        >
          Continuar al pago
        </Link>
      </div>
    </div>
  );
}
