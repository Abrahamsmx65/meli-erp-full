"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * El precio que el dueño quiere poner (relámpago normal) para un modelo:
 * se guarda al salir del campo y la tabla se recalcula. Vacío = borrar y
 * volver al calculado desde el relámpago de MELI.
 */
export function MiPrecioTikTok({ modelo, inicial }: { modelo: string; inicial: number | null }) {
  const router = useRouter();
  const [valor, setValor] = useState(inicial != null ? String(inicial) : "");
  const [estado, setEstado] = useState<"quieto" | "guardando" | "error">("quieto");

  async function guardar() {
    const limpio = valor.trim();
    const precio = limpio === "" ? null : Number(limpio);
    if (precio === inicial || (precio == null && inicial == null)) return;
    if (precio != null && (!Number.isFinite(precio) || precio <= 0)) {
      setEstado("error");
      return;
    }
    setEstado("guardando");
    const r = await fetch("/api/tiktok/precios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelo, precio }),
    }).catch(() => null);
    if (!r || !r.ok) {
      setEstado("error");
      return;
    }
    setEstado("quieto");
    router.refresh();
  }

  return (
    <input
      type="number"
      step="1"
      min="1"
      inputMode="decimal"
      value={valor}
      placeholder="—"
      onChange={(e) => setValor(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      title="El precio que TÚ quieres poner como relámpago normal; vacío = el calculado desde el relámpago de MELI"
      className="num w-24 rounded-lg border px-2 py-1 text-right text-sm"
      style={{ borderColor: estado === "error" ? "var(--estado-critico)" : undefined, opacity: estado === "guardando" ? 0.6 : 1 }}
      disabled={estado === "guardando"}
    />
  );
}
