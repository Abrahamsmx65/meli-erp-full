"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * La pantalla se sirvió con un renglón viejo mientras el fondo lo recalcula
 * (`marca-refresco.ts`): se vuelve a pedir sola cuando ya debería estar,
 * sin que el dueño tenga que recargar. Tres intentos crecientes por visita;
 * si el fondo terminó antes, el primer intento ya trae lo nuevo y el
 * servidor deja de mandar este componente.
 *
 * Mientras tanto se enseña «Actualizando datos…» abajo a la derecha (dueño,
 * 11-oct-2026: «tengo que recargar varias veces en cada pestaña para que
 * salga correcto»): sin el aviso, la pantalla vieja parecía la definitiva.
 */
const ESPERAS_MS = [5_000, 15_000, 40_000];

export function RefrescoAlTerminar() {
  const router = useRouter();
  const ruta = usePathname();
  const intento = useRef<{ ruta: string; n: number }>({ ruta, n: 0 });
  const [rendido, setRendido] = useState(false);

  useEffect(() => {
    if (intento.current.ruta !== ruta) {
      intento.current = { ruta, n: 0 };
      setRendido(false);
    }
    const n = intento.current.n;
    if (n >= ESPERAS_MS.length) {
      setRendido(true);
      return;
    }
    const t = setTimeout(() => {
      if (document.visibilityState === "hidden") return;
      intento.current.n = n + 1;
      router.refresh();
    }, ESPERAS_MS[n]);
    return () => clearTimeout(t);
  });

  if (rendido) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium shadow-lg"
      style={{ background: "var(--marca)", color: "#fff" }}
    >
      <span aria-hidden="true" className="inline-block size-2 animate-pulse rounded-full" style={{ background: "#d9b98f" }} />
      Actualizando datos…
    </div>
  );
}
