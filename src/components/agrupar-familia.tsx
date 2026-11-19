"use client";

import { useState } from "react";
import { Aviso, Seccion } from "@/components/ui/pagina";
import { confirmar } from "@/components/ui/confirmar";

/**
 * Meter publicaciones ya creadas a una familia de MELI. Primero se LEE la
 * familia destino (sin escribir) para confirmar con su nombre; luego se
 * escribe y se enseña, publicación por publicación, dónde la dejó MELI.
 */

interface Familia {
  familyId: string | null;
  familyName: string;
  itemId: string;
  categoria: string | null;
}

interface Diferencia {
  atributoId: string;
  nombre: string;
  enPublicacion: string | null;
  enFamilia: string | null;
}

interface Resultado {
  itemId: string;
  estado: "agrupado" | "ya_estaba" | "otra_familia" | "error";
  familiaAntes: string | null;
  familiaDespues: string | null;
  nombreAntes: string | null;
  detalle: string | null;
  diferencias: Diferencia[];
}

const ESTADO: Record<Resultado["estado"], { texto: string; color: string }> = {
  agrupado: { texto: "agrupada", color: "var(--estado-bien)" },
  ya_estaba: { texto: "ya estaba", color: "var(--estado-bien)" },
  otra_familia: { texto: "quedó en otra familia", color: "var(--estado-alerta)" },
  error: { texto: "no se pudo", color: "var(--estado-critico)" },
};

export function AgruparFamilia() {
  const [publicaciones, setPublicaciones] = useState("");
  const [destino, setDestino] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [familia, setFamilia] = useState<Familia | null>(null);
  const [resultados, setResultados] = useState<Resultado[]>([]);

  const pedir = async (soloRevisar: boolean) => {
    const r = await fetch("/api/listados/familia", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicaciones, destino, soloRevisar }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error ?? "No se pudo agrupar.");
    return j as { familia: Familia; resultados: Resultado[] };
  };

  const agrupar = async () => {
    setTrabajando(true);
    setError(null);
    setResultados([]);
    try {
      const previa = await pedir(true);
      setFamilia(previa.familia);
      const seguro = await confirmar({
        titulo: "¿Agrupar en esta familia?",
        mensaje: `Se les va a poner el nombre de familia «${previa.familia.familyName}» (el de ${previa.familia.itemId}${
          previa.familia.familyId ? `, familia ${previa.familia.familyId}` : ""
        }). MELI arma el título de la publicación con ese nombre. Esto escribe directo en Mercado Libre.`,
        confirmar: "Escribir en MELI",
      });
      if (!seguro) return;
      const hecho = await pedir(false);
      setFamilia(hecho.familia);
      setResultados(hecho.resultados);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Seccion
      titulo="Agrupar en una familia"
      descripcion="Mete publicaciones ya creadas a la familia de otra publicación."
      ayuda={
        <p>
          MELI junta en una página las publicaciones que comparten el nombre de familia. Aquí se le escribe a cada MLM
          el nombre de la familia destino y se vuelve a leer en qué familia lo dejó MELI. Si queda en otra, abajo salen
          los atributos que trae distintos a la familia.
        </p>
      }
    >
      <div className="grid gap-3 md:grid-cols-[1fr_260px_auto] md:items-end">
        <label className="block text-[13px]">
          <span className="texto-2">Publicaciones por agrupar (MLM)</span>
          <textarea
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            rows={2}
            placeholder="MLM1234567890, MLM0987654321"
            value={publicaciones}
            onChange={(e) => setPublicaciones(e.target.value)}
          />
        </label>
        <label className="block text-[13px]">
          <span className="texto-2">Familia destino (id o un MLM de ella)</span>
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="2168760072158418"
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
          />
        </label>
        <button
          className="boton boton-primario"
          disabled={trabajando || !publicaciones.trim() || !destino.trim()}
          onClick={() => void agrupar()}
        >
          {trabajando ? "Trabajando…" : "Agrupar"}
        </button>
      </div>

      {error ? (
        <div className="mt-3">
          <Aviso tono="critico">{error}</Aviso>
        </div>
      ) : null}

      {resultados.length ? (
        <div className="mt-4 space-y-2">
          {familia ? (
            <p className="texto-2 text-[13px]">
              Familia {familia.familyId ?? "—"} · «{familia.familyName}» · referencia {familia.itemId}
            </p>
          ) : null}
          {resultados.map((r) => (
            <div key={r.itemId} className="rounded-lg border p-3 text-[13px]" style={{ borderColor: "var(--borde)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <strong>{r.itemId}</strong>
                <span className="font-bold" style={{ color: ESTADO[r.estado].color }}>
                  {ESTADO[r.estado].texto}
                </span>
                <span className="texto-tenue">
                  familia {r.familiaAntes ?? "—"} → {r.familiaDespues ?? "—"}
                </span>
              </div>
              {r.nombreAntes ? <p className="texto-tenue mt-1">Nombre anterior: «{r.nombreAntes}»</p> : null}
              {r.detalle ? <p className="mt-1">{r.detalle}</p> : null}
              {r.diferencias.length ? (
                <table className="mt-2 w-full text-[12px]">
                  <thead>
                    <tr className="texto-tenue text-left">
                      <th className="py-1 pr-3 font-medium">Atributo distinto</th>
                      <th className="py-1 pr-3 font-medium">Esta publicación</th>
                      <th className="py-1 font-medium">La familia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.diferencias.map((d) => (
                      <tr key={d.atributoId}>
                        <td className="py-0.5 pr-3">{d.nombre}</td>
                        <td className="py-0.5 pr-3">{d.enPublicacion ?? "(sin dato)"}</td>
                        <td className="py-0.5">{d.enFamilia ?? "(sin dato)"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Seccion>
  );
}
