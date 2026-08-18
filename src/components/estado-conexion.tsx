"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Estado {
  conectado: boolean;
  ultimaSync: string | null;
  planGeneradoEn: string | null;
  planVigente: boolean;
  avisosPendientes: number;
  enVivo: boolean;
}

/**
 * Barra de estado de la conexión con Mercado Libre.
 *
 * Ahora que la sincronización es por webhooks, el usuario ya no pica botones:
 * los datos cambian solos. Pero "solo" no puede significar "a ciegas" — si el
 * sistema se actualiza sin avisar, uno nunca sabe si lo que está viendo es de
 * hace un minuto o de hace tres días. Esta barra es ese aviso.
 */
export function EstadoConexion() {
  const [e, setE] = useState<Estado | null>(null);
  const router = useRouter();

  useEffect(() => {
    let vivo = true;

    async function consultar() {
      try {
        const r = await fetch("/api/estado", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as Estado;
        if (!vivo) return;
        setE((previo) => {
          // Si llegó una sincronización nueva, refrescar lo que se ve.
          if (previo && j.ultimaSync && previo.ultimaSync !== j.ultimaSync) {
            router.refresh();
          }
          return j;
        });
      } catch {
        /* sin conexión: se reintenta en el siguiente ciclo */
      }
    }

    consultar();
    const t = setInterval(consultar, 30_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [router]);

  if (!e) return null;

  const hace = (iso: string | null) => {
    if (!iso) return "nunca";
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "hace un momento";
    if (min < 60) return `hace ${min} min`;
    if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
    return `hace ${Math.floor(min / 1440)} d`;
  };

  const viejo = e.ultimaSync
    ? Date.now() - new Date(e.ultimaSync).getTime() > 26 * 3600 * 1000
    : true;

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-1.5 text-xs"
      style={{ borderColor: "var(--borde)", color: "var(--ink-2)" }}
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          style={{ color: e.conectado && !viejo ? "var(--exito-texto)" : "var(--estado-alerta)" }}
        >
          {e.conectado && !viejo ? "●" : "■"}
        </span>
        {!e.conectado
          ? "Mercado Libre sin conectar"
          : e.enVivo
            ? `En vivo · última novedad ${hace(e.ultimaSync)}`
            : `Última sincronización ${hace(e.ultimaSync)}`}
      </span>

      {e.planGeneradoEn ? (
        <span style={{ color: e.planVigente ? "var(--ink-muted)" : "var(--estado-alerta)" }}>
          Plan {e.planVigente ? "al día" : "desactualizado"} · {hace(e.planGeneradoEn)}
        </span>
      ) : null}

      {e.avisosPendientes > 0 ? (
        <a href="/pendientes" className="underline" style={{ color: "var(--estado-alerta)" }}>
          {e.avisosPendientes} pendientes por resolver
        </a>
      ) : null}
    </div>
  );
}
