"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Ligar a mano un SKU del almacén con su publicación de TikTok, con las
 * sugerencias del mismo modelo y talla enfrente. Un clic en la sugerencia
 * escribe el amarre manual: las ventas de esa publicación descuentan de
 * este renglón y su disponible se publica.
 */
export function LigarTikTok({ sku, sugerencias }: { sku: string; sugerencias: string[] }) {
  const router = useRouter();
  const [otra, setOtra] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ligar(sellerSku: string) {
    if (!sellerSku.trim() || ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch("/api/tiktok/mapeo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuTikTok: sellerSku.trim(), skuInterno: sku }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo ligar.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      {sugerencias.map((sug) => (
        <button
          key={sug}
          type="button"
          disabled={ocupado}
          onClick={() => void ligar(sug)}
          title={`Ligar con la publicación ${sug}`}
          className="rounded border px-1.5 py-0.5 text-xs disabled:opacity-50"
          style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
        >
          ¿{sug}?
        </button>
      ))}
      <input
        value={otra}
        onChange={(e) => setOtra(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void ligar(otra);
          }
        }}
        placeholder="otro SKU de TikTok…"
        className="w-44 rounded border px-1.5 py-0.5 text-xs"
        style={{ borderColor: "var(--grid)" }}
      />
      {error ? <span className="text-xs" style={{ color: "var(--estado-critico)" }}>{error}</span> : null}
    </span>
  );
}
