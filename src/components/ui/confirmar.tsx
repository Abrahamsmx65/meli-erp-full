"use client";

/**
 * `confirmar()` en lugar de `confirm()` del navegador, con promesa:
 *
 *   if (!(await confirmar({ titulo: "¿Borrar este gasto?", confirmar: "Borrar", peligro: true }))) return;
 *
 * Detrás hay UN solo `DialogoConfirmar` montado. Si la pantalla montó
 * `<AnfitrionConfirmar />` se usa ese; si no, el primer `confirmar()` lo
 * monta solo en un nodo propio al final de <body> (así funciona en cualquier
 * pantalla sin tocar el armazón). Las peticiones que llegan mientras hay una
 * abierta esperan en fila: cada una contesta lo suyo.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DialogoConfirmar } from "./dialogo-confirmar";

export interface OpcionesConfirmar {
  titulo: string;
  /** la consecuencia: qué cambia si se confirma */
  mensaje?: ReactNode;
  /** texto del botón que confirma (por omisión «Confirmar») */
  confirmar?: string;
  /** acciones destructivas (borrar, cancelar, rearmar): botón rojo */
  peligro?: boolean;
}

interface Peticion extends OpcionesConfirmar {
  id: number;
  resolver: (si: boolean) => void;
}

let fila: Peticion[] = [];
let folio = 0;
let avisar: (() => void) | null = null;
let autoMontado = false;

function textoPlano(o: OpcionesConfirmar): string {
  return [o.titulo, typeof o.mensaje === "string" ? o.mensaje : ""].filter(Boolean).join("\n\n");
}

function montarSolo() {
  if (autoMontado || typeof document === "undefined") return;
  autoMontado = true;
  const nodo = document.createElement("div");
  nodo.setAttribute("data-confirmar", "");
  document.body.appendChild(nodo);
  void import("react-dom/client").then(({ createRoot }) => {
    createRoot(nodo).render(<AnfitrionConfirmar />);
  });
}

/** Pregunta con el diálogo del sistema; `true` si se confirmó. */
export function confirmar(opciones: OpcionesConfirmar): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise<boolean>((resolver) => {
    fila.push({ ...opciones, id: ++folio, resolver });
    if (avisar) avisar();
    else {
      try {
        montarSolo();
      } catch {
        // Sin forma de montar el diálogo: que no se bloquee la operación.
        fila = fila.filter((p) => p.resolver !== resolver);
        resolver(window.confirm(textoPlano(opciones)));
      }
    }
  });
}

/** El diálogo que contesta a `confirmar()`. Uno por página (el último montado manda). */
export function AnfitrionConfirmar() {
  const [actual, setActual] = useState<Peticion | null>(null);
  // Lo último que se enseñó: al cerrar, el texto se queda mientras el diálogo
  // se va (y la misma llave deja que se cierre en vez de desmontarse).
  const [mostrado, setMostrado] = useState<Peticion | null>(null);
  if (actual && actual !== mostrado) setMostrado(actual);
  // La petición abierta, fuera del estado: contestar no puede ser un efecto
  // dentro de un `setState` (React lo puede llamar dos veces).
  const abierta = useRef<Peticion | null>(null);

  useEffect(() => {
    const siguiente = () => {
      if (abierta.current) return;
      abierta.current = fila[0] ?? null;
      setActual(abierta.current);
    };
    avisar = siguiente;
    siguiente();
    return () => {
      if (avisar === siguiente) avisar = null;
    };
  }, []);

  function contestar(si: boolean) {
    const a = abierta.current;
    // El <dialog> también avisa al cerrarse después de contestar: ya no hay nada abierto.
    if (!a) return;
    fila = fila.filter((p) => p !== a);
    abierta.current = fila[0] ?? null;
    setActual(abierta.current);
    a.resolver(si);
  }

  return (
    <DialogoConfirmar
      // Cada petición monta su propio <dialog>: si Escape cerró el anterior y
      // ya hay otra en fila, la nueva se vuelve a abrir.
      key={(actual ?? mostrado)?.id ?? 0}
      abierto={actual != null}
      titulo={(actual ?? mostrado)?.titulo ?? ""}
      confirmarTexto={(actual ?? mostrado)?.confirmar ?? "Confirmar"}
      tono={(actual ?? mostrado)?.peligro ? "peligro" : "primario"}
      onConfirmar={() => contestar(true)}
      onCerrar={() => contestar(false)}
    >
      {(actual ?? mostrado)?.mensaje ?? null}
    </DialogoConfirmar>
  );
}
