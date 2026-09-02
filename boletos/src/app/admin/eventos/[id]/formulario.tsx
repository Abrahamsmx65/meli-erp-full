"use client";

import { useState, useTransition } from "react";
import { accionGuardarEvento, type Resultado } from "../../acciones";

interface Valores {
  nombre: string;
  descripcion: string | null;
  lugar: string | null;
  fecha: string;
  precio: number;
  capacidad: number;
  maximo_por_pedido: number;
  datos_transferencia: string;
  activo: boolean;
}

export function FormularioEvento({ id, valores }: { id: string | null; valores: Valores }) {
  const [res, setRes] = useState<Resultado>({});
  const [ocupado, empezar] = useTransition();

  return (
    <form
      className="grid gap-4"
      action={(form) => empezar(async () => setRes((await accionGuardarEvento(id, form)) ?? {}))}
    >
      <label className="campo">Nombre del evento<input name="nombre" required defaultValue={valores.nombre} /></label>
      <label className="campo">Descripción<textarea name="descripcion" rows={4} defaultValue={valores.descripcion ?? ""} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="campo">Lugar<input name="lugar" defaultValue={valores.lugar ?? ""} /></label>
        <label className="campo">Fecha y hora (hora de México)<input name="fecha" type="datetime-local" required defaultValue={valores.fecha} /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="campo">Precio por boleto (MXN)<input name="precio" type="number" min={0} step="0.01" required defaultValue={valores.precio} /></label>
        <label className="campo">Capacidad total<input name="capacidad" type="number" min={1} required defaultValue={valores.capacidad} /></label>
        <label className="campo">Máximo por pedido<input name="maximo_por_pedido" type="number" min={1} required defaultValue={valores.maximo_por_pedido} /></label>
      </div>
      <label className="campo">
        Datos para transferir (se muestran tal cual al comprador)
        <textarea
          name="datos_transferencia"
          rows={5}
          defaultValue={valores.datos_transferencia}
          placeholder={"Banco: BBVA\nCLABE: 012 345 678 901 234 567\nBeneficiario: Nombre Apellido\nConcepto: la referencia de tu pedido"}
        />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input name="activo" type="checkbox" defaultChecked={valores.activo} /> Venta abierta (aparece en la página principal)
      </label>
      {res.error && <div className="aviso aviso-mal">{res.error}</div>}
      <button className="boton" disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar evento"}</button>
    </form>
  );
}
