"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * «Leer sheets»: vuelve a leer en el momento «Cuentas YAPANIZCEL» y
 * «Números» (también se leen solos cada hora). Lo que dice el sheet manda.
 */
export function LeerSheets({ leidoEn }: { leidoEn: string | null }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState("");

  async function leer() {
    setOcupado(true);
    setMensaje("");
    try {
      const r = await fetch("/api/finanzas/sheets", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudieron leer los sheets.");
      setMensaje(j.errores?.length ? j.errores.join(" · ") : "Listo: ya está lo que dicen los sheets.");
      router.refresh();
    } catch (e) {
      setMensaje((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const hace = leidoEn ? Math.max(0, Math.round((Date.now() - new Date(leidoEn).getTime()) / 60_000)) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="boton boton-chico boton-fantasma" onClick={leer} disabled={ocupado}>
        {ocupado ? "Leyendo sheets…" : "Leer sheets"}
      </button>
      <span className="text-xs texto-tenue">
        {mensaje || (hace == null ? "Sheets sin leer todavía" : hace < 1 ? "Sheets leídos hace un momento" : `Sheets leídos hace ${hace < 120 ? `${hace} min` : `${Math.round(hace / 60)} h`}`)}
      </span>
    </div>
  );
}
