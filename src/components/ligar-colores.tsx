"use client";

import { useState } from "react";

/** Un color del pedido que MELI no tiene como está escrito, con lo que MELI sí tiene. */
export interface ColorFantasma {
  modelo: string;
  color: string;
  coloresMeli: string[];
}

/** Un color del pedido que el dueño ya decidió a mano. */
export interface ColorLigado {
  modelo: string;
  color: string;
  /** null = confirmado como color nuevo */
  colorMeli: string | null;
}

const NUEVO = "__nuevo__";

/**
 * Ventana para LIGAR a mano un color del pedido con una variante de MELI
 * (pedido del dueño, 7-oct-2026: «que me ponga lo que MELI tiene, lo marque
 * en rojo por afuera y cuando me meta salgan las variantes de ese modelo y
 * yo elija cómo ligarlo»). Cada renglón fantasma enseña las variantes
 * publicadas del modelo; se elige una (o «es un color nuevo») y se guarda
 * en `pedido_color_amarres` por modelo + color: aplica a todos los pedidos,
 * contenedores y packing lists con esa escritura. Abajo, lo ya ligado, con
 * «Quitar». La misma ventana la usan Cargar pedidos y Contenedores.
 */
export function LigarColores({
  titulo,
  fantasmas,
  ligados,
  onCerrar,
  onCambio,
}: {
  titulo: string;
  fantasmas: ColorFantasma[];
  ligados: ColorLigado[];
  onCerrar: () => void;
  /** después de guardar o quitar un amarre (para recargar la pantalla) */
  onCambio: () => void;
}) {
  const [eleccion, setEleccion] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [hechos, setHechos] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const clave = (f: { modelo: string; color: string }) => `${f.modelo}|${f.color}`;

  async function mandar(cuerpo: Record<string, unknown>, k: string, texto: string) {
    setOcupado(k);
    setError(null);
    try {
      const r = await fetch("/api/pedidos/amarre-color", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar el amarre.");
      setHechos((h) => ({ ...h, [k]: texto }));
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  function ligar(f: ColorFantasma) {
    const k = clave(f);
    const elegido = eleccion[k];
    if (!elegido) return;
    if (elegido === NUEVO) {
      void mandar({ modelo: f.modelo, color: f.color, colorMeli: null }, k, "Confirmado como color nuevo");
    } else {
      void mandar({ modelo: f.modelo, color: f.color, colorMeli: elegido }, k, `Ligado a ${elegido}`);
    }
  }

  function quitar(l: ColorLigado) {
    void mandar({ modelo: l.modelo, color: l.color, quitar: true }, `q:${clave(l)}`, "Amarre quitado");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: "rgba(0,0,0,.45)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Ligar colores con MELI: ${titulo}`}
    >
      <div className="tarjeta my-8 w-full max-w-3xl p-5" style={{ background: "var(--surface-1)" }}>
        <h3 className="text-lg font-semibold">Ligar colores con MELI · {titulo}</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Estos colores no existen en MELI como los escribió la fábrica. Elige con qué variante
          publicada va cada uno (o confirma que es un color nuevo). El pedido conserva la escritura
          de la fábrica para que el packing list siga amarrando; el amarre aplica a todos los
          pedidos y contenedores con ese modelo y color, y a lo que viene en camino.
        </p>

        {error ? (
          <p className="mt-3 rounded-lg p-2 text-sm" style={{ background: "color-mix(in oklab, var(--estado-critico) 12%, transparent)" }}>
            {error}
          </p>
        ) : null}

        {fantasmas.length ? (
          <ul className="mt-3 flex flex-col gap-3">
            {fantasmas.map((f) => {
              const k = clave(f);
              const hecho = hechos[k];
              return (
                <li key={k} className="rounded-lg border p-3" style={{ borderColor: hecho ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="font-semibold">{f.modelo}</span>{" "}
                      <span className="font-medium" style={{ color: hecho ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                        {f.color}
                      </span>
                      <span className="ml-2 text-xs" style={{ color: "var(--ink-muted)" }}>
                        {hecho ?? "en el pedido · sin SKU en MELI"}
                      </span>
                    </div>
                  </div>
                  {hecho ? null : (
                    <>
                      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Variantes de MELI para ${f.modelo}`}>
                        {f.coloresMeli.map((c) => {
                          const activo = eleccion[k] === c;
                          return (
                            <button
                              key={c}
                              type="button"
                              role="radio"
                              aria-checked={activo}
                              onClick={() => setEleccion((e) => ({ ...e, [k]: c }))}
                              className="rounded-full border px-2.5 py-1 text-xs font-medium"
                              style={{
                                borderColor: activo ? "var(--acento)" : "var(--borde)",
                                background: activo ? "color-mix(in oklab, var(--acento) 15%, transparent)" : "transparent",
                                color: activo ? "var(--acento)" : undefined,
                              }}
                            >
                              {c}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={eleccion[k] === NUEVO}
                          onClick={() => setEleccion((e) => ({ ...e, [k]: NUEVO }))}
                          className="rounded-full border px-2.5 py-1 text-xs"
                          style={{
                            borderColor: eleccion[k] === NUEVO ? "var(--acento)" : "var(--borde)",
                            background: eleccion[k] === NUEVO ? "color-mix(in oklab, var(--acento) 15%, transparent)" : "transparent",
                            color: eleccion[k] === NUEVO ? "var(--acento)" : "var(--ink-2)",
                          }}
                        >
                          Es un color nuevo (no está en MELI)
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => ligar(f)}
                          disabled={!eleccion[k] || ocupado === k}
                          className="rounded-lg px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                          style={{ background: "var(--acento)" }}
                        >
                          {ocupado === k ? "Guardando…" : eleccion[k] === NUEVO ? "Confirmar como nuevo" : "Ligar"}
                        </button>
                        {!f.coloresMeli.length ? (
                          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                            MELI no tiene ningún color de este modelo.
                          </span>
                        ) : null}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--ink-muted)" }}>
            Todos los colores de este {titulo.toLowerCase().startsWith("contenedor") ? "contenedor" : "pedido"} existen en MELI.
          </p>
        )}

        {ligados.length ? (
          <div className="mt-4">
            <h4 className="text-sm font-semibold">Ya ligados a mano</h4>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {ligados.map((l) => {
                const k = `q:${clave(l)}`;
                return (
                  <li key={k} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.modelo}</span> {l.color}
                    <span style={{ color: "var(--ink-muted)" }}>→</span>
                    <span style={{ color: l.colorMeli ? "var(--exito-texto)" : "var(--ink-2)" }}>
                      {l.colorMeli ?? "color nuevo (no está en MELI)"}
                    </span>
                    {hechos[k] ? (
                      <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                        {hechos[k]}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => quitar(l)}
                        disabled={ocupado === k}
                        className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                        style={{ borderColor: "var(--borde)" }}
                      >
                        {ocupado === k ? "Quitando…" : "Quitar"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onCerrar} className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--borde)" }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
