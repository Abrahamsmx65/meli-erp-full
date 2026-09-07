"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AmarreManual } from "@/lib/servicios/tiktok-panel";

/**
 * Los amarres capturados a mano, siempre a la vista: mandan sobre la
 * normalización para siempre, así que no pueden vivir escondidos. Cuando
 * uno huele a viejo (la publicación ya no existe, el destino quedó sin
 * vida) se marca; quitarlo regresa la publicación a la escalera normal.
 */
export function AmarresTikTok({ amarres }: { amarres: AmarreManual[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!amarres.length) return null;
  const conAviso = amarres.filter((a) => a.aviso).length;

  async function quitar(a: AmarreManual) {
    if (!confirm(`Quitar el amarre ${a.skuTikTok} → ${a.skuInterno}? La publicación se re-amarra sola en la siguiente corrida (o sale en Pendientes).`)) return;
    setOcupado(a.skuTikTok);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/mapeo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuTikTok: a.skuTikTok }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo quitar.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b p-4 hairline">
        <h2 className="text-sm font-semibold">
          Amarres a mano ({amarres.length})
          {conAviso ? (
            <span className="ml-2 rounded-full px-2 text-[11px] font-semibold" style={{ background: "color-mix(in oklab, var(--estado-alerta) 15%, transparent)", color: "var(--estado-alerta)" }}>
              {conAviso} por revisar
            </span>
          ) : null}
        </h2>
        <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
          Mandan sobre la normalización para siempre. Si algo se renombra en la bodega o en TikTok,
          revisa aquí primero: quitar un amarre regresa la publicación a la escalera normal.
        </p>
      </header>
      {error ? <p className="px-4 pt-2 text-xs" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
      <ul className="divide-y" style={{ borderColor: "var(--grid)" }}>
        {amarres.map((a) => (
          <li key={a.skuTikTok} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm hairline">
            <span className="min-w-0">
              <span className="font-medium">{a.skuTikTok}</span>
              <span style={{ color: "var(--ink-2)" }}> → {a.skuInterno}</span>
              {a.nota ? <span className="block text-xs" style={{ color: "var(--ink-muted)" }}>{a.nota}</span> : null}
              {a.aviso ? (
                <span className="block text-xs font-medium" style={{ color: "var(--estado-alerta)" }}>{a.aviso}</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => void quitar(a)}
              disabled={ocupado === a.skuTikTok}
              className="rounded-lg border px-2.5 py-1 text-xs disabled:opacity-50"
              style={{ borderColor: "var(--grid)", color: "var(--ink-2)" }}
            >
              {ocupado === a.skuTikTok ? "Quitando…" : "Quitar"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
