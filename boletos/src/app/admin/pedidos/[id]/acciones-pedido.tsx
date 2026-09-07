"use client";

import { useState, useTransition } from "react";
import {
  accionCancelarPedido,
  accionConfirmarPago,
  accionGuardarNotas,
  accionReactivarPedido,
  accionReenviarBoletos,
  type Resultado,
} from "../../acciones";

export function AccionesPedido({ pedidoId, estado, notas }: { pedidoId: string; estado: string; notas: string }) {
  const [res, setRes] = useState<Resultado>({});
  const [ocupado, empezar] = useTransition();
  const [texto, setTexto] = useState(notas);

  function correr(fn: () => Promise<Resultado>) {
    empezar(async () => setRes(await fn()));
  }

  return (
    <aside className="grid content-start gap-4">
      <section className="tarjeta p-6">
        <h2 className="font-bold">Acciones</h2>
        <div className="mt-4 grid gap-2">
          {(estado === "pendiente" || estado === "por_confirmar") && (
            <button
              className="boton"
              disabled={ocupado}
              onClick={() => {
                if (confirm("¿Confirmar que la transferencia llegó? Se emiten los boletos y se envían por correo.")) {
                  correr(() => accionConfirmarPago(pedidoId));
                }
              }}
            >
              ✅ Confirmar pago y enviar boletos
            </button>
          )}
          {estado === "pagado" && (
            <button className="boton boton-suave" disabled={ocupado} onClick={() => correr(() => accionReenviarBoletos(pedidoId))}>
              ✉️ Reenviar boletos por correo
            </button>
          )}
          {estado !== "cancelado" ? (
            <button
              className="boton boton-peligro"
              disabled={ocupado}
              onClick={() => {
                const motivo = prompt("Motivo de la cancelación (opcional):") ?? "";
                if (confirm("¿Cancelar este pedido? Sus boletos dejarán de entrar.")) {
                  correr(() => accionCancelarPedido(pedidoId, motivo));
                }
              }}
            >
              Cancelar pedido
            </button>
          ) : (
            <button className="boton boton-fantasma" disabled={ocupado} onClick={() => correr(() => accionReactivarPedido(pedidoId))}>
              Reactivar pedido
            </button>
          )}
        </div>
        {res.ok && <div className="aviso aviso-bien mt-3">{res.ok}</div>}
        {res.error && <div className="aviso aviso-mal mt-3">{res.error}</div>}
      </section>

      <section className="tarjeta p-6">
        <h2 className="font-bold">Notas internas</h2>
        <textarea
          className="mt-3 w-full rounded-xl border p-3 text-sm"
          style={{ borderColor: "var(--borde)" }}
          rows={4}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ej. transferencia llegó con otro concepto, pidió factura…"
        />
        <button className="boton boton-fantasma mt-2 !py-2 text-sm" disabled={ocupado} onClick={() => correr(() => accionGuardarNotas(pedidoId, texto))}>
          Guardar notas
        </button>
      </section>
    </aside>
  );
}
