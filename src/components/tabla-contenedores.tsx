"use client";

import { useEffect, useState } from "react";
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
  modelos: { modelo: string; color: string; cajas: number; pares: number }[];
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
  const [contenido, setContenido] = useState<Contenedor | null>(null);
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
              <th>Qué viene</th>
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
                    {c.modelos.length ? (
                      <>
                        {c.modelos.map((m) => (
                          <div key={`${m.modelo}|${m.color}`}>
                            <span className="font-medium">{m.modelo}</span>
                            {m.color ? <span style={{ color: "var(--ink-2)" }}> {m.color}</span> : null}{" "}
                            <span className="cifra" style={{ color: "var(--ink-2)" }}>
                              {n(m.cajas)} cajas{m.pares > 0 ? ` · ${n(m.pares)} pares` : ""}
                            </span>
                          </div>
                        ))}
                        {c.pedidos.length ? (
                          <div className="mt-1 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                            {c.pedidos.map((p) => `${p.pedido} (${n(p.cajas)})`).join(" · ")}
                          </div>
                        ) : null}
                      </>
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
                          <button
                            onClick={() => setContenido(c)}
                            className="rounded-lg border px-2 py-1 text-xs font-medium"
                            style={{ borderColor: "var(--borde)" }}
                          >
                            Contenido
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

      {contenido ? (
        <ContenidoContenedor
          contenedor={contenido}
          onCerrar={() => setContenido(null)}
          onGuardado={() => {
            setContenido(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

interface LineaContenido {
  pedidoLineaId: string;
  pedido: string;
  modelo: string;
  color: string;
  talla: string | null;
  cajasPedido: number;
  paresPorCaja: number;
  enEste: number;
  enOtros: number;
}

/**
 * Edición de lo EMBARCADO en un contenedor: corrige cajas mal capturadas
 * (0 = quitar el renglón) y permite agregar renglones de los mismos pedidos
 * que faltaban. Nunca deja pasar del pedido menos lo de otros contenedores.
 */
function ContenidoContenedor({
  contenedor,
  onCerrar,
  onGuardado,
}: {
  contenedor: Contenedor;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [lineas, setLineas] = useState<LineaContenido[] | null>(null);
  const [cajas, setCajas] = useState<Record<string, number>>({});
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/contenedores/${contenedor.id}/lineas`)
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        const ls: LineaContenido[] = j.lineas ?? [];
        setLineas(ls);
        const inicial: Record<string, number> = {};
        for (const l of ls) inicial[l.pedidoLineaId] = l.enEste;
        setCajas(inicial);
      })
      .catch(() => {
        if (vivo) setLineas([]);
      });
    return () => {
      vivo = false;
    };
  }, [contenedor.id]);

  const filtro = busqueda.trim().toUpperCase();
  const visibles = (lineas ?? []).filter(
    (l) =>
      !filtro ||
      `${l.pedido} ${l.modelo} ${l.color} ${l.talla ?? ""}`.toUpperCase().includes(filtro),
  );
  const totalCajas = Object.values(cajas).reduce((a, b) => a + (Number(b) || 0), 0);

  async function guardar() {
    if (!lineas) return;
    setGuardando(true);
    setError(null);
    try {
      const cambios = lineas
        .filter((l) => (cajas[l.pedidoLineaId] ?? l.enEste) !== l.enEste)
        .map((l) => ({ pedidoLineaId: l.pedidoLineaId, cajas: cajas[l.pedidoLineaId] ?? 0 }));
      if (!cambios.length) {
        onCerrar();
        return;
      }
      const r = await fetch(`/api/contenedores/${contenedor.id}/lineas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cambios }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      if (Array.isArray(j.recortes) && j.recortes.length) {
        setAvisos(j.recortes);
      }
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: "rgba(0,0,0,.45)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Contenido del contenedor ${contenedor.numero}`}
    >
      <div className="tarjeta my-8 w-full max-w-3xl p-5" style={{ background: "var(--surface-1)" }}>
        <h3 className="text-lg font-semibold">Contenido de {contenedor.numero}</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Corrige las cajas de cada renglón si algo se capturó mal. Pon <strong>0</strong>{" "}
          para quitarlo del contenedor. También puedes agregar renglones de los mismos
          pedidos que no se habían embarcado.
        </p>

        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar modelo, color, talla o pedido…"
          className="mt-3 w-full rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
        />

        <div className="mt-3 max-h-96 overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Modelo</th>
                <th>Color</th>
                <th>Talla</th>
                <th className="num">Del pedido</th>
                <th className="num">En otros</th>
                <th className="num">En este</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((l) => {
                const tope = Math.max(0, l.cajasPedido - l.enOtros);
                const valor = cajas[l.pedidoLineaId] ?? l.enEste;
                return (
                  <tr key={l.pedidoLineaId}>
                    <td className="text-xs">{l.pedido}</td>
                    <td className="font-medium">{l.modelo}</td>
                    <td>{l.color}</td>
                    <td className="cifra">
                      {l.talla || <span style={{ color: "var(--ink-muted)" }}>corrida</span>}
                    </td>
                    <td className="num cifra">{l.cajasPedido}</td>
                    <td className="num cifra">{l.enOtros || "—"}</td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        max={tope}
                        value={valor}
                        onChange={(e) =>
                          setCajas((c2) => ({
                            ...c2,
                            [l.pedidoLineaId]: Math.max(
                              0,
                              Math.min(tope, Number(e.target.value) || 0),
                            ),
                          }))
                        }
                        className="cifra w-20 rounded-lg border px-2 py-1 text-right text-sm"
                        style={{
                          borderColor: valor !== l.enEste ? "var(--acento)" : "var(--borde)",
                          background: "var(--surface-2)",
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lineas === null ? (
            <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
              Cargando contenido…
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
            {error}
          </p>
        ) : null}
        {avisos.map((a, i) => (
          <p key={i} className="mt-1 text-xs" style={{ color: "var(--estado-alerta)" }}>
            {a}
          </p>
        ))}

        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm" style={{ color: "var(--ink-2)" }}>
            Quedan <strong className="cifra">{n(totalCajas)}</strong> cajas en este
            contenedor.
          </span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={onCerrar}
              disabled={guardando}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "var(--borde)" }}
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={guardando || lineas === null}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--acento)" }}
            >
              {guardando ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
