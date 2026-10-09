"use client";

import { useEffect, useRef, useState } from "react";
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
const RUTAS_CON_PLAN = ["/envios", "/pedidos", "/etiquetas", "/pendientes"];

export function EstadoConexion({ oculto = false }: { oculto?: boolean } = {}) {
  const [e, setE] = useState<Estado | null>(null);
  const router = useRouter();
  const ruta = usePathname();

  // El link sin contraseña no trae sesión: preguntar por /api/estado desde
  // ahí solo daría 401 cada 30 segundos, y esa barra habla de Mercado Libre,
  // que no es asunto de quien entra a trabajar el contenido.
  const publica =
    ruta.startsWith("/contenido/") || ruta.startsWith("/preparar/") || ruta.startsWith("/login");

  // Solo las pantallas que enseñan el plan se recargan cuando sale uno nuevo;
  // las demás (ventas, TikTok, cortes) no lo usan y recargarlas era rehacer
  // todo su trabajo de servidor sin razón.
  const rutaActual = useRef(ruta);
  rutaActual.current = ruta;

  useEffect(() => {
    if (publica) return;
    let vivo = true;

    async function consultar() {
      // Pestaña escondida: nadie está mirando la barra. Se pregunta al volver.
      if (typeof document !== "undefined" && document.hidden) return;
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
          if (
            previo &&
            j.planGeneradoEn &&
            previo.planGeneradoEn !== j.planGeneradoEn &&
            RUTAS_CON_PLAN.some((r) => rutaActual.current.startsWith(r))
          ) {
            router.refresh();
          }
          return j;
        });
      } catch {
        /* sin conexión: se reintenta en el siguiente ciclo */
      }
    }

    consultar();
    const t = setInterval(consultar, 60_000);
    const alVolver = () => {
      if (!document.hidden) consultar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [router, publica]);

  // Oculto (dueño, 9-oct-2026: «no necesitamos el de cuándo fue la sync ni
  // los pendientes ahí»): la consulta sigue corriendo porque es la que
  // enciende el latido mientras la app está abierta, pero no pinta nada.
  if (publica || !e || oculto) return null;

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
      style={{ color: "var(--ink-2)" }}
      aria-live="polite"
    >
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
        style={{ background: "var(--surface-2)", boxShadow: "inset 0 0 0 1px var(--borde)" }}
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
            background: vivo ? "var(--estado-bien)" : "var(--estado-serio)",
            boxShadow: vivo ? "0 0 0 3px rgba(0,166,80,.15)" : "none",
          }}
        />
        {!e.conectado
          ? "MELI sin conectar"
          : e.enVivo
            ? `MELI en vivo · ${hace(e.ultimaSync)}`
            : `MELI · ${hace(e.ultimaSync)}`}
        {e.ultimaSyncAmazon ? (
          <span className="hidden xl:inline texto-tenue">· Amazon {hace(e.ultimaSyncAmazon)}</span>
        ) : null}
      </span>

      {e.planGeneradoEn && !e.planVigente ? (
        <span
          className="hidden rounded-full px-2.5 py-1 lg:inline-flex"
          style={{ background: "var(--alerta-suave)", color: "var(--alerta-texto)" }}
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
