"use client";

import { Aviso } from "@/components/ui/pagina";
import { useState } from "react";
import { useRouter } from "next/navigation";

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Botones del corte general: congelarlo (y abrir su informe en PDF, pedido
 * del dueño el 9-oct-2026: «que al hacer corte genere el PDF»), la vista
 * previa del informe sin guardar y el Excel. El PDF y el Excel de un corte
 * guardado están también en su renglón.
 */
export function AccionesCorteGeneral({ periodo, corteId }: { periodo: string; corteId: number | null }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; pdf: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function hacerCorte() {
    setOcupado(true);
    setAviso(null);
    setError(null);
    // La pestaña se abre EN el clic: abrirla al terminar la bloquea el navegador.
    const pestana = window.open("", "_blank");
    pestana?.document.write("<p style='font-family:sans-serif;padding:2rem'>Haciendo el corte y armando el informe…</p>");
    try {
      const r = await fetch("/api/cortes/general", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo hacer el corte.");
      const pdf = `/api/cortes/general/${j.id}/pdf`;
      if (pestana) pestana.location.href = pdf;
      setAviso({ texto: `Corte guardado: utilidad neta ${pesos(j.utilidadNeta)}${j.exacto ? " (exacto)" : ""}.`, pdf });
      router.refresh();
    } catch (e) {
      pestana?.close();
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const pdfDelMes = corteId ? `/api/cortes/general/${corteId}/pdf` : `/api/cortes/general/pdf?periodo=${periodo}`;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <a className="boton boton-borde boton-chico" href={pdfDelMes} target="_blank" rel="noreferrer">
          {corteId ? "Ver PDF" : "Vista previa PDF"}
        </a>
        <a className="boton boton-borde boton-chico" href={`${pdfDelMes}${pdfDelMes.includes("?") ? "&" : "?"}descargar=1`} download>
          Descargar PDF
        </a>
        <a className="boton boton-borde boton-chico" href={`/api/cortes/general/excel?periodo=${periodo}`}>
          Excel
        </a>
        <button type="button" className="boton boton-primario" disabled={ocupado} onClick={hacerCorte}>
          {ocupado ? "Cortando…" : corteId ? "Rehacer corte" : "Hacer corte"}
        </button>
      </div>
      {aviso ? (
        <Aviso tono="bien">
          {aviso.texto}{" "}
          <a href={aviso.pdf} target="_blank" rel="noreferrer" className="enlace">
            Ver el PDF
          </a>
          {" · "}
          <a href={`${aviso.pdf}?descargar=1`} download className="enlace">
            Descargar
          </a>
        </Aviso>
      ) : null}
      {error ? <Aviso tono="critico">{error}</Aviso> : null}
    </div>
  );
}
