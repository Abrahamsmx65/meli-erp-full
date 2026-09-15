"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface AliasAmazonFila {
  modelo: string;
  colorTikTok: string;
  colorAmazon: string;
}

/**
 * Colores que TikTok y Amazon llaman distinto para el mismo par (MY2304
 * CAMEL = MY2304 BROWN). Con esto el corte encuentra el FNSKU y la hoja y
 * la guía llevan el código de la caja. Se captura por modelo.
 */
export function AliasAmazonTikTok({ alias }: { alias: AliasAmazonFila[] }) {
  const router = useRouter();
  const [modelo, setModelo] = useState("");
  const [colorTikTok, setColorTikTok] = useState("");
  const [colorAmazon, setColorAmazon] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function llamar(metodo: "POST" | "DELETE", cuerpo: unknown) {
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/alias-amazon", {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo.");
      setModelo("");
      setColorTikTok("");
      setColorAmazon("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta p-4">
      <h2 className="text-sm font-semibold">Colores equivalentes en Amazon (para el FNSKU)</h2>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
        Cuando TikTok llama al color distinto que Amazon, aquí se dice cuál es cuál por modelo. Así el corte
        encuentra el FNSKU y la hoja y la guía llevan el código de barras de la caja.
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ocupado) void llamar("POST", { modelo, colorTikTok, colorAmazon });
        }}
      >
        <label className="text-xs" style={{ color: "var(--ink-2)" }}>
          Modelo
          <input value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="MY2304" className="mt-1 block w-28 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--grid)" }} />
        </label>
        <label className="text-xs" style={{ color: "var(--ink-2)" }}>
          Color en TikTok
          <input value={colorTikTok} onChange={(e) => setColorTikTok(e.target.value)} placeholder="CAMEL" className="mt-1 block w-32 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--grid)" }} />
        </label>
        <label className="text-xs" style={{ color: "var(--ink-2)" }}>
          Color en Amazon
          <input value={colorAmazon} onChange={(e) => setColorAmazon(e.target.value)} placeholder="BROWN" className="mt-1 block w-32 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--grid)" }} />
        </label>
        <button type="submit" disabled={ocupado} className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--acento)" }}>
          Guardar
        </button>
      </form>
      {error ? <p className="mt-2 text-xs" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
      {alias.length ? (
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {alias.map((a) => (
            <li key={`${a.modelo}|${a.colorTikTok}`} className="flex items-center gap-2 rounded-lg border px-2 py-1" style={{ borderColor: "var(--grid)" }}>
              <span className="font-medium">{a.modelo}</span>
              <span>{a.colorTikTok} → {a.colorAmazon}</span>
              <button
                type="button"
                onClick={() => void llamar("DELETE", { modelo: a.modelo, colorTikTok: a.colorTikTok })}
                disabled={ocupado}
                className="text-xs underline"
                style={{ color: "var(--ink-2)" }}
              >
                quitar
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
