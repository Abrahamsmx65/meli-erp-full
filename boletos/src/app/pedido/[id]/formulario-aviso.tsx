"use client";

import { useActionState } from "react";
import { accionAvisarPago, type EstadoAviso } from "./acciones";

export function FormularioAviso({ pedidoId, yaAviso }: { pedidoId: string; yaAviso: boolean }) {
  const [estado, enviar, cargando] = useActionState<EstadoAviso, FormData>(accionAvisarPago, {});

  return (
    <form action={enviar} className="grid gap-3">
      <input type="hidden" name="pedido_id" value={pedidoId} />
      <label className="campo">
        Comprobante de transferencia (opcional, imagen o PDF)
        <input name="comprobante" type="file" accept="image/*,application/pdf" />
      </label>
      {estado.error && <div className="aviso aviso-mal">{estado.error}</div>}
      {estado.listo && <div className="aviso aviso-bien">¡Gracias! Ya nos avisaste. Te confirmamos por correo.</div>}
      <button className="boton" type="submit" disabled={cargando}>
        {cargando ? "Enviando…" : yaAviso ? "Volver a avisar / subir otro comprobante" : "Ya transferí, avisar"}
      </button>
    </form>
  );
}
