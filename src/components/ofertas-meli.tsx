"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmar } from "@/components/ui/confirmar";

export function ControlesOfertas({
  automatico,
  hayParaAceptar,
  api = "/api/ventas/ofertas",
  textoAutomatico = "Aceptar solas cada hora",
  fuente = "Números",
}: {
  automatico: boolean;
  hayParaAceptar: boolean;
  /** `/api/yapanizcel/ofertas` en fundas */
  api?: string;
  textoAutomatico?: string;
  fuente?: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function llamar(accion: string, valor?: boolean) {
    setOcupado(accion);
    setError(null);
    try {
      const r = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, valor }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-sm">
        <input type="checkbox" checked={automatico} disabled={ocupado != null} onChange={(e) => llamar("automatico", e.target.checked)} />
        {textoAutomatico}
      </label>
      <button className="boton-secundario" disabled={ocupado != null} onClick={() => llamar("revisar")}>
        {ocupado === "revisar" ? "Revisando…" : "Revisar ahora"}
      </button>
      <button
        className="boton-primario"
        disabled={ocupado != null || !hayParaAceptar}
        onClick={async () => {
          if (await confirmar({ titulo: `¿Aceptar en MELI todas las ofertas que cumplen el PV normal de ${fuente}?`, confirmar: "Aceptar ofertas" })) llamar("aceptar");
        }}
      >
        {ocupado === "aceptar" ? "Aceptando…" : "Aceptar las que cumplen"}
      </button>
      {error ? <span className="text-xs" style={{ color: "var(--estado-critico)" }}>{error}</span> : null}
    </div>
  );
}
