"use client";

import { useState } from "react";
import { Boton } from "@/components/ui/boton";
import { avisar } from "@/components/ui/avisos";
import { Aviso } from "@/components/ui/pagina";

/** Solo lo que la tabla pinta: el detalle por renglón se queda en el servidor. */
export interface PendienteBodega {
  id: string;
  fecha: string | null;
  cajas: number | null;
  pares: number;
  omitido: boolean;
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Los envíos pendientes que la bodega (Industher) ya tiene apartados para
 * salir a MELI Full (id que empieza con 7 u 8). Van hasta arriba de Envíos
 * a Full: el plan los está CONSIDERANDO como en camino, y aquí se decide
 * cuál no debe contar. Cuando la bodega lo marca recibido, deja de venir
 * del API y desaparece solo.
 *
 * El cambio se aplica a la fila EN EL MOMENTO (tras confirmar el servidor),
 * sin recargar la página: el plan lo recoge en su siguiente recálculo.
 */
export function PendientesIndusther({
  envios: iniciales,
  error,
}: {
  envios: PendienteBodega[];
  error: string | null;
}) {
  const [envios, setEnvios] = useState(iniciales);
  const [ocupado, setOcupado] = useState<string | null>(null);

  if (error) {
    return (
      <Aviso tono="alerta">No pude leer los envíos pendientes de la bodega: {error}</Aviso>
    );
  }
  if (!envios.length) return null;

  async function marcar(e: PendienteBodega) {
    setOcupado(e.id);
    try {
      const r = await fetch("/api/envios-pendientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envioId: e.id, omitir: !e.omitido }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      setEnvios((prev) => prev.map((x) => (x.id === e.id ? { ...x, omitido: !e.omitido } : x)));
      avisar(
        "exito",
        e.omitido
          ? `El envío ${e.id} vuelve a contar como en camino (${n(e.pares)} pares).`
          : `El envío ${e.id} deja de contar: ${n(e.pares)} pares fuera del plan en el siguiente recálculo.`,
      );
    } catch (err) {
      avisar("error", (err as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const activos = envios.filter((e) => !e.omitido);

  return (
    <section className="tarjeta overflow-hidden">
      <header className="seccion-cabeza">
        <div className="min-w-0">
          <h2 className="seccion-titulo">Envíos pendientes en la bodega (a MELI Full)</h2>
          <p className="texto-2 mt-0.5 text-[13px]">
            Ya apartados para salir: cuentan como en camino hasta recibirse en Full.
          </p>
        </div>
        <span
          className="chip cifra"
          style={{ background: "var(--acento-suave)", color: "var(--acento)" }}
        >
          {n(activos.reduce((a, e) => a + e.pares, 0))} pares considerados
        </span>
      </header>

      <div className="tabla-caja">
      <table className="datos">
        <thead>
          <tr>
            <th>ID del envío</th>
            <th>Fecha</th>
            <th className="num">Cajas</th>
            <th className="num">Pares</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {envios.map((e) => (
            <tr key={e.id} style={{ opacity: e.omitido ? 0.5 : 1 }}>
              <td className="cifra font-medium" style={{ textDecoration: e.omitido ? "line-through" : "none" }}>
                {e.id}
              </td>
              <td className="text-xs">{e.fecha ? e.fecha.slice(0, 10) : "—"}</td>
              <td className="num cifra">{e.cajas ? n(e.cajas) : "—"}</td>
              <td className="num cifra">{n(e.pares)}</td>
              <td className="text-xs" style={{ color: e.omitido ? "var(--ink-muted)" : "var(--exito-texto)" }}>
                {e.omitido ? "No cuenta en el plan" : "Contando como en camino"}
              </td>
              <td>
                <Boton
                  onClick={() => marcar(e)}
                  chico
                  cargando={ocupado === e.id}
                  textoCargando="…"
                  disabled={ocupado !== null}
                  title={
                    e.omitido
                      ? `Vuelve a contar sus ${n(e.pares)} pares como en camino`
                      : `Sus ${n(e.pares)} pares dejarán de contar como en camino`
                  }
                >
                  {e.omitido ? "Volver a contar" : "No contar"}
                </Boton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
