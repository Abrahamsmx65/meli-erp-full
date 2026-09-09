"use client";

import { useMemo, useState } from "react";
import type {
  AgrupadorConocido,
  Diferencia,
  GrupoListados,
  ItemListado,
  ResultadoUnificacion,
} from "@/lib/servicios/listados";

/**
 * Buscador de agrupadores + comparador de atributos + unificación.
 *
 * La lectura es en vivo (tarda unos segundos: son varias llamadas a MELI) y la
 * unificación escribe directo en las publicaciones, así que se confirma antes
 * y se muestra el resultado publicación por publicación con el mensaje real
 * de MELI cuando algo se rechaza.
 */

const ESTADOS: Record<string, { texto: string; color: string }> = {
  active: { texto: "activa", color: "var(--estado-bien)" },
  paused: { texto: "pausada", color: "var(--estado-alerta)" },
  closed: { texto: "cerrada", color: "var(--estado-serio)" },
  under_review: { texto: "en revisión", color: "var(--estado-alerta)" },
};

function ChipEstado({ estado }: { estado: string | null }) {
  const e = (estado && ESTADOS[estado]) || { texto: estado ?? "—", color: "var(--ink-muted)" };
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ background: "color-mix(in oklab, currentColor 12%, transparent)", color: e.color }}
    >
      {e.texto}
    </span>
  );
}

const SIN_DATO = "(sin dato)";
const claveDif = (d: Diferencia) => `${d.nivel}:${d.atributoId}`;

