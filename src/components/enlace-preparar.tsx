"use client";

import { useState } from "react";
import { Copy, RefreshCw } from "lucide-react";

/** El link sin contraseña para los empleados, con el botón para renovarlo si se filtra. */
export function EnlacePreparar({ tokenInicial, origen }: { tokenInicial: string | null; origen: string }) {
  const [token, setToken] = useState(tokenInicial);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const url = token ? `${origen}/preparar/${token}` : null;

  async function rotar() {
    if (!confirm("El link anterior dejará de funcionar. ¿Generar uno nuevo?")) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/tiktok/acceso", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo.");
      setToken(j.token);
      setAviso("Link nuevo generado. El anterior ya no sirve.");
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function copiar() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setAviso("Copiado.");
    } catch {
      setAviso("No se pudo copiar; selecciónalo a mano.");
    }
  }

  return (
    <section className="tarjeta p-4">
      <h2 className="text-sm font-semibold">Link para los empleados</h2>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
        Abre la estación de preparar sin contraseña. Solo alcanza los cortes y la preparación:
        nada de ventas, inventario ni cortes nuevos. Si se filtra, genera otro y el anterior muere.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border px-2.5 py-1.5 text-xs" style={{ borderColor: "var(--grid)" }}>
          {url ?? "Sin link todavía"}
        </code>
        <button onClick={copiar} disabled={!url} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--grid)" }}>
          <Copy size={14} /> Copiar
        </button>
        <button onClick={rotar} disabled={ocupado} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: "var(--grid)" }}>
          <RefreshCw size={14} /> Generar nuevo
        </button>
      </div>
      {aviso ? <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>{aviso}</p> : null}
    </section>
  );
}
