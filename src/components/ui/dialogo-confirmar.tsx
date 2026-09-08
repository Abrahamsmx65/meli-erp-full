"use client";

/**
 * Confirmación del sistema, en lugar de confirm() del navegador.
 *
 * Sobre <dialog> nativo: Escape cierra, el foco queda atrapado dentro y el
 * fondo no se puede operar — lo que los 6 modales artesanales prometían con
 * aria-modal sin cumplirlo. La consecuencia de la acción se dice con datos
 * («deja de contar 288 pares»), no con un «¿Estás seguro?».
 */
import { useEffect, useRef } from "react";
import { Boton } from "./boton";

export function DialogoConfirmar({
  abierto,
  titulo,
  children,
  confirmarTexto = "Confirmar",
  tono = "primario",
  ocupado,
  onConfirmar,
  onCerrar,
}: {
  abierto: boolean;
  titulo: string;
  /** la consecuencia, con números: qué cambia si confirmas */
  children: React.ReactNode;
  confirmarTexto?: string;
  /** "peligro" para destructivas */
  tono?: "primario" | "peligro";
  ocupado?: boolean;
  onConfirmar: () => void;
  onCerrar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      onClose={onCerrar}
      onCancel={(e) => {
        // Escape mientras trabaja: no se cierra a medias.
        if (ocupado) e.preventDefault();
      }}
      aria-label={titulo}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border p-0 backdrop:bg-black/45"
      style={{ borderColor: "var(--borde)", background: "var(--surface-1)", color: "var(--ink-1)" }}
    >
      <div className="p-5">
        <h2 className="text-base font-semibold">{titulo}</h2>
        <div className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          {children}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Boton variante="fantasma" onClick={onCerrar} disabled={ocupado}>
            Cancelar
          </Boton>
          <Boton
            variante={tono === "peligro" ? "peligro-lleno" : "primario"}
            onClick={onConfirmar}
            cargando={ocupado}
            textoCargando="Un momento…"
          >
            {confirmarTexto}
          </Boton>
        </div>
      </div>
    </dialog>
  );
}
