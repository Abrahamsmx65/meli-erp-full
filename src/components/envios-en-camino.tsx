"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface EnvioEnCamino {
  id: string;
  bodegas: string[];
  cajas: number;
  pares: number;
  enviadoEn: string;
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function hace(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias < 1) return "hoy";
  if (dias === 1) return "hace 1 día";
  return `hace ${dias} días`;
}

/**
 * Envíos ya dados de alta en MELI que siguen en camino.
 *
 * Mientras estén aquí, sus cajas no cuentan como disponibles y sus pares
 * cuentan como en camino. Cuando MELI avise que llegó, un clic lo cierra;
 * si nadie lo cierra, se cierra solo a los 21 días.
 */
export function EnviosEnCamino({ envios }: { envios: EnvioEnCamino[] }) {
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const router = useRouter();

  if (!envios.length) return null;

  const recibido = async (id: string) => {
    if (trabajando) return;
    if (!confirm("¿MELI ya recibió este envío en Full?")) return;
    setTrabajando(id);
    try {
      const r = await fetch("/api/envios", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudo marcar.");
      router.refresh();
    } catch {
      setTrabajando(null);
    }
  };

  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b p-4 hairline">
        <h2 className="text-base font-semibold">En camino a Full</h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Envíos ya dados de alta en Mercado Libre. Sus cajas ya no cuentan como
          disponibles y sus pares ya cuentan a favor del plan. Cuando MELI reciba
          uno, márcalo — o se cierra solo a los 21 días.
        </p>
      </header>
      <ul>
        {envios.map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap items-center gap-4 border-b p-4 last:border-b-0 hairline"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {e.bodegas.length ? e.bodegas.join(" y ") : "Envío"} ·{" "}
                <span className="cifra">{n(e.cajas)}</span> cajas ·{" "}
                <span className="cifra">{n(e.pares)}</span> pares
              </div>
              <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                Dado de alta {hace(e.enviadoEn)}
              </div>
            </div>
            <button
              onClick={() => recibido(e.id)}
              disabled={trabajando === e.id}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium"
              style={{
                borderColor: "var(--borde)",
                opacity: trabajando === e.id ? 0.6 : 1,
              }}
            >
              {trabajando === e.id ? "Cerrando…" : "Ya llegó a Full"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
