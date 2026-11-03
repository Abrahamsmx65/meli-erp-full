"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Conexión de la cuenta de Higgsfield en DOS pasos, porque desde el
 * 2-nov-2026 Higgsfield solo confía en redirects de localhost: (1) el botón
 * abre su login en otra pestaña; al aprobar, el navegador termina en una
 * página de localhost QUE NO CARGA — es lo esperado —; (2) el dueño copia
 * esa dirección completa y la pega aquí; el servidor canjea el código
 * (`/api/higgsfield/canjear`).
 */
export function ConectarHiggsfield({ conectada }: { conectada: boolean }) {
  const router = useRouter();
  const [pegado, setPegado] = useState("");
  const [estado, setEstado] = useState<"listo" | "canjeando" | "ok">("listo");
  const [error, setError] = useState<string | null>(null);
  const [arrancado, setArrancado] = useState(false);

  async function canjear() {
    if (!pegado.trim()) {
      setError("Pega primero la dirección de la página que no cargó.");
      return;
    }
    setEstado("canjeando");
    setError(null);
    try {
      const r = await fetch("/api/higgsfield/canjear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: pegado.trim() }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "No se pudo terminar la conexión.");
      setEstado("ok");
      setPegado("");
      router.refresh();
    } catch (e) {
      setEstado("listo");
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <a
        href="/api/higgsfield/conectar"
        target="_blank"
        rel="noopener"
        onClick={() => {
          setArrancado(true);
          setError(null);
          setEstado("listo");
        }}
        className={conectada ? "boton boton-borde boton-chico" : "boton boton-primario"}
      >
        {conectada ? "Reconectar Higgsfield" : "Conectar Higgsfield"}
      </a>
      {(arrancado || !conectada) && (
        <>
          <p className="texto-tenue max-w-xl text-xs">
            Se abre el login de Higgsfield en otra pestaña. Al aprobar vas a
            caer en una página que NO carga (localhost) — así debe ser —:
            copia la dirección completa de esa página y pégala aquí para
            terminar la conexión.
          </p>
          <div className="flex w-full max-w-xl flex-wrap items-center gap-2">
            <input
              value={pegado}
              onChange={(e) => setPegado(e.target.value)}
              placeholder="http://localhost:3000/api/higgsfield/callback?code=…"
              className="min-w-64 flex-1 px-2 py-1.5 text-sm"
            />
            <button
              onClick={() => void canjear()}
              disabled={estado === "canjeando"}
              className="boton boton-primario boton-chico disabled:opacity-50"
            >
              {estado === "canjeando" ? "Conectando…" : "Terminar conexión"}
            </button>
          </div>
          {estado === "ok" && (
            <p className="text-sm" style={{ color: "var(--exito-texto)" }}>
              ✓ Cuenta de Higgsfield conectada.
            </p>
          )}
          {error && (
            <p className="text-sm" style={{ color: "var(--critico-texto)" }}>
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
