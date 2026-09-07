"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

interface Estado {
  conectado: boolean;
  ultimaSync: string | null;
  ultimaSyncAmazon: string | null;
  planGeneradoEn: string | null;
  planVigente: boolean;
  avisosPendientes: number;
  enVivo: boolean;
}

/**
 * Estado de la conexión con Mercado Libre, en la barra superior.
 *
 * Ahora que la sincronización es por webhooks, el usuario ya no pica botones:
 * los datos cambian solos. Pero "solo" no puede significar "a ciegas" — si el
 * sistema se actualiza sin avisar, uno nunca sabe si lo que está viendo es de
 * hace un minuto o de hace tres días. Esta barra es ese aviso.
 */
export function EstadoConexion() {
  const [e, setE] = useState<Estado | null>(null);
  const router = useRouter();
  const ruta = usePathname();

  // El link sin contraseña no trae sesión: preguntar por /api/estado desde
  // ahí solo daría 401 cada 30 segundos, y esa barra habla de Mercado Libre,
  // que no es asunto de quien entra a trabajar el contenido.
  const publica =
    ruta.startsWith("/contenido/") || ruta.startsWith("/preparar/") || ruta.startsWith("/login");

  useEffect(() => {
    if (publica) return;
    let vivo = true;

    async function consultar() {
      try {
        const r = await fetch("/api/estado", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as Estado;
        if (!vivo) return;
        setE((previo) => {
          // Refrescar solo cuando hay un plan nuevo listo. Antes se refrescaba
          // con cada aviso de MELI —o sea cada 30 segundos en horario de
          // ventas— y las páginas pesadas se recargaban enteras sin parar:
          // esa era la mayor causa de que la app se sintiera lenta.
          if (previo && j.planGeneradoEn && previo.planGeneradoEn !== j.planGeneradoEn) {
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
  }, [router, publica]);

  if (publica || !e) return null;

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

  const vivo = e.conectado && !viejo;

  return (
    <div
      className="flex items-center gap-2 text-[12px] font-medium"
      style={{ color: "var(--marca-texto)" }}
      aria-live="polite"
    >
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
        style={{ background: "var(--marca-suave)" }}
        title={
          e.planGeneradoEn
            ? `Plan ${e.planVigente ? "al día" : "desactualizado"} · ${hace(e.planGeneradoEn)}`
            : undefined
        }
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{
            background: vivo ? "#2ecc71" : "#ff9f43",
            boxShadow: vivo ? "0 0 0 3px rgba(46,204,113,.25)" : "none",
          }}
        />
        {!e.conectado
          ? "MELI sin conectar"
          : e.enVivo
            ? `MELI en vivo · ${hace(e.ultimaSync)}`
            : `MELI · ${hace(e.ultimaSync)}`}
        {e.ultimaSyncAmazon ? (
          <span style={{ color: "rgba(255,255,255,.6)" }}>· Amazon {hace(e.ultimaSyncAmazon)}</span>
        ) : null}
      </span>

      {e.planGeneradoEn && !e.planVigente ? (
        <span
          className="hidden rounded-full px-2.5 py-1 lg:inline-flex"
          style={{ background: "rgba(255,159,67,.22)", color: "#ffd2a8" }}
        >
          Plan desactualizado
        </span>
      ) : null}

      {e.avisosPendientes > 0 ? (
        <a
          href="/pendientes"
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
          style={{ background: "var(--estado-critico)", color: "#fff" }}
        >
          <span className="cifra">{e.avisosPendientes}</span> pendientes
        </a>
      ) : null}
    </div>
  );
}
