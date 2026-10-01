"use client";

import Link from "next/link";
import { useState } from "react";
import { ESTADOS_MX, pesos, type DatosEnvio } from "@/lib/tienda";
import { useCarrito } from "./carrito";
import { useResumen } from "./resumen-carrito";

type Errores = Partial<Record<keyof DatosEnvio, string>>;

export function FormularioPago({ inicial, conCuenta }: { inicial: DatosEnvio; conCuenta: boolean }) {
  const { renglones } = useCarrito();
  const { resumen } = useResumen(renglones);
  const [d, setD] = useState<DatosEnvio>(inicial);
  const [errores, setErrores] = useState<Errores>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!renglones.length) {
    return (
      <p className="nota">
        Tu carrito está vacío. <Link href="/">Ver el catálogo</Link>
      </p>
    );
  }

  const campo = (k: keyof DatosEnvio, etiqueta: string, clase = "", extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={`campo ${clase}`}>
      {etiqueta}
      <input
        value={d[k]}
        onChange={(e) => setD({ ...d, [k]: e.target.value })}
        aria-invalid={Boolean(errores[k])}
        {...extra}
      />
      {errores[k] && <span className="error">{errores[k]}</span>}
    </label>
  );

  async function pagar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMensaje(null);
    setErrores({});
    try {
      const res = await fetch("/api/pagar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: renglones, datos: d }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErrores(j.errores ?? {});
        setMensaje(j.error ?? "No se pudo continuar.");
        return;
      }
      // El carrito se vacía hasta que el pedido existe: si Mercado Pago falla, no se pierde.
      localStorage.removeItem("getac-carrito-v1");
      window.location.href = j.url;
    } catch {
      setMensaje("Se cortó la conexión. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="dos-columnas" onSubmit={pagar} noValidate>
      <div className="panel" style={{ display: "grid", gap: 16 }}>
        {!conCuenta && (
          <p className="datos-chicos" style={{ margin: 0 }}>
            ¿Ya compraste antes? <Link href="/cuenta?volver=/pagar">Entra a tu cuenta</Link> y llenamos tus datos.
          </p>
        )}
        <div className="campos">
          {campo("email", "Correo", "campo-medio", { type: "email", autoComplete: "email", inputMode: "email" })}
          {campo("telefono", "Teléfono (10 dígitos)", "campo-medio", { type: "tel", autoComplete: "tel", inputMode: "tel" })}
          {campo("nombre", "Nombre de quien recibe", "", { autoComplete: "name" })}
          {campo("calle", "Calle", "campo-medio", { autoComplete: "address-line1" })}
          {campo("numero", "Número", "campo-tercio")}
          {campo("interior", "Interior (opcional)", "campo-tercio")}
          {campo("colonia", "Colonia", "campo-medio")}
          {campo("cp", "Código postal", "campo-tercio", { inputMode: "numeric", autoComplete: "postal-code", maxLength: 5 })}
          {campo("ciudad", "Ciudad o municipio", "campo-medio", { autoComplete: "address-level2" })}
          <label className="campo campo-medio">
            Estado
            <select value={d.estado} onChange={(e) => setD({ ...d, estado: e.target.value })} aria-invalid={Boolean(errores.estado)}>
              <option value="">Elige…</option>
              {ESTADOS_MX.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
            {errores.estado && <span className="error">{errores.estado}</span>}
          </label>
          <label className="campo">
            Referencias para el repartidor (opcional)
            <textarea value={d.referencias} onChange={(e) => setD({ ...d, referencias: e.target.value })} maxLength={240} />
          </label>
        </div>
      </div>

      <div className="panel" style={{ display: "grid", gap: 6 }}>
        {resumen?.renglones.map((r) => (
          <div key={r.skuId} className="suma datos-chicos">
            <span>
              {r.modelo ?? ""} {[r.color, r.talla].filter(Boolean).join(" / ")} ×{r.cantidad}
            </span>
            <span>{r.precio != null ? pesos(r.precio * r.cantidad) : "—"}</span>
          </div>
        ))}
        <div className="suma">
          <span>Envío</span>
          <span>{resumen ? (resumen.envio ? pesos(resumen.envio) : "Gratis") : "…"}</span>
        </div>
        <div className="suma suma-total">
          <span>Total</span>
          <span>{resumen ? pesos(resumen.subtotal + resumen.envio) : "…"}</span>
        </div>
        {mensaje && (
          <p className="nota nota-error" role="alert">
            {mensaje} {mensaje.includes("carrito") && <Link href="/carrito">Revisar carrito</Link>}
          </p>
        )}
        <button className="boton boton-comprar boton-ancho" disabled={enviando}>
          {enviando ? "Apartando tus pares…" : "Pagar con Mercado Pago"}
        </button>
        <p className="datos-chicos" style={{ margin: 0 }}>
          Tarjeta, meses sin intereses, OXXO o transferencia. Tus pares quedan apartados mientras pagas.
        </p>
      </div>
    </form>
  );
}
