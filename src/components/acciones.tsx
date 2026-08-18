"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BotonesPlan() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function correr(tarea: "sync" | "guardar" | "recalcular") {
    setOcupado(tarea);
    setAviso(null);
    setError(null);

    try {
      if (tarea === "sync") {
        const r = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Falló la sincronización.");
        const d = j.resultado;
        const extra = d.recuperadas > 0
          ? ` (${d.recuperadas} publicaciones recuperadas desde las órdenes)`
          : "";
        setAviso(
          `Listo: ${d.skus} SKUs${extra}, ${d.conStock} con stock en Full, ${d.ordenes} órdenes y ${d.operaciones} movimientos.`,
        );
      } else if (tarea === "recalcular") {
        const r = await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recalcular: true }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "No se pudo recalcular el plan.");
        setAviso(`Plan recalculado en ${((j.ms ?? 0) / 1000).toFixed(1)} s.`);
      } else {
        const r = await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guardar: true }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "No se pudo guardar el plan.");
        setAviso("Plan guardado en el historial.");
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => correr("sync")}
        disabled={ocupado !== null}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        style={{ background: "var(--acento)" }}
      >
        {ocupado === "sync" ? "Sincronizando…" : "Sincronizar con MELI"}
      </button>

      <button
        onClick={() => correr("recalcular")}
        disabled={ocupado !== null}
        className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        style={{ borderColor: "var(--borde)" }}
      >
        {ocupado === "recalcular" ? "Recalculando…" : "Recalcular"}
      </button>

      <button
        onClick={() => correr("guardar")}
        disabled={ocupado !== null}
        className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        style={{ borderColor: "var(--borde)" }}
      >
        {ocupado === "guardar" ? "Guardando…" : "Guardar este plan"}
      </button>

      {aviso ? (
        <span className="text-sm" style={{ color: "var(--exito-texto)" }}>
          {aviso}
        </span>
      ) : null}
      {error ? (
        <span className="text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}


/**
 * Dice de cuándo es el plan que estás viendo.
 *
 * El plan se guarda calculado para que la pantalla abra al instante. El
 * precio de eso es que puede quedar viejo, así que hay que decirlo: un plan
 * obsoleto presentado como fresco hace mandar cajas equivocadas.
 */
export function FrescuraPlan({
  generadoEn,
  vigente,
  motivo,
  msCalculo,
}: {
  generadoEn: string;
  vigente: boolean;
  motivo: string | null;
  msCalculo: number | null;
}) {
  const [recalculando, setRecalculando] = useState(false);
  const router = useRouter();

  const fecha = new Date(generadoEn);
  const minutos = Math.floor((Date.now() - fecha.getTime()) / 60000);
  const hace =
    minutos < 1 ? "hace un momento"
    : minutos < 60 ? `hace ${minutos} min`
    : minutos < 1440 ? `hace ${Math.floor(minutos / 60)} h`
    : `el ${fecha.toLocaleDateString("es-MX")}`;

  async function recalcular() {
    setRecalculando(true);
    try {
      await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recalcular: true }),
      });
      router.refresh();
    } finally {
      setRecalculando(false);
    }
  }

  return (
    <div
      className="tarjeta flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
      style={{
        borderColor: vigente ? "var(--borde)" : "var(--estado-alerta)",
        color: "var(--ink-2)",
      }}
    >
      <span aria-hidden="true" style={{ color: vigente ? "var(--exito-texto)" : "var(--estado-alerta)" }}>
        {vigente ? "●" : "■"}
      </span>
      <span>
        {vigente ? "Plan calculado" : "Plan desactualizado"} {hace}
        {msCalculo ? ` · tardó ${(msCalculo / 1000).toFixed(1)} s` : ""}
      </span>
      {!vigente && motivo ? (
        <span style={{ color: "var(--estado-alerta)" }}>· {motivo}</span>
      ) : null}
      <button
        onClick={recalcular}
        disabled={recalculando}
        className="underline disabled:opacity-60"
        style={{ color: "var(--acento)" }}
      >
        {recalculando ? "Recalculando…" : "Recalcular ahora"}
      </button>
    </div>
  );
}
