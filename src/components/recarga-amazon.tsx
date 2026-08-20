"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { EstadoRecarga } from "@/lib/servicios/amazon";

const OPCIONES = [30, 90, 180, 365];

/**
 * Recarga histórica de ventas.
 *
 * El botón sólo encola: el cron descarga una ventana de 30 días por corrida,
 * cada 5 minutos. Un año son 13 ventanas, así que tarda alrededor de una hora
 * en completarse — pero no hay nada que vigilar, avanza solo aunque cierres.
 */
export function RecargaAmazon({ estado }: { estado: EstadoRecarga }) {
  const router = useRouter();
  const [dias, setDias] = useState(90);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const enCola = estado.pendientes > 0;

  // Mientras hay cola, la pantalla se refresca sola para que se vea el avance.
  useEffect(() => {
    if (!enCola) return;
    const t = setInterval(() => router.refresh(), 45_000);
    return () => clearInterval(t);
  }, [enCola, router]);

  const recargar = async () => {
    setEnviando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/amazon/recargar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dias }),
      });
      const d = await r.json();
      setAviso(
        r.ok
          ? `En cola: ${d.ventanas} ventanas de 30 días. Avanza sola.`
          : (d.error ?? "No se pudo encolar."),
      );
      router.refresh();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const avance = estado.total > 0 ? Math.round((estado.listas / estado.total) * 100) : 0;

  return (
    <section className="tarjeta p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[16rem] flex-1">
          <h2 className="text-sm font-semibold">Recargar histórico</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
            La sincronización automática mantiene al día los últimos 3 días. Usa
            esto para traer más historia o para corregir un periodo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Periodo a recargar">
            {OPCIONES.map((d) => {
              const act = d === dias;
              return (
                <button
                  key={d}
                  onClick={() => setDias(d)}
                  aria-pressed={act}
                  disabled={enCola || enviando}
                  className="rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                  style={{
                    borderColor: act ? "var(--acento)" : "var(--borde)",
                    background: act ? "var(--acento-suave)" : "transparent",
                    color: act ? "var(--acento)" : "var(--ink-1)",
                  }}
                >
                  {d === 365 ? "1 año" : `${d} días`}
                </button>
              );
            })}
          </div>

          <button
            onClick={recargar}
            disabled={enCola || enviando}
            className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--acento)", color: "var(--surface-1)" }}
          >
            {enviando ? "Encolando…" : "Recargar"}
          </button>
        </div>
      </div>

      {enCola ? (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: "var(--ink-2)" }}>
              Procesando desde {estado.enCurso} · faltan{" "}
              <strong className="cifra">{estado.pendientes}</strong> de {estado.total}
            </span>
            <span className="cifra">{avance}%</span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full"
            style={{ background: "var(--borde)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${avance}%`, background: "var(--acento)" }}
            />
          </div>
        </div>
      ) : null}

      {aviso ? (
        <p className="mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
          {aviso}
        </p>
      ) : null}
    </section>
  );
}
