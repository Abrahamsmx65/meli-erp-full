"use client";

/**
 * Pestañas dentro de una pantalla (dueño, 9-oct-2026: «varias pestañas en
 * cada página para que sea más navegable, para no ver todo su contenido
 * junto de golpe»).
 *
 * El servidor arma TODOS los paneles (los datos ya vienen masticados) y aquí
 * solo se pinta el activo: cambiar de pestaña es instantáneo, sin viaje al
 * servidor. La pestaña viaja en la URL (`?pestana=…`, con replaceState) para
 * que un recargo o un enlace compartido abran la misma. Si la pantalla usa
 * más de un grupo de pestañas, cada grupo lleva su propio `parametro`.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

export interface Pestana {
  id: string;
  titulo: ReactNode;
  /** Número chico al lado del título (renglones, pendientes…). */
  cuenta?: number | string | null;
  /** Pinta la cuenta en ámbar: hay algo que atender. */
  alerta?: boolean;
  contenido: ReactNode;
}

function leerDeUrl(parametro: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(parametro);
}

export function Pestanas({
  pestanas,
  parametro = "pestana",
  inicial,
}: {
  /** Una pestaña en `false`/`null` no se enseña (`cond && {…}`). */
  pestanas: (Pestana | false | null | undefined)[];
  parametro?: string;
  /** La que se abre si la URL no dice otra. Por omisión, la primera. */
  inicial?: string;
}) {
  const visibles = pestanas.filter((p): p is Pestana => Boolean(p));
  const porOmision = inicial && visibles.some((p) => p.id === inicial) ? inicial : visibles[0]?.id;
  const [activa, setActiva] = useState<string | undefined>(porOmision);

  // La URL manda al montar (recargo o enlace compartido).
  useEffect(() => {
    const deUrl = leerDeUrl(parametro);
    if (deUrl && visibles.some((p) => p.id === deUrl)) setActiva(deUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parametro]);

  const elegir = useCallback(
    (id: string) => {
      setActiva(id);
      try {
        const url = new URL(window.location.href);
        if (id === porOmision) url.searchParams.delete(parametro);
        else url.searchParams.set(parametro, id);
        window.history.replaceState(window.history.state, "", url);
      } catch {
        /* sin URL no pasa nada: la pestaña ya cambió */
      }
    },
    [parametro, porOmision],
  );

  if (visibles.length === 0) return null;
  const actual = visibles.find((p) => p.id === activa) ?? visibles[0];

  function teclado(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = visibles.findIndex((p) => p.id === actual.id);
    const j = (i + (e.key === "ArrowRight" ? 1 : -1) + visibles.length) % visibles.length;
    elegir(visibles[j].id);
    const boton = e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[j];
    boton?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="pestanas" role="tablist" onKeyDown={teclado}>
        {visibles.map((p) => {
          const sel = p.id === actual.id;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`pestana-${parametro}-${p.id}`}
              aria-selected={sel}
              aria-controls={`panel-${parametro}-${p.id}`}
              tabIndex={sel ? 0 : -1}
              className="pestana"
              onClick={() => elegir(p.id)}
            >
              {p.titulo}
              {p.cuenta !== undefined && p.cuenta !== null && p.cuenta !== "" ? (
                <span className="pestana-cuenta" data-alerta={p.alerta ? "true" : undefined}>
                  {typeof p.cuenta === "number" ? p.cuenta.toLocaleString("es-MX") : p.cuenta}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`panel-${parametro}-${actual.id}`}
        aria-labelledby={`pestana-${parametro}-${actual.id}`}
        className="flex flex-col gap-6"
      >
        {actual.contenido}
      </div>
    </div>
  );
}
