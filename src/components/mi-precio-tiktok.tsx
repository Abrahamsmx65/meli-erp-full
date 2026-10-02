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

/**
 * Por modelo: calcular el objetivo como si MELI sí retuviera el 10.5 %
 * (IVA 8 % + ISR 2.5 % sobre la base sin IVA). En reventa MELI ya no lo
 * retiene y muchos precios de MELI se pusieron contando con eso (dueño,
 * 2-oct-2026): con la casilla el precio de TikTok sale más bajo.
 */
export function QuitarRetencionTikTok({ modelo, inicial, pct }: { modelo: string; inicial: boolean; pct: number }) {
  const router = useRouter();
  const [valor, setValor] = useState(inicial);
  const [estado, setEstado] = useState<"quieto" | "guardando" | "error">("quieto");

  async function cambiar(si: boolean) {
    setValor(si);
    setEstado("guardando");
    const r = await fetch("/api/tiktok/precios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelo, quitarRetencion: si }),
    }).catch(() => null);
    if (!r || !r.ok) {
      setValor(!si);
      setEstado("error");
      return;
    }
    setEstado("quieto");
    router.refresh();
  }

  return (
    <label
      className="inline-flex items-center gap-1.5 text-xs"
      style={{ color: estado === "error" ? "var(--estado-critico)" : "var(--ink-2)", opacity: estado === "guardando" ? 0.6 : 1 }}
      title={`Calcular este modelo como si MELI sí retuviera el ${pct} % (IVA + ISR sobre la base sin IVA): el objetivo baja y el precio de TikTok también`}
    >
      <input type="checkbox" checked={valor} disabled={estado === "guardando"} onChange={(e) => cambiar(e.target.checked)} />
      quitar {pct} %
    </label>
  );
}
