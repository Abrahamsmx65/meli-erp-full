"use client";

import { useState, useTransition } from "react";
import { accionGuardarEvento, type Resultado } from "../../acciones";

interface Valores {
  nombre: string;
  descripcion: string | null;
  lugar: string | null;
  fecha: string;
  capacidad: number;
  maximo_por_pedido: number;
  datos_transferencia: string;
  activo: boolean;
  imagen_url: string | null;
  informes: string | null;
  donativo_nombre: string | null;
  donativo_monto: number | null;
  donativo_descripcion: string | null;
}

export function FormularioEvento({ id, valores }: { id: string | null; valores: Valores }) {
  const [res, setRes] = useState<Resultado>({});
  const [ocupado, empezar] = useTransition();

  return (
    <form className="grid gap-4" action={(form) => empezar(async () => setRes((await accionGuardarEvento(id, form)) ?? {}))}>
      <label className="campo">Nombre del evento<input name="nombre" required defaultValue={valores.nombre} /></label>
      <label className="campo">Descripción<textarea name="descripcion" rows={3} defaultValue={valores.descripcion ?? ""} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="campo">Lugar (dirección, colonia)<input name="lugar" defaultValue={valores.lugar ?? ""} placeholder="Hacienda del Ciervo #16, Cibeles" /></label>
        <label className="campo">Fecha y hora (hora de México)<input name="fecha" type="datetime-local" required defaultValue={valores.fecha} /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="campo">Límite total de boletos<input name="capacidad" type="number" min={1} required defaultValue={valores.capacidad} /></label>
        <label className="campo">Máximo de boletos por pedido<input name="maximo_por_pedido" type="number" min={1} required defaultValue={valores.maximo_por_pedido} /></label>
      </div>
      <label className="campo">
        Datos para transferir (se muestran tal cual al comprador)
        <textarea name="datos_transferencia" rows={5} defaultValue={valores.datos_transferencia}
          placeholder={"Banco: BBVA\nCLABE: 012 345 678 901 234 567\nBeneficiario: Nombre Apellido\nConcepto: la referencia de tu pedido"} />
      </label>
      <label className="campo">Informes (nombres y teléfonos)<textarea name="informes" rows={2} defaultValue={valores.informes ?? ""} /></label>
      <label className="campo">Imagen de la invitación (URL o ruta)<input name="imagen_url" defaultValue={valores.imagen_url ?? ""} placeholder="/jala-le-zibug.png" /></label>

      <fieldset className="grid gap-3 rounded-xl border p-4" style={{ borderColor: "var(--borde)" }}>
        <legend className="px-1 text-sm font-bold" style={{ color: "var(--tinta-2)" }}>Donativo opcional (déjalo en 0 para no ofrecerlo)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="campo">Nombre<input name="donativo_nombre" defaultValue={valores.donativo_nombre ?? ""} placeholder="Misheberaj" /></label>
          <label className="campo">Monto (MXN)<input name="donativo_monto" type="number" min={0} step="0.01" defaultValue={valores.donativo_monto ?? 0} /></label>
        </div>
        <label className="campo">Descripción<input name="donativo_descripcion" defaultValue={valores.donativo_descripcion ?? ""} placeholder="Especial para Shidujim…" /></label>
      </fieldset>

      <label className="flex items-center gap-2 text-sm font-semibold">
        <input name="activo" type="checkbox" defaultChecked={valores.activo} /> Venta abierta
      </label>
      {res.error && <div className="aviso aviso-mal">{res.error}</div>}
      <button className="boton" disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar evento"}</button>
    </form>
  );
}
