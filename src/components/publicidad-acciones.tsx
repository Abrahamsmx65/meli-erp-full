"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Acciones del panel de Publicidad: pausar/encender anuncios y editar el
 * presupuesto o el ACOS objetivo de una campaña, sin salir del ERP. Cada
 * acción pega a nuestras rutas (/api/publicidad/*), que escriben en MELI y
 * llevan la memoria de pausas para los recordatorios.
 */

async function llamar(ruta: string, cuerpo: unknown): Promise<string | null> {
  try {
    const res = await fetch(ruta, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return json.error ?? `Error ${res.status}`;
  } catch {
    return "No hubo respuesta del servidor.";
  }
}

/** Botón que pausa o enciende UN anuncio. */
export function BotonAnuncio({
  itemId,
  estado,
  modelo,
  motivo,
}: {
  itemId: string;
  /** estado actual en MELI */
  estado: string | null;
  modelo: string;
  /** por qué se pausa (queda en la memoria para el recordatorio) */
  motivo?: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pausado = estado === "paused";
  const destino = pausado ? "active" : "paused";

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true);
          setError(null);
          const err = await llamar("/api/publicidad/anuncio", {
            itemId,
            estado: destino,
            modelo,
            motivo: destino === "paused" ? (motivo ?? "") : "",
          });
          setOcupado(false);
          if (err) setError(err);
          else router.refresh();
        }}
        className="rounded-md border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
        style={
          pausado
            ? { borderColor: "var(--exito-texto)", color: "var(--exito-texto)" }
            : { borderColor: "var(--estado-critico)", color: "var(--estado-critico)" }
        }
        title={itemId}
      >
        {ocupado ? "…" : pausado ? "Encender" : "Pausar"}
      </button>
      {error ? (
        <span className="text-[10px]" style={{ color: "var(--estado-critico)" }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Fila editable de una campaña: presupuesto diario y ACOS objetivo. */
export function EditorCampana({
  id,
  presupuesto,
  acosObjetivo,
}: {
  id: string;
  presupuesto: number | null;
  acosObjetivo: number | null;
}) {
  const router = useRouter();
  const [pres, setPres] = useState(presupuesto != null ? String(presupuesto) : "");
  const [acos, setAcos] = useState(acosObjetivo != null ? String(acosObjetivo) : "");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const sinCambios =
    pres === (presupuesto != null ? String(presupuesto) : "") &&
    acos === (acosObjetivo != null ? String(acosObjetivo) : "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--ink-2)" }}>
        $/día
        <input
          type="number"
          min="1"
          step="1"
          value={pres}
          onChange={(e) => setPres(e.target.value)}
          className="w-20 rounded-md border px-1.5 py-0.5 text-xs"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          aria-label="Presupuesto diario"
        />
      </label>
      <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--ink-2)" }}>
        ACOS obj. %
        <input
          type="number"
          min="1"
          max="100"
          step="0.5"
          value={acos}
          onChange={(e) => setAcos(e.target.value)}
          className="w-16 rounded-md border px-1.5 py-0.5 text-xs"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          aria-label="ACOS objetivo"
        />
      </label>
      <button
        disabled={ocupado || sinCambios}
        onClick={async () => {
          setOcupado(true);
          setAviso(null);
          const err = await llamar("/api/publicidad/campana", {
            campanaId: id,
            presupuesto: pres || undefined,
            acosObjetivo: acos || undefined,
          });
          setOcupado(false);
          if (err) setAviso(err);
          else {
            setAviso("Guardado.");
            router.refresh();
          }
        }}
        className="rounded-md border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40"
        style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
      >
        {ocupado ? "…" : "Guardar"}
      </button>
      {aviso ? (
        <span
          className="text-[10px]"
          style={{
            color: aviso === "Guardado." ? "var(--exito-texto)" : "var(--estado-critico)",
          }}
        >
          {aviso}
        </span>
      ) : null}
    </div>
  );
}
