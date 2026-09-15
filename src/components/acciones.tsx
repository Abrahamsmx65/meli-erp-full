"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/ui/boton";
import { avisar } from "@/components/ui/avisos";

/**
 * Lee la respuesta sin dar por hecho que es JSON.
 *
 * Cuando la función se pasa del tiempo, Vercel contesta una página de
 * error en texto plano y el JSON.parse tronaba con un «Unexpected token»
 * que no le dice nada a nadie.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function leerRespuesta(r: Response): Promise<any> {
  const texto = await r.text();
  try {
    return JSON.parse(texto);
  } catch {
    if (r.status === 504 || /timed? ?out|FUNCTION_INVOCATION_TIMEOUT/i.test(texto)) {
      throw new Error(
        "La operación se pasó del tiempo máximo. Vuelve a darle: retoma donde se quedó.",
      );
    }
    throw new Error(
      `El servidor contestó algo que no se pudo leer (${r.status}). Vuelve a intentar.`,
    );
  }
}

export function BotonesPlan() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function correr(tarea: "sync" | "guardar") {
    setOcupado(tarea);
    setAviso(null);
    setError(null);

    try {
      if (tarea === "sync") {
        const r = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const j = await leerRespuesta(r);
        if (!r.ok) throw new Error(j.error ?? "Falló la sincronización.");
        const d = j.resultado;
        const extra = d.recuperadas > 0
          ? ` (${d.recuperadas} publicaciones recuperadas desde las órdenes)`
          : "";
        setAviso(
          `Listo: ${d.skus} SKUs${extra}, ${d.conStock} con stock en Full, ${d.ordenes} órdenes y ${d.operaciones} movimientos.`,
        );
      } else {
        const r = await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guardar: true }),
        });
        const j = await leerRespuesta(r);
        if (!r.ok) throw new Error(j.error ?? "No se pudo archivar el plan.");
        setAviso("Plan archivado en el historial.");
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  // Una sola acción primaria (sincronizar); archivar es secundaria. El
  // recálculo vive en un solo lugar: la tarjeta de frescura de abajo.
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Boton
        variante="primario"
        onClick={() => correr("sync")}
        disabled={ocupado !== null}
        cargando={ocupado === "sync"}
        textoCargando="Sincronizando…"
      >
        Sincronizar con MELI
      </Boton>

      <Boton
        variante="fantasma"
        onClick={() => correr("guardar")}
        disabled={ocupado !== null}
        cargando={ocupado === "guardar"}
        textoCargando="Archivando…"
        title="Congela una copia de este plan en el historial, para consultarlo después"
      >
        Archivar en historial
      </Boton>

      {aviso ? (
        <span className="text-sm" style={{ color: "var(--exito-texto)" }}>
          {aviso}
        </span>
      ) : null}
      {error ? (
        <span className="text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Dice de cuándo es el plan que estás viendo — y es EL lugar del recálculo
 * (antes había dos botones de recalcular con jerarquías distintas, y este
 * ignoraba los errores del servidor: fallaba en silencio).
 *
 * El plan se guarda calculado para que la pantalla abra al instante. El
 * precio de eso es que puede quedar viejo, así que hay que decirlo: un plan
 * obsoleto presentado como fresco hace mandar cajas equivocadas.
 */
export function FrescuraPlan({
  generadoEn,
  vigente,
  motivo,
  msCalculo,
}: {
  generadoEn: string;
  vigente: boolean;
  motivo: string | null;
  msCalculo: number | null;
}) {
  const [recalculando, setRecalculando] = useState(false);
  const router = useRouter();

  const fecha = new Date(generadoEn);
  const minutos = Math.floor((Date.now() - fecha.getTime()) / 60000);
  const hace =
    minutos < 1 ? "hace un momento"
    : minutos < 60 ? `hace ${minutos} min`
    : minutos < 1440 ? `hace ${Math.floor(minutos / 60)} h`
    : `el ${fecha.toLocaleDateString("es-MX")}`;

  async function recalcular() {
    setRecalculando(true);
    try {
      const r = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recalcular: true }),
      });
      const j = await leerRespuesta(r);
      if (!r.ok) throw new Error(j.error ?? "No se pudo recalcular el plan.");
      avisar("exito", `Plan recalculado en ${((j.ms ?? 0) / 1000).toFixed(1)} s.`);
      router.refresh();
    } catch (e) {
      avisar("error", (e as Error).message);
    } finally {
      setRecalculando(false);
    }
  }

  return (
    <div
      className="tarjeta flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
      style={{
        borderColor: vigente ? "var(--borde)" : "var(--estado-alerta)",
        color: "var(--ink-2)",
      }}
    >
      <span aria-hidden="true" style={{ color: vigente ? "var(--exito-texto)" : "var(--estado-alerta)" }}>
        {vigente ? "●" : "■"}
      </span>
      <span>
        {vigente ? "Plan calculado" : "Plan desactualizado"} {hace}
        {msCalculo ? ` · tardó ${(msCalculo / 1000).toFixed(1)} s` : ""}
      </span>
      {!vigente && motivo ? (
        <span style={{ color: "var(--estado-alerta)" }}>· {motivo}</span>
      ) : null}
      <button
        onClick={recalcular}
        disabled={recalculando}
        className="underline disabled:opacity-60"
        style={{ color: "var(--acento)" }}
      >
        {recalculando ? "Recalculando…" : "Recalcular ahora"}
      </button>
    </div>
  );
}
