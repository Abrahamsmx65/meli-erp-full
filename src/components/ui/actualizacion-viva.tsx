"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Una pantalla de ventas abierta se vuelve a pedir sola cada `cadaMs` mientras
 * la pestaña se ve, y en el acto al volver a ella si ya pasó ese rato (dueño,
 * 11-oct-2026: «no sé si se actualiza al momento sin actualizarlo yo»). Las
 * ventas por día ya están sumadas en la base (0138), así que el servidor
 * contesta con lo guardado y refresca su renglón por atrás si está viejo.
 */
export function ActualizacionViva({ cadaMs }: { cadaMs: number }) {
  const router = useRouter();
  const ultima = useRef(Date.now());

  useEffect(() => {
    const refrescar = () => {
      ultima.current = Date.now();
      router.refresh();
    };
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refrescar();
    }, cadaMs);
    const alVolver = () => {
      if (document.visibilityState === "visible" && Date.now() - ultima.current >= cadaMs) refrescar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [router, cadaMs]);

  return null;
}
