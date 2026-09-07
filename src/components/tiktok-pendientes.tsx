"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PendienteTikTok } from "@/lib/servicios/tiktok-panel";

/**
 * Los SKUs que TikTok publica y el ERP no reconoce.
 *
 * Importa más de lo que parece: mientras un SKU esté aquí, sus ventas NO
 * descuentan del kardex y su disponible NO se publica — se queda vendiendo a
 * ciegas. Por eso va arriba de la tabla y no escondido en Pendientes.
 */
export function PendientesTikTok({ pendientes }: { pendientes: PendienteTikTok[] }) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!pendientes.length) return null;

  async function amarrar(p: PendienteTikTok) {
    const skuInterno = (valores[p.skuId] ?? "").trim();
    if (!skuInterno) return;

    setOcupado(p.skuId);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/mapeo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuTikTok: p.sellerSku ?? p.skuId, skuInterno }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo amarrar.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section
      className="rounded-lg p-4"
      style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
    >
      <h2 className="text-sm font-semibold">
        {pendientes.length} SKU de TikTok sin amarrar al catálogo
      </h2>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
        Sus ventas no descuentan del almacén y su disponible no se publica. Amárralos y la
        siguiente sincronización se pone al corriente sola.
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {pendientes.slice(0, 25).map((p) => (
          <li key={p.skuId} className="flex flex-wrap items-center gap-2">
            <span className="min-w-[12rem] flex-1 text-sm">
              <span className="font-medium">{p.sellerSku ?? `(sin seller_sku) ${p.skuId}`}</span>
              {p.titulo ? (
                <span className="block text-xs" style={{ color: "var(--ink-2)" }}>
                  {p.titulo}
                  {p.talla ? ` · ${p.talla}` : ""}
                </span>
              ) : null}
            </span>
            <span className="flex flex-wrap gap-1">
              {(p.sugerencias ?? []).map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setValores((v) => ({ ...v, [p.skuId]: sug }))}
                  title="Llena el campo con esta sugerencia; Amarrar la confirma"
                  className="rounded border px-1.5 py-0.5 text-xs"
                  style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
                >
                  ¿{sug}?
                </button>
              ))}
            </span>
            <input
              value={valores[p.skuId] ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [p.skuId]: e.target.value }))}
              placeholder="SKU del ERP"
              className="w-56 rounded-lg border px-2.5 py-1.5 text-sm"
              style={{ borderColor: "var(--grid)", background: "var(--fondo, transparent)" }}
            />
            <button
              onClick={() => amarrar(p)}
              disabled={ocupado === p.skuId}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: "var(--acento)" }}
            >
              {ocupado === p.skuId ? "Amarrando…" : "Amarrar"}
            </button>
          </li>
        ))}
      </ul>

      {pendientes.length > 25 ? (
        <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>
          Y {pendientes.length - 25} más.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
