"use client";

import { useState } from "react";
import { Seccion } from "@/components/ui/pagina";

/**
 * El link para publicar sin entrar al ERP: el dueño lo crea, lo copia, lo
 * cambia (el anterior deja de servir) o lo apaga.
 */
export function EnlacePublicar({ tokenInicial }: { tokenInicial: string | null }) {
  const [token, setToken] = useState(tokenInicial);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/publicar/${token}` : null;

  const pedir = async (accion: "crear" | "quitar") => {
    setOcupado(true);
    setAviso(null);
    try {
      const r = await fetch("/api/meli/publicar/acceso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo.");
      setToken(j.token ?? null);
      setAviso(accion === "quitar" ? "Link apagado: el anterior ya no abre." : "Link listo. El anterior, si había, ya no abre.");
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const copiar = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setAviso("Link copiado.");
    } catch {
      setAviso("No se pudo copiar: selecciónalo y cópialo a mano.");
    }
  };

  return (
    <Seccion titulo="Link para publicar sin entrar" descripcion="Quien tenga este link puede publicar productos nuevos (nacen pausados). No ve nada más del sistema.">
      {url ? (
        <div className="flex flex-col gap-2">
          <input className="num w-full rounded-lg border px-3 py-2 text-xs" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="boton boton-chico boton-primario" onClick={copiar}>
              Copiar link
            </button>
            <button type="button" className="boton boton-chico" disabled={ocupado} onClick={() => pedir("crear")}>
              Cambiar link
            </button>
            <button type="button" className="boton boton-chico boton-peligro" disabled={ocupado} onClick={() => pedir("quitar")}>
              Apagar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="boton boton-chico" disabled={ocupado} onClick={() => pedir("crear")}>
          {ocupado ? "Creando…" : "Crear link"}
        </button>
      )}
      {aviso ? <p className="texto-2 mt-2 text-xs">{aviso}</p> : null}
    </Seccion>
  );
}
