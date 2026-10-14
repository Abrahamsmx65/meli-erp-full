"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

/**
 * Los atajos de fechas (Hoy, Ayer, 7, 15, 30 días, Este mes).
 *
 * Con `precargar`, la pantalla de cada atajo se pide COMPLETA por adelantado
 * y se renueva cada `RENOVAR_MS` mientras la pestaña se ve (dueño,
 * 11-oct-2026: «no se trabajaba cuando cambiabas entre hoy, ayer, 7 días…
 * todo funcionaba como si no hay ningún pensamiento»): el clic cambia de
 * inmediato, sin la pantalla gris de carga, con datos de hace menos de
 * medio minuto. `staleTimes.static` (next.config.mjs) es lo que una
 * precarga completa se puede reutilizar: 30 s, igual que la renovación.
 * Solo en pantallas que leen renglones baratos (las de ventas): cada
 * renovación es una visita al servidor por atajo.
 */
const RENOVAR_MS = 30_000;

export function AtajosFechas({
  atajos,
  activo,
  precargar = false,
}: {
  atajos: { texto: string; href: string }[];
  /** href del atajo que se está viendo (se pinta marcado) */
  activo: string | null;
  precargar?: boolean;
}) {
  const router = useRouter();
  const claves = atajos.map((a) => a.href).join("|");

  useEffect(() => {
    if (!precargar) return;
    const pedir = () => {
      if (document.visibilityState !== "visible") return;
      // Todos, también el que se ve: al volver a él desde otro atajo, ya está.
      for (const href of new Set(atajos.map((a) => a.href))) {
        router.prefetch(href, { kind: PrefetchKind.FULL });
      }
    };
    pedir();
    const t = setInterval(pedir, RENOVAR_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") pedir();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
    // `claves` resume `atajos`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, claves, precargar]);

  return (
    <>
      {atajos.map((a) => {
        const esActivo = a.href === activo;
        return (
          <Link
            key={a.texto}
            href={a.href}
            prefetch={precargar ? false : undefined}
            className="rounded-full border px-3 py-1 text-xs font-medium"
            style={
              esActivo
                ? { background: "var(--acento)", color: "#fff", borderColor: "var(--acento)" }
                : { borderColor: "var(--borde)" }
            }
          >
            {a.texto}
          </Link>
        );
      })}
    </>
  );
}
