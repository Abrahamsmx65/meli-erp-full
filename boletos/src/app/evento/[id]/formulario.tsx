"use client";

import { useActionState, useMemo, useState } from "react";
import { resumirCarrito } from "@/lib/carrito";
import { pesos } from "@/lib/formato";
import { accionCrearPedido, type EstadoFormulario } from "./acciones";

interface Tipo {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  disponibles: number | null;
}

interface Props {
  eventoId: string;
  tipos: Tipo[];
  maximoPorPedido: number;
  disponiblesEvento: number;
  donativo: { nombre: string | null; monto: number | null; descripcion: string | null };
}

export function FormularioCompra({ eventoId, tipos, maximoPorPedido, disponiblesEvento, donativo }: Props) {
  const [estado, enviar, cargando] = useActionState<EstadoFormulario, FormData>(accionCrearPedido, {});
  const c = estado.campos ?? {};
  const [cantidades, setCantidades] = useState<Record<string, number>>(() =>
    Object.fromEntries(tipos.map((t) => [t.id, Number(c[`tipo_${t.id}`] ?? 0)])),
  );
  const [donativos, setDonativos] = useState(Number(c.donativos ?? 0));

  const resumen = useMemo(
    () => resumirCarrito({ renglones: tipos.map((t) => ({ tipo_id: t.id, cantidad: cantidades[t.id] ?? 0 })), donativos }, tipos, donativo),
    [tipos, cantidades, donativos, donativo],
  );
  const topeBoletos = Math.min(maximoPorPedido, disponiblesEvento);
  const vacio = resumen.boletos === 0 && donativos === 0;

  function cambiar(id: string, delta: number, disponibles: number | null) {
    setCantidades((prev) => {
      const actual = prev[id] ?? 0;
      const otros = resumen.boletos - actual;
      let nuevo = Math.max(0, actual + delta);
      nuevo = Math.min(nuevo, topeBoletos - otros);
      if (disponibles != null) nuevo = Math.min(nuevo, disponibles);
      return { ...prev, [id]: Math.max(0, nuevo) };
    });
  }

  return (
    <form action={enviar} className="grid gap-5">
      <input type="hidden" name="evento_id" value={eventoId} />

      <fieldset className="grid gap-3">
        <legend className="serif mb-1 text-xl font-semibold" style={{ color: "var(--vino)" }}>Elige tus boletos</legend>
        {tipos.map((t) => {
          const n = cantidades[t.id] ?? 0;
          const agotado = t.disponibles === 0 || disponiblesEvento === 0;
          return (
            <div key={t.id} className="flex items-center justify-between gap-3 rounded-2xl border p-3" style={{ borderColor: "var(--borde)", background: "#fff" }}>
              <input type="hidden" name={`tipo_${t.id}`} value={n} />
              <div className="min-w-0">
                <div className="font-bold">{t.nombre}</div>
                <div className="serif text-xl font-semibold" style={{ color: "var(--vino)" }}>{pesos(t.precio)}</div>
                {t.descripcion && <div className="text-xs" style={{ color: "var(--tinta-suave)" }}>{t.descripcion}</div>}
                {agotado && <div className="text-xs font-bold" style={{ color: "var(--mal)" }}>Agotado</div>}
                {!agotado && t.disponibles != null && t.disponibles <= 10 && (
                  <div className="text-xs" style={{ color: "var(--alerta)" }}>Quedan {t.disponibles}</div>
                )}
              </div>
              <div className="contador">
                <button type="button" aria-label={`Quitar ${t.nombre}`} onClick={() => cambiar(t.id, -1, t.disponibles)} disabled={n === 0}>−</button>
                <output aria-live="polite">{n}</output>
                <button type="button" aria-label={`Agregar ${t.nombre}`} onClick={() => cambiar(t.id, 1, t.disponibles)} disabled={agotado || resumen.boletos >= topeBoletos || (t.disponibles != null && n >= t.disponibles)}>+</button>
              </div>
            </div>
          );
        })}
        <p className="text-xs" style={{ color: "var(--tinta-suave)" }}>
          Lugares no asignados. Máximo {maximoPorPedido} boletos por pedido.
        </p>
      </fieldset>

      {donativo.monto && (
        <div className="rounded-2xl p-4" style={{ background: "var(--oro-suave)", border: "1px solid var(--oro)" }}>
          <input type="hidden" name="donativos" value={donativos} />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold" style={{ color: "var(--vino)" }}>{donativo.nombre}</div>
              <div className="serif text-xl font-semibold">{pesos(donativo.monto)}</div>
              {donativo.descripcion && <div className="mt-1 text-xs" style={{ color: "var(--tinta-2)" }}>{donativo.descripcion}</div>}
            </div>
            <div className="contador">
              <button type="button" aria-label="Quitar donativo" onClick={() => setDonativos((d) => Math.max(0, d - 1))} disabled={donativos === 0}>−</button>
              <output>{donativos}</output>
              <button type="button" aria-label="Agregar donativo" onClick={() => setDonativos((d) => Math.min(10, d + 1))}>+</button>
            </div>
          </div>
        </div>
      )}

      <div className="separador-oro" />

      <div className="grid gap-3">
        <h3 className="serif text-xl font-semibold" style={{ color: "var(--vino)" }}>Tus datos</h3>
        <label className="campo">
          Nombre completo
          <input name="nombre" required minLength={3} defaultValue={c.nombre} autoComplete="name" placeholder="Como aparecerá en tus boletos" />
        </label>
        <label className="campo">
          Correo electrónico
          <input name="correo" type="email" required defaultValue={c.correo} autoComplete="email" placeholder="Aquí te llegan los boletos" />
        </label>
        <label className="campo">
          Teléfono / WhatsApp
          <input name="telefono" type="tel" defaultValue={c.telefono} autoComplete="tel" placeholder="10 dígitos" />
        </label>
      </div>

      <div className="rounded-2xl p-4" style={{ background: "var(--plano)" }}>
        {resumen.lineas.length === 0 && <div className="text-sm" style={{ color: "var(--tinta-suave)" }}>Todavía no has elegido nada.</div>}
        {resumen.lineas.map((l) => (
          <div key={l.nombre} className="flex justify-between text-sm">
            <span>{l.cantidad} × {l.nombre}</span>
            <span>{pesos(l.importe)}</span>
          </div>
        ))}
        <div className="mt-2 flex items-center justify-between border-t pt-2" style={{ borderColor: "var(--borde)" }}>
          <span className="font-semibold" style={{ color: "var(--tinta-2)" }}>Total a transferir</span>
          <span className="serif text-2xl font-bold" style={{ color: "var(--vino)" }}>{pesos(resumen.total)}</span>
        </div>
      </div>

      {estado.error && <div className="aviso aviso-mal">{estado.error}</div>}

      <button className="boton" type="submit" disabled={cargando || vacio}>
        {cargando ? "Registrando…" : "Apartar y ver datos para transferir"}
      </button>
      <p className="text-center text-xs" style={{ color: "var(--tinta-suave)" }}>
        Tus boletos con código QR se emiten cuando confirmemos tu transferencia.
      </p>
    </form>
  );
}
