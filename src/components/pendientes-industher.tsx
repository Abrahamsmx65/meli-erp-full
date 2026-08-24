"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EnvioPendiente } from "@/lib/servicios/industher-pendientes";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Los envíos pendientes que la bodega (Industher) ya tiene apartados para
 * salir a MELI Full (id que empieza con 7 u 8). Van hasta arriba de Envíos
 * a Full: el plan los está CONSIDERANDO como en camino, y aquí se puede
 * tachar el que no deba contar. Cuando la bodega lo marca recibido, deja de
 * venir del API y desaparece solo.
 */
export function PendientesIndusther({
  envios,
  error,
}: {
  envios: EnvioPendiente[];
  error: string | null;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const deMeli = envios.filter((e) => e.esMeli);

  if (error) {
    return (
      <section
        className="rounded-lg p-3 text-sm"
        style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
      >
        No pude leer los envíos pendientes de la bodega: {error}
      </section>
    );
  }
  if (!deMeli.length) return null;

  async function marcar(e: EnvioPendiente) {
    setOcupado(e.id);
    setAviso(null);
    try {
      const r = await fetch("/api/envios-pendientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envioId: e.id, omitir: !e.omitido }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      router.refresh();
    } catch (err) {
      setAviso((err as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const activos = deMeli.filter((e) => !e.omitido);

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b p-3 hairline">
        <div>
          <h2 className="text-sm font-semibold">Envíos pendientes en la bodega (a MELI Full)</h2>
          <p className="text-xs" style={{ color: "var(--ink-2)" }}>
            Estos ya están apartados para salir y el plan LOS ESTÁ CONSIDERANDO como en
            camino. Tacha el que no deba contar; al recibirse en Full desaparecen solos.
          </p>
        </div>
        <span
          className="cifra ml-auto rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ background: "var(--acento-suave)", color: "var(--acento)" }}
        >
          {n(activos.reduce((a, e) => a + e.pares, 0))} pares considerados
        </span>
      </header>

      <table className="datos">
        <thead>
          <tr>
            <th>ID del envío</th>
            <th>Fecha</th>
            <th className="num">Cajas</th>
            <th className="num">Pares</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {deMeli.map((e) => (
            <tr key={e.id} style={{ opacity: e.omitido ? 0.5 : 1 }}>
              <td className="cifra font-medium" style={{ textDecoration: e.omitido ? "line-through" : "none" }}>
                {e.id}
              </td>
              <td className="text-xs">{e.fecha ? e.fecha.slice(0, 10) : "—"}</td>
              <td className="num cifra">{e.cajas ? n(e.cajas) : "—"}</td>
              <td className="num cifra">{n(e.pares)}</td>
              <td className="text-xs" style={{ color: e.omitido ? "var(--ink-muted)" : "var(--exito-texto)" }}>
                {e.omitido ? "Tachado: no cuenta" : "Contando como en camino"}
              </td>
              <td>
                <button
                  onClick={() => marcar(e)}
                  disabled={ocupado === e.id}
                  className="rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50"
                  style={{ borderColor: "var(--borde)" }}
                >
                  {ocupado === e.id ? "…" : e.omitido ? "Volver a contar" : "Tachar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {aviso ? (
        <p className="border-t p-3 text-sm hairline" style={{ color: "var(--estado-critico)" }}>
          {aviso}
        </p>
      ) : null}
    </section>
  );
}
