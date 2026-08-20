"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Carga masiva de categorías y costos desde un Excel con columnas
 * CATEGORIA | MODELO | COSTO. Sube el archivo y listo: los modelos que ya
 * existían se actualizan, los nuevos se agregan.
 */
export function SubirCostos() {
  const [subiendo, setSubiendo] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const subir = async (archivo: File) => {
    setSubiendo(true);
    setMensaje(null);
    setError(null);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      const r = await fetch("/api/productos/importar", { method: "POST", body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo cargar.");
      setMensaje(`Listo: ${j.cargados} modelos cargados.`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label
        className="cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium"
        style={{ borderColor: "var(--borde)", opacity: subiendo ? 0.6 : 1 }}
      >
        {subiendo ? "Cargando…" : "Cargar costos desde Excel"}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          disabled={subiendo}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) subir(f);
          }}
        />
      </label>
      <span className="text-xs" style={{ color: "var(--ink-2)" }}>
        Columnas: CATEGORIA · MODELO · COSTO (en MXN, por modelo)
      </span>
      {mensaje ? (
        <span className="text-sm" style={{ color: "var(--exito-texto)" }}>
          {mensaje}
        </span>
      ) : null}
      {error ? (
        <span className="text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
