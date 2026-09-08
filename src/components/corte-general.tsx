"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Botones del corte general: congelarlo y bajar el Excel. */
export function AccionesCorteGeneral({ periodo, corteId }: { periodo: string; corteId: number | null }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function hacerCorte() {
    setOcupado(true);
    setAviso(null);
    setError(null);
    try {
      const r = await fetch("/api/cortes/general", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo hacer el corte.");
      setAviso(`Corte general guardado: utilidad neta ${pesos(j.utilidadNeta)}${j.exacto ? " (exacto)" : ` (${j.avisos} avisos)`}.`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="boton boton-primario" disabled={ocupado} onClick={hacerCorte}>
          {ocupado ? "Cortando…" : corteId ? `Rehacer corte general de ${periodo}` : `Hacer corte general de ${periodo}`}
        </button>
        <a className="boton boton-fantasma" href={`/api/cortes/general/excel?periodo=${periodo}`}>
          Excel con todo
        </a>
        {corteId ? (
          <a className="boton boton-fantasma" href={`/api/cortes/general/${corteId}/excel`}>
            Excel del corte guardado
          </a>
        ) : null}
      </div>
      {aviso ? <p className="text-sm" style={{ color: "var(--exito-texto)" }}>{aviso}</p> : null}
      {error ? <p className="text-sm" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
    </div>
  );
}
