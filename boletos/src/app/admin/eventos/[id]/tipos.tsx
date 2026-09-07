"use client";

import { useState, useTransition } from "react";
import { pesos } from "@/lib/formato";
import { accionBorrarTipo, accionGuardarTipo, type Resultado } from "../../acciones";

interface Tipo {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  limite: number | null;
  orden: number;
  activo: boolean;
  ocupados: number;
}

export function TiposBoleto({ eventoId, tipos }: { eventoId: string; tipos: Tipo[] }) {
  const [res, setRes] = useState<Resultado>({});
  const [editando, setEditando] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [ocupado, empezar] = useTransition();

  function guardar(tipoId: string | null, form: FormData) {
    empezar(async () => {
      const r = await accionGuardarTipo(eventoId, tipoId, form);
      setRes(r);
      if (r.ok) {
        setEditando(null);
        setNuevo(false);
      }
    });
  }

  return (
    <div className="grid gap-3">
      {tipos.map((t) =>
        editando === t.id ? (
          <FormaTipo key={t.id} valores={t} ocupado={ocupado} onGuardar={(f) => guardar(t.id, f)} onCancelar={() => setEditando(null)} />
        ) : (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: "var(--borde)", opacity: t.activo ? 1 : 0.6 }}>
            <div>
              <div className="font-bold">{t.nombre} {!t.activo && <span className="pastilla pastilla-cancelado">Inactivo</span>}</div>
              <div className="text-xs" style={{ color: "var(--tinta-suave)" }}>
                {t.descripcion}{t.descripcion && " · "}{t.ocupados} pedidos{t.limite != null && ` de ${t.limite}`}
              </div>
            </div>
            <div className="serif text-2xl font-bold" style={{ color: "var(--vino)" }}>{pesos(t.precio)}</div>
            <div className="flex gap-2">
              <button className="boton boton-suave !px-3 !py-1.5 text-sm" onClick={() => setEditando(t.id)}>Editar</button>
              <button
                className="boton boton-fantasma !px-3 !py-1.5 text-sm"
                disabled={ocupado}
                onClick={() => {
                  if (confirm(`¿Quitar "${t.nombre}"? Si ya tiene pedidos solo se desactiva.`)) {
                    empezar(async () => setRes(await accionBorrarTipo(eventoId, t.id)));
                  }
                }}
              >
                Quitar
              </button>
            </div>
          </div>
        ),
      )}

      {nuevo ? (
        <FormaTipo valores={null} ocupado={ocupado} onGuardar={(f) => guardar(null, f)} onCancelar={() => setNuevo(false)} />
      ) : (
        <button className="boton boton-oro w-fit" onClick={() => setNuevo(true)}>+ Agregar tipo de boleto</button>
      )}

      {res.ok && <div className="aviso aviso-bien">{res.ok}</div>}
      {res.error && <div className="aviso aviso-mal">{res.error}</div>}
    </div>
  );
}

function FormaTipo({ valores, ocupado, onGuardar, onCancelar }: { valores: Tipo | null; ocupado: boolean; onGuardar: (f: FormData) => void; onCancelar: () => void }) {
  return (
    <form action={onGuardar} className="grid gap-3 rounded-xl border p-4" style={{ borderColor: "var(--oro)", background: "var(--oro-suave)" }}>
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_120px_90px]">
        <label className="campo">Nombre<input name="nombre" required defaultValue={valores?.nombre ?? ""} placeholder="Kit de Jalá" /></label>
        <label className="campo">Precio (MXN)<input name="precio" type="number" min={0} step="0.01" required defaultValue={valores?.precio ?? ""} /></label>
        <label className="campo">Límite (0 = sin)<input name="limite" type="number" min={0} defaultValue={valores?.limite ?? 0} /></label>
        <label className="campo">Orden<input name="orden" type="number" defaultValue={valores?.orden ?? 0} /></label>
      </div>
      <label className="campo">Descripción corta<input name="descripcion" defaultValue={valores?.descripcion ?? ""} placeholder="Incluye tu kit para hacer Jalá" /></label>
      <label className="flex items-center gap-2 text-sm font-semibold"><input name="activo" type="checkbox" defaultChecked={valores?.activo ?? true} /> Disponible para la venta</label>
      <div className="flex gap-2">
        <button className="boton !py-2" disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar"}</button>
        <button type="button" className="boton boton-fantasma !py-2" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
