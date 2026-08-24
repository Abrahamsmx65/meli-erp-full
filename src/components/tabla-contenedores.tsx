"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Contenedor {
  id: string;
  numero: string;
  numeroNaviera: string | null;
  naviera: string | null;
  fechaSalida: string | null;
  llegadaEst: string | null;
  llegadaReal: string | null;
  almacenDestino: string | null;
  estado: string;
  notas: string | null;
  cajas: number;
  pedidos: { pedido: string; cajas: number }[];
}

const ETIQUETA_ESTADO: Record<string, { texto: string; color: string }> = {
  en_transito: { texto: "En tránsito", color: "var(--acento)" },
  en_aduana: { texto: "En aduana", color: "var(--estado-alerta)" },
  recibido: { texto: "Recibido", color: "var(--exito-texto)" },
};

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function fecha(s: string | null): string {
  return s ? s.slice(0, 10) : "—";
}

/**
 * La tabla de contenedores, editable en el propio renglón. La llave es
 * NUESTRO ID (`numero`); el número de la naviera es solo para rastreo.
 * Confirmar la llegada nunca suma inventario.
 */
export function TablaContenedores({ contenedores }: { contenedores: Contenedor[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function abrirEdicion(c: Contenedor) {
    setEditando(c.id);
    setError(null);
    setForm({
      numeroNaviera: c.numeroNaviera ?? "",
      naviera: c.naviera ?? "",
      fechaSalida: c.fechaSalida?.slice(0, 10) ?? "",
      fechaLlegadaEst: c.llegadaEst?.slice(0, 10) ?? "",
      estado: c.estado,
      notas: c.notas ?? "",
    });
  }

  async function mandar(cuerpo: Record<string, unknown>, id: string) {
    setOcupado(id);
    setError(null);
    try {
      const r = await fetch("/api/contenedores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...cuerpo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      setEditando(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function confirmarLlegada(c: Contenedor) {
    const seguro = window.confirm(
      `¿Confirmar que el contenedor ${c.numero} ya llegó (${n(c.cajas)} cajas)? ` +
        "No se suma inventario: las existencias llegan del API de Industher. " +
        "Solo deja de contar como en camino.",
    );
    if (!seguro) return;
    await mandar({ accion: "confirmarLlegada" }, c.id);
  }

  if (!contenedores.length) {
    return (
      <section className="tarjeta p-6 text-center">
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          Todavía no hay contenedores. Se dan de alta desde Planificación China, con
          el botón <strong>Contenedor</strong> de cada pedido.
        </p>
      </section>
    );
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b p-3 hairline">
        <h2 className="text-sm font-semibold">Contenedores</h2>
      </header>

      {error ? (
        <p className="px-3 pt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}

      <div className="overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Nuestro ID</th>
              <th>Naviera</th>
              <th>Salida</th>
              <th>Llegada est.</th>
              <th>Llegada real</th>
              <th className="num">Cajas</th>
              <th>Pedidos</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {contenedores.map((c) => {
              const e = ETIQUETA_ESTADO[c.estado] ?? {
                texto: c.estado,
                color: "var(--ink-muted)",
              };
              const abierto = editando === c.id;
              return (
                <tr key={c.id} style={abierto ? { background: "var(--surface-2)" } : undefined}>
                  <td className="font-medium">
                    {c.numero}
                    {c.notas && !abierto ? (
                      <div
                        className="max-w-48 truncate text-[11px]"
                        style={{ color: "var(--ink-muted)" }}
                        title={c.notas}
                      >
                        {c.notas}
                      </div>
                    ) : null}
                  </td>
                  <td className="text-xs">
                    {abierto ? (
                      <div className="flex flex-col gap-1">
                        <input
                          value={form.naviera}
                          onChange={(ev) => setForm((f) => ({ ...f, naviera: ev.target.value }))}
                          placeholder="Naviera"
                          className="w-32 rounded border px-1.5 py-0.5"
                          style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                        />
                        <input
                          value={form.numeroNaviera}
                          onChange={(ev) =>
                            setForm((f) => ({ ...f, numeroNaviera: ev.target.value.toUpperCase() }))
                          }
                          placeholder="Núm. de la naviera"
                          className="w-32 rounded border px-1.5 py-0.5"
                          style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                        />
                      </div>
                    ) : (
                      <>
                        {c.naviera || "—"}
                        {c.numeroNaviera ? (
                          <div className="cifra text-[11px]" style={{ color: "var(--ink-muted)" }}>
                            {c.numeroNaviera}
                          </div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="text-xs">
                    {abierto ? (
                      <input
                        type="date"
                        value={form.fechaSalida}
                        onChange={(ev) => setForm((f) => ({ ...f, fechaSalida: ev.target.value }))}
                        className="rounded border px-1.5 py-0.5"
                        style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                      />
                    ) : (
                      <span className="cifra">{fecha(c.fechaSalida)}</span>
                    )}
                  </td>
                  <td className="text-xs">
                    {abierto ? (
                      <input
                        type="date"
                        value={form.fechaLlegadaEst}
                        onChange={(ev) =>
                          setForm((f) => ({ ...f, fechaLlegadaEst: ev.target.value }))
                        }
                        className="rounded border px-1.5 py-0.5"
                        style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                      />
                    ) : (
                      <span className="cifra">{fecha(c.llegadaEst)}</span>
                    )}
                  </td>
                  <td className="cifra text-xs">{fecha(c.llegadaReal)}</td>
                  <td className="num cifra">{n(c.cajas)}</td>
                  <td className="text-xs">
                    {c.pedidos.length ? (
                      c.pedidos.map((p) => (
                        <div key={p.pedido}>
                          <span className="font-medium">{p.pedido}</span>{" "}
                          <span style={{ color: "var(--ink-2)" }}>{n(p.cajas)} cajas</span>
                        </div>
                      ))
                    ) : (
                      <span style={{ color: "var(--ink-muted)" }}>—</span>
                    )}
                  </td>
                  <td>
                    {abierto ? (
                      <select
                        value={form.estado}
                        onChange={(ev) => setForm((f) => ({ ...f, estado: ev.target.value }))}
                        className="rounded border px-1.5 py-0.5 text-xs"
                        style={{ borderColor: "var(--borde)", background: "var(--surface-1)" }}
                      >
                        <option value="en_transito">En tránsito</option>
                        <option value="en_aduana">En aduana</option>
                        <option value="recibido">Recibido</option>
                      </select>
                    ) : (
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          background: `color-mix(in oklab, ${e.color} 15%, transparent)`,
                          color: e.color,
                        }}
                      >
                        {e.texto}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {abierto ? (
                        <>
                          <button
                            onClick={() =>
                              mandar(
                                {
                                  numeroNaviera: form.numeroNaviera,
                                  naviera: form.naviera,
                                  fechaSalida: form.fechaSalida,
                                  fechaLlegadaEst: form.fechaLlegadaEst,
                                  estado: form.estado,
                                  notas: form.notas,
                                },
                                c.id,
                              )
                            }
                            disabled={ocupado === c.id}
                            className="rounded-lg px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                            style={{ background: "var(--acento)" }}
                          >
                            {ocupado === c.id ? "Guardando…" : "Guardar"}
                          </button>
                          <button
                            onClick={() => setEditando(null)}
                            disabled={ocupado === c.id}
                            className="rounded-lg border px-2 py-1 text-xs font-medium"
                            style={{ borderColor: "var(--borde)" }}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => abrirEdicion(c)}
                            className="rounded-lg border px-2 py-1 text-xs font-medium"
                            style={{ borderColor: "var(--borde)" }}
                          >
                            Editar
                          </button>
                          <a
                            href={`/api/contenedores/${c.id}/packing-list`}
                            className="rounded-lg border px-2 py-1 text-xs font-medium"
                            style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
                          >
                            Packing list
                          </a>
                          {c.estado !== "recibido" ? (
                            <button
                              onClick={() => confirmarLlegada(c)}
                              disabled={ocupado === c.id}
                              className="rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50"
                              style={{
                                borderColor: "var(--exito-texto)",
                                color: "var(--exito-texto)",
                              }}
                            >
                              {ocupado === c.id ? "…" : "Llegó"}
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
