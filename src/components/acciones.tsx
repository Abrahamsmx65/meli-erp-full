"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BotonesPlan() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function correr(tarea: "sync" | "guardar") {
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