export function Listados({ agrupadores }: { agrupadores: AgrupadorConocido[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<GrupoListados | null>(null);

  // Elección por diferencia: valor destino y texto libre ("otro valor").
  const [eleccion, setEleccion] = useState<Record<string, string>>({});
  const [otro, setOtro] = useState<Record<string, string>>({});
  const [aplicando, setAplicando] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Record<string, ResultadoUnificacion[]>>({});

  const buscar = async (agrupador: string) => {
    const q = agrupador.trim();
    if (!q) return;
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`/api/listados?agrupador=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo leer el agrupador.");
      setGrupo(j.grupo as GrupoListados);
      setEleccion({});
      setOtro({});
    } catch (err) {
      setGrupo(null);
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  };

  const unificar = async (d: Diferencia) => {
    if (!grupo) return;
    const k = claveDif(d);
    const libre = (otro[k] ?? "").trim();
    const valor = libre || eleccion[k] || "";
    if (!valor || valor === SIN_DATO) return;

    const seguro = confirm(
      `Se va a poner "${d.nombre}" = "${valor}" en las ${grupo.items.length} publicaciones del agrupador ${grupo.agrupador}. Esto escribe directo en Mercado Libre. ¿Continuar?`,
    );
    if (!seguro) return;

    setAplicando(k);
    try {
      const r = await fetch("/api/listados/atributo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          atributoId: d.atributoId,
          valor,
          itemIds: grupo.items.map((i) => i.itemId),
        }),
      });
      const j = await r.json();
      if (!r.ok && !j?.resultados) throw new Error(j?.error ?? "No se pudo unificar.");
      setResultados((prev) => ({ ...prev, [k]: j.resultados as ResultadoUnificacion[] }));
      // Releer para que la pantalla muestre la foto nueva de MELI.
      await buscar(grupo.agrupador);
    } catch (err) {
      setResultados((prev) => ({
        ...prev,
        [k]: [{ itemId: "—", estado: "error", niveles: [], detalle: (err as Error).message }],
      }));
    } finally {
      setAplicando(null);
    }
  };

  // Las medidas del paquete difieren en cada publicación (MELI las mide) y
  // no parten el selector: van aparte para no tapar las diferencias reales.
  const raras = grupo?.diferencias.filter((d) => !d.esperada && !d.esMedida) ?? [];
  const esperadas = grupo?.diferencias.filter((d) => d.esperada && !d.esMedida) ?? [];
  const medidas = grupo?.diferencias.filter((d) => d.esMedida) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <section className="tarjeta p-4">
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void buscar(busqueda);
          }}
        >
          <input
            type="search"
            list="agrupadores-conocidos"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Agrupador (modelo): GT135, GT155…"
            className="min-w-[16rem] flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            autoFocus
          />
          <button
            type="submit"
            disabled={cargando || !busqueda.trim()}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--acento)" }}
          >
            {cargando ? "Leyendo MELI…" : "Buscar"}
          </button>
          <datalist id="agrupadores-conocidos">
            {agrupadores.map((a) => (
              <option key={a.modelo} value={a.modelo}>
                {`${a.publicaciones} publicaciones · ${a.variantes} variantes`}
              </option>
            ))}
          </datalist>
        </form>
        {error ? (
          <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
            {error}
          </p>
        ) : null}
      </section>

      {grupo ? (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm" style={{ color: "var(--ink-2)" }}>
            <span className="text-base font-semibold" style={{ color: "var(--ink-1)" }}>
              {grupo.agrupador}
            </span>
            <span>
              {grupo.items.length} publicaciones ·{" "}
              {grupo.items.reduce((s, i) => s + i.variantes.length, 0)} variantes
            </span>
            {grupo.lotesFallidos > 0 ? (
              <span style={{ color: "var(--estado-alerta)" }}>
                MELI no contestó {grupo.lotesFallidos} lote(s): la foto puede estar incompleta.
              </span>
            ) : null}
          </div>

          {raras.length === 0 ? (
            <section className="tarjeta p-4 text-sm" style={{ color: "var(--exito-texto)" }}>
              Sin diferencias raras: fuera de talla, color y códigos, todas las publicaciones
              del agrupador traen los mismos atributos.
            </section>
          ) : (
            <section className="tarjeta overflow-hidden">
              <header className="border-b p-4 hairline">
                <h2 className="text-sm font-semibold">
                  Diferencias que parten el selector ({raras.length})
                </h2>
                <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
                  Elige el valor correcto y unifícalo: se escribe en todas las publicaciones
                  del agrupador, en el nivel donde viva el atributo (publicación o variante).
                </p>
              </header>

              <div className="flex flex-col divide-y" style={{ borderColor: "var(--borde)" }}>
                {raras.map((d) => {
                  const k = claveDif(d);
                  const res = resultados[k];
                  return (
                    <div key={k} className="flex flex-col gap-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{d.nombre}</span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                          style={{
                            background: "var(--acento-suave)",
                            color: "var(--acento)",
                          }}
                        >
                          {d.nivel === "publicacion" ? "por publicación" : "por variante"}
                        </span>
                        {d.esMaterial ? (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                            style={{
                              background: "color-mix(in oklab, var(--ambar) 20%, transparent)",
                              color: "var(--ink-1)",
                            }}
                          >
                            material
                          </span>
                        ) : null}
                        <span className="cifra text-xs" style={{ color: "var(--ink-muted)" }}>
                          {d.atributoId}
                        </span>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        {d.valores.map((v) => (
                          <label
                            key={v.valor}
                            className="flex cursor-pointer items-baseline gap-2 text-sm"
                            title={v.donde.join("\n")}
                          >
                            <input
                              type="radio"
                              name={k}
                              disabled={v.valor === SIN_DATO}
                              checked={eleccion[k] === v.valor && !(otro[k] ?? "").trim()}
                              onChange={() => {
                                setEleccion((p) => ({ ...p, [k]: v.valor }));
                                setOtro((p) => ({ ...p, [k]: "" }));
                              }}
                            />
                            <span className={v.valor === SIN_DATO ? "italic" : ""}>
                              {v.valor}
                            </span>
                            <span className="cifra text-xs" style={{ color: "var(--ink-muted)" }}>
                              ×{v.veces}
                            </span>
                            <span
                              className="min-w-0 flex-1 truncate text-xs"
                              style={{ color: "var(--ink-muted)" }}
                            >
                              {v.donde.join(", ")}
                            </span>
                          </label>
                        ))}
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={k}
                            checked={!!(otro[k] ?? "").trim()}
                            onChange={() => setEleccion((p) => ({ ...p, [k]: "" }))}
                          />
                          <span style={{ color: "var(--ink-2)" }}>Otro valor:</span>
                          <input
                            type="text"
                            value={otro[k] ?? ""}
                            onChange={(e) => setOtro((p) => ({ ...p, [k]: e.target.value }))}
                            placeholder="escríbelo como debe quedar"
                            className="min-w-[14rem] flex-1 rounded-lg border px-2 py-1 text-sm"
                            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                          />
                        </label>
                      </div>

                      <div>
                        <button
                          onClick={() => void unificar(d)}
                          disabled={
                            aplicando !== null ||
                            cargando ||
                            !((otro[k] ?? "").trim() || (eleccion[k] && eleccion[k] !== SIN_DATO))
                          }
                          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                          style={{ background: "var(--acento)" }}
                        >
                          {aplicando === k
                            ? "Escribiendo en MELI…"
                            : `Unificar en ${grupo.items.length} publicaciones`}
                        </button>
                      </div>

                      {res ? (
                        <ul className="flex flex-col gap-0.5 text-xs">
                          {res.map((r, i) => (
                            <li key={`${r.itemId}-${i}`} className="flex items-baseline gap-2">
                              <span className="cifra">{r.itemId}</span>
                              {r.estado === "actualizado" ? (
                                <span style={{ color: "var(--exito-texto)" }}>
                                  ✓ actualizado ({r.niveles.join(" y ")})
                                </span>
                              ) : r.estado === "sin_cambio" ? (
                                <span style={{ color: "var(--ink-muted)" }}>ya estaba bien</span>
                              ) : (
                                <span style={{ color: "var(--estado-critico)" }}>
                                  ✗ {r.detalle ?? "error"}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {medidas.length ? (
            <details className="tarjeta p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Medidas del paquete ({medidas.length}): MELI las mide por publicación, no
                parten el selector
              </summary>
              <ListaValores diferencias={medidas} />
            </details>
          ) : null}

          {esperadas.length ? (
            <details className="tarjeta p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Diferencias esperadas ({esperadas.length}): talla, color, códigos
              </summary>
              <ListaValores diferencias={esperadas} />
            </details>
          ) : null}

          {grupo.items.map((item) => (
            <TarjetaItem key={item.itemId} item={item} diferencias={raras} />
          ))}
        </>
      ) : null}
    </div>
  );
}

/** Lista compacta (solo lectura) de diferencias: nombre y sus valores con cuántas veces. */
function ListaValores({ diferencias }: { diferencias: Diferencia[] }) {
  return (
    <div className="mt-3 flex flex-col gap-2 text-sm">
      {diferencias.map((d) => (
        <div key={claveDif(d)} className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">{d.nombre}:</span>
          {d.valores.map((v) => (
            <span
              key={v.valor}
              className="rounded-full border px-2 py-0.5 text-xs"
              style={{ borderColor: "var(--borde)", color: "var(--ink-2)" }}
              title={v.donde.join("\n")}
            >
              {v.valor} <span className="cifra">×{v.veces}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function TarjetaItem({ item, diferencias }: { item: ItemListado; diferencias: Diferencia[] }) {
  // Columnas extra de la tabla: los atributos POR VARIANTE que difieren.
  const columnasVar = useMemo(
    () => diferencias.filter((d) => d.nivel === "variante"),
    [diferencias],
  );
  const difsItem = useMemo(
    () => diferencias.filter((d) => d.nivel === "publicacion"),
    [diferencias],
  );

  // El valor mayoritario de cada diferencia, para resaltar al que se sale.
  const mayoritario = (d: Diferencia) => d.valores[0]?.valor ?? null;
  const resalte = { background: "color-mix(in oklab, var(--ambar) 18%, transparent)" };

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b p-4 hairline">
        <span className="text-sm font-semibold">
          {item.permalink ? (
            <a href={item.permalink} target="_blank" rel="noreferrer" className="underline">
              {item.titulo || item.itemId}
            </a>
          ) : (
            item.titulo || item.itemId
          )}
        </span>
        {item.color ? (
          <span
            className="rounded-full border px-2 py-0.5 text-xs"
            style={{ borderColor: "var(--borde)", color: "var(--ink-2)" }}
          >
            {item.color}
          </span>
        ) : null}
        <ChipEstado estado={item.estado} />
        <span className="cifra text-xs" style={{ color: "var(--ink-muted)" }}>
          {item.itemId}
        </span>
        {item.precio != null ? (
          <span className="cifra ml-auto text-sm">
            ${item.precio.toLocaleString("es-MX")}
          </span>
        ) : null}
      </header>

      {difsItem.length ? (
        <div className="flex flex-wrap gap-2 border-b p-3 hairline text-xs">
          {difsItem.map((d) => {
            const propio = item.atributos.find((a) => a.id === d.atributoId)?.valor ?? SIN_DATO;
            const difiere = propio !== mayoritario(d);
            return (
              <span
                key={d.atributoId}
                className="rounded-full border px-2 py-0.5"
                style={{ borderColor: "var(--borde)", ...(difiere ? resalte : {}) }}
                title={difiere ? "Distinto al valor mayoritario del agrupador" : undefined}
              >
                <span style={{ color: "var(--ink-2)" }}>{d.nombre}:</span>{" "}
                <span className={propio === SIN_DATO ? "italic" : "font-medium"}>{propio}</span>
              </span>
            );
          })}
        </div>
      ) : null}

      {item.variantes.length ? (
        <div className="max-h-[24rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Talla</th>
                <th>SKU</th>
                <th>Combinación</th>
                <th className="num">Stock</th>
                <th className="num">Precio</th>
                {columnasVar.map((d) => (
                  <th key={d.atributoId}>{d.nombre}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {item.variantes.map((v) => (
                <tr key={v.variationId}>
                  <td className="cifra font-medium">{v.talla ?? "—"}</td>
                  <td className="cifra text-xs">{v.sku ?? "—"}</td>
                  <td className="text-xs" style={{ color: "var(--ink-2)" }}>
                    {v.combinacion || "—"}
                  </td>
                  <td className="num cifra">{v.stock ?? "—"}</td>
                  <td className="num cifra">
                    {v.precio != null ? `$${v.precio.toLocaleString("es-MX")}` : "—"}
                  </td>
                  {columnasVar.map((d) => {
                    const propio = v.atributos.find((a) => a.id === d.atributoId)?.valor ?? SIN_DATO;
                    const difiere = propio !== mayoritario(d);
                    return (
                      <td
                        key={d.atributoId}
                        className="text-xs"
                        style={difiere ? resalte : undefined}
                      >
                        <span className={propio === SIN_DATO ? "italic" : ""}>{propio}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-4 text-sm" style={{ color: "var(--ink-muted)" }}>
          Publicación sin variantes.
        </p>
      )}
    </section>
  );
}
