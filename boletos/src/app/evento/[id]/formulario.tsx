"use client";

import { useActionState, useState } from "react";
import { pesos } from "@/lib/formato";
import { accionCrearPedido, type EstadoFormulario } from "./acciones";

interface Props {
  eventoId: string;
  precio: number;
  maximo: number;
}

export function FormularioCompra({ eventoId, precio, maximo }: Props) {
  const [estado, enviar, cargando] = useActionState<EstadoFormulario, FormData>(accionCrearPedido, {});
  const [cantidad, setCantidad] = useState(Number(estado.campos?.cantidad ?? 1));
  const c = estado.campos ?? {};

  return (
    <form action={enviar} className="grid gap-4">
      <input type="hidden" name="evento_id" value={eventoId} />

      <label className="campo">
        Nombre completo
        <input name="nombre" required minLength={3} defaultValue={c.nombre} autoComplete="name" placeholder="Como aparecerá en tu boleto" />
      </label>
      <label className="campo">
        Correo electrónico
        <input name="correo" type="email" required defaultValue={c.correo} autoComplete="email" placeholder="Aquí te llegan los boletos" />
      </label>
      <label className="campo">
        Teléfono (opcional)
        <input name="telefono" type="tel" defaultValue={c.telefono} autoComplete="tel" placeholder="10 dígitos" />
      </label>
      <label className="campo">
        Cantidad de boletos
        <select name="cantidad" value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))}>
          {Array.from({ length: maximo }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "var(--plano)" }}>
        <span style={{ color: "var(--tinta-2)" }}>Total a transferir</span>
        <span className="text-xl font-extrabold">{pesos(precio * cantidad)}</span>
      </div>

      {estado.error && <div className="aviso aviso-mal">{estado.error}</div>}

      <button className="boton" type="submit" disabled={cargando}>
        {cargando ? "Registrando…" : "Apartar boletos"}
      </button>
      <p className="text-center text-xs" style={{ color: "var(--tinta-suave)" }}>
        Después de apartar te damos los datos para transferir. Tus boletos se emiten cuando confirmemos el pago.
      </p>
    </form>
  );
}
