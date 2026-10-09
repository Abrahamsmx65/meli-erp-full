"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * La pantalla se sirvió con un renglón viejo mientras el fondo lo recalcula
 * (`marca-refresco.ts`): se vuelve a pedir sola cuando ya debería estar,
 * sin que el dueño tenga que recargar. Tres intentos crecientes por visita;
 * si el fondo terminó antes, el primer intento ya trae lo nuevo y el
 * servidor deja de mandar este componente.
 */
const ESPERAS_MS = [5_000, 15_000, 40_000];

export function RefrescoAlTerminar() {
  const router = useRouter();
  const ruta = usePathname();
  const intento = useRef<{ ruta: string; n: number }>({ ruta, n: 0 });

  useEffect(() => {
    if (intento.current.ruta !== ruta) intento.current = { ruta, n: 0 };
    const n = intento.current.n;
    if (n >= ESPERAS_MS.length) return;
    const t = setTimeout(() => {
      if (document.visibilityState === "hidden") return;
      intento.current.n = n + 1;
      router.refresh();
    }, ESPERAS_MS[n]);
    return () => clearTimeout(t);
  });

  return null;
}
