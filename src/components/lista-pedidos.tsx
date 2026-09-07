"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Contenedor {
  numero: string;
  estado: string;
  llegadaEst: string | null;
  cajas: number;
}

interface Pedido {
  id: string;
  pedido: string;
  proveedor: string | null;
  fechaPi: string | null;
  estado: string;
  cajas: number;
  pares: number;
  modelos: number;
  modelosLista: string[];
  cajasAsignadas: number;
  contenedores: Contenedor[];
  creadoEn: string;
}

const ETIQUETA_ESTADO: Record<string, { texto: string; color: string }> = {
  creado: { texto: "Sin embarcar", color: "var(--ink-muted)" },
  con_contenedor: { texto: "Parcialmente embarcado", color: "var(--estado-alerta)" },
  en_transito: { texto: "En tránsito", color: "var(--acento)" },
  recibido: { texto: "Recibido", color: "var(--exito-texto)" },
  cancelado: { texto: "Cancelado", color: "var(--estado-critico)" },
};

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function fecha(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

/**
 * Los pedidos vivos y en qué contenedor viene cada uno.
 *
 * Un pedido puede irse partido en varios contenedores y un contenedor puede
 * traer pedazos de varios pedidos, así que lo que se muestra no es "pedido →
 * contenedor" sino cuántas de sus cajas ya tienen barco y cuántas siguen
 * esperando. Ese resto es el dato que de verdad se persigue.
 */
export function ListaPedidos({ pedidos }: { pedidos: Pedido[] }) {
  const router = useRouter();
  const [asignando, setAsignando] = useState<Pedido | null>(null);
  const [editando, setEditando] = useState<Pedido | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [soloEstado, setSoloEstado] = useState("");

  // Filtro por modelo, número de pedido o número de contenedor: cada palabra
  // tiene que aparecer en alguno de los tres.
  const palabras = busqueda.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const visibles = pedidos.filter((p) => {
    if (soloEstado === "vivos" && (p.estado === "recibido" || p.estado === "cancelado")) return false;
    if (soloEstado && soloEstado !== "vivos" && p.estado !== soloEstado) return false;
    if (!palabras.length) return true;
    const texto = [p.pedido, p.proveedor ?? "", ...p.modelosLista, ...p.contenedores.map((c) => c.numero)]
      .join(" ")
      .toUpperCase();
    return palabras.every((w) => texto.includes(w));
  });

  async function eliminar(p: Pedido) {
    const seguro = window.confirm(
      `¿Borrar el pedido ${p.pedido} (${n(p.cajas)} cajas, ${n(p.pares)} pares)? ` +
        "Se quitan sus renglones y deja de contar como en camino. Las corridas se quedan.",
    );
    if (!seguro) return;
    setBorrando(p.id);
    try {
      const r = await fetch(`/api/pedidos?id=${p.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo borrar.");
      router.refresh();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBorrando(null);
    }
  }

  if (!pedidos.length) {
    return (
      <section className="tarjeta p-6 text-center">
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          Todavía no hay pedidos cargados. Sube una proforma en Cargar pedidos y
          aparecerá aquí con sus corridas ya dadas de alta.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b p-3 hairline">
          <h2 className="text-sm font-semibold">
            Pedidos cargados
            <span className="ml-2 cifra font-normal" style={{ color: "var(--ink-muted)" }}>
              {visibles.length === pedidos.length ? pedidos.length : `${visibles.length} de ${pedidos.length}`}
            </span>
          </h2>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por modelo, pedido o contenedor…"
            className="min-w-64 flex-1 rounded-lg border px-3 py-1.5 text-sm md:max-w-md"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            aria-label="Filtrar pedidos"
          />
          <select
            value={soloEstado}
            onChange={(e) => setSoloEstado(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            <option value="vivos">Solo vivos</option>
            <option value="creado">Sin embarcar</option>
            <option value="con_contenedor">Parcialmente embarcados</option>
            <option value="en_transito">En tránsito</option>
            <option value="recibido">Recibidos</option>
            <option value="cancelado">Cancelados</option>
          </select>
        </header>

        <div className="overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Modelos</th>
                <th className="num">Cajas</th>
                <th className="num">Pares</th>
                <th className="num">Sin barco</th>
                <th>Contenedores</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => {
                const pendientes = Math.max(0, p.cajas - p.cajasAsignadas);
                const e = ETIQUETA_ESTADO[p.estado] ?? ETIQUETA_ESTADO.creado;
                return (
                  <tr key={p.id}>
                    <td className="font-medium">
                      {p.pedido}
                      {p.proveedor ? (
                        <div
                          className="max-w-56 truncate text-[11px]"
                          style={{ color: "var(--ink-muted)" }}
                          title={p.proveedor}
                        >
                          {p.proveedor}
                        </div>
                      ) : null}
                    </td>
                    <td className="max-w-64 text-xs" title={p.modelosLista.join(", ")}>
                      {p.modelosLista.length ? p.modelosLista.join(", ") : "—"}
                    </td>
                    <td className="num cifra">{n(p.cajas)}</td>
                    <td className="num cifra">{n(p.pares)}</td>
                    <td
                      className="num cifra font-medium"
                      style={{ color: pendientes ? "var(--estado-alerta)" : "var(--ink-muted)" }}
                    >
                      {pendientes ? n(pendientes) : "—"}
                    </td>
                    <td className="text-xs">
                      {p.contenedores.length ? (
                        p.contenedores.map((c) => (
                          <div key={c.numero}>
                            <span className="font-medium">{c.numero}</span>{" "}
                            <span style={{ color: "var(--ink-2)" }}>
                              {n(c.cajas)} cajas
                              {c.llegadaEst ? ` · llega ${fecha(c.llegadaEst)}` : ""}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span style={{ color: "var(--ink-muted)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          background: `color-mix(in oklab, ${e.color} 15%, transparent)`,
                          color: e.color,
                        }}
                      >
                        {e.texto}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setAsignando(p)}
                          className="rounded-lg border px-2 py-1 text-xs font-medium"
                          style={{ borderColor: "var(--borde)" }}
                        >
                          Contenedor
                        </button>
                        <button
                          onClick={() => setEditando(p)}
                          className="rounded-lg border px-2 py-1 text-xs font-medium"
                          style={{ borderColor: "var(--borde)" }}
                        >
                          Renglones
                        </button>
                        {/* ZIP con las etiquetas MELI + Amazon de cada modelo/color,
                            el Excel de códigos y las etiquetas de cartón (CTNS LABELS). */}
                        <a
                          href={`/api/pedidos/${p.id}/etiquetas`}
                          className="rounded-lg border px-2 py-1 text-xs font-medium"
                          style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
                        >
                          Etiquetas
                        </a>
                        <button
                          onClick={() => eliminar(p)}
                          disabled={borrando === p.id}
                          className="rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50"
                          style={{ borderColor: "var(--estado-critico)", color: "var(--estado-critico)" }}
                        >
                          {borrando === p.id ? "Borrando…" : "Borrar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visibles.length ? (
            <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
              Ningún pedido coincide con la búsqueda.
            </p>
          ) : null}
        </div>
      </section>

      {asignando ? (
        <AsignarContenedor
          pedido={asignando}
          onCerrar={() => setAsignando(null)}
          onGuardado={() => {
            setAsignando(null);
            router.refresh();
          }}
        />
      ) : null}

      {editando ? (
        <EditarRenglones
          pedido={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

interface LineaPedido {
  id: string;
  modelo: string;
  color: string;
  /** vacía en renglones de corrida; la talla en cajas de una sola talla */
  talla: string | null;
  cajas: number;
  paresPorCaja: number;
  yaAsignadas: number;
}

function AsignarContenedor({
  pedido,
  onCerrar,
  onGuardado,
}: {
  pedido: Pedido;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [lineas, setLineas] = useState<LineaPedido[] | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [busqueda, setBusqueda] = useState("");
  const [numero, setNumero] = useState("");
  const [numeroNaviera, setNumeroNaviera] = useState("");
  const [naviera, setNaviera] = useState("");
  const [salida, setSalida] = useState("");
  const [llegada, setLlegada] = useState("");
  const [estado, setEstado] = useState("en_transito");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Se cargan los renglones al abrir; no se traen antes porque un pedido de
  // 40 modelos multiplicado por todos los pedidos de la lista sería mucho
  // dato para algo que casi nunca se abre.
  useEffect(() => {
    let vivo = true;
    fetch(`/api/pedidos/${pedido.id}/lineas`)
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        const ls: LineaPedido[] = j.lineas ?? [];
        setLineas(ls);
        // Se arranca en CERO: un pedido de 100 SKUs repartido en 8
        // contenedores obligaba a borrar a mano todo lo que no iba en este.
        // El botón "Todo lo pendiente" recupera el atajo del caso simple.
        const inicial: Record<string, number> = {};
        for (const l of ls) inicial[l.id] = 0;
        setCantidades(inicial);
      })
      .catch(() => {
        if (vivo) setLineas([]);
      });
    return () => {
      vivo = false;
    };
  }, [pedido.id]);

  const filtro = busqueda.trim().toUpperCase();
  const visibles = (lineas ?? []).filter(
    (l) => !filtro || `${l.modelo} ${l.color} ${l.talla ?? ""}`.toUpperCase().includes(filtro),
  );

  const total = Object.values(cantidades).reduce((a, b) => a + (Number(b) || 0), 0);

  /** Pone todos los renglones VISIBLES en su pendiente (o en cero). */
  function marcarVisibles(todo: boolean) {
    setCantidades((c) => {
      const nuevo = { ...c };
      for (const l of visibles) {
        nuevo[l.id] = todo ? Math.max(0, l.cajas - l.yaAsignadas) : 0;
      }
      return nuevo;
    });
  }

  async function guardar() {
    if (!numero.trim()) {
      setError("Falta el número de contenedor.");
      return;
    }
    setGuardando(true);
    setError(null);

    try {
      const r = await fetch("/api/contenedores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero,
          numeroNaviera: numeroNaviera || null,
          naviera: naviera || null,
          fechaSalida: salida || null,
          fechaLlegadaEst: llegada || null,
          estado,
          lineas: Object.entries(cantidades)
            .filter(([, c]) => Number(c) > 0)
            .map(([pedidoLineaId, cajas]) => ({ pedidoLineaId, cajas: Number(cajas) })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
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
      aria-label={`Asignar contenedor al pedido ${pedido.pedido}`}
    >
      <div className="tarjeta my-8 w-full max-w-3xl p-5" style={{ background: "var(--surface-1)" }}>
        <h3 className="text-lg font-semibold">Contenedor del pedido {pedido.pedido}</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Pon el número de contenedor y cuántas cajas de cada modelo se van en él. Si el
          pedido se parte, repite esto con el segundo contenedor: lo que quede sin
          asignar sigue contando como pendiente de embarcar.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Campo etiqueta="Nuestro ID del contenedor">
            <input
              value={numero}
              onChange={(e) => setNumero(e.target.value.toUpperCase())}
              placeholder="C-2026-01"
              className="w-full rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            />
          </Campo>
          <Campo etiqueta="Núm. de la naviera (opcional)">
            <input
              value={numeroNaviera}
              onChange={(e) => setNumeroNaviera(e.target.value.toUpperCase())}
              placeholder="MSKU1234567"
              className="w-full rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            />
          </Campo>
          <Campo etiqueta="Naviera (opcional)">
            <input
              value={naviera}
              onChange={(e) => setNaviera(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            />
          </Campo>
          <Campo etiqueta="Estado">
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            >
              <option value="en_transito">En tránsito</option>
              <option value="en_aduana">En aduana</option>
              <option value="recibido">Recibido</option>
            </select>
          </Campo>
          <Campo etiqueta="Salida">
            <input
              type="date"
              value={salida}
              onChange={(e) => setSalida(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            />
          </Campo>
          <Campo etiqueta="Llegada estimada">
            <input
              type="date"
              value={llegada}
              onChange={(e) => setLlegada(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            />
          </Campo>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar modelo, color o talla…"
            className="min-w-48 flex-1 rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          />
          <button
            onClick={() => marcarVisibles(true)}
            className="rounded-lg border px-2.5 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--borde)" }}
            title="Los renglones visibles quedan con todo su pendiente"
          >
            Todo lo pendiente{filtro ? " (filtrados)" : ""}
          </button>
          <button
            onClick={() => marcarVisibles(false)}
            className="rounded-lg border px-2.5 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--borde)" }}
          >
            Nada
          </button>
        </div>

        <div className="mt-2 max-h-72 overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Color</th>
                <th>Talla</th>
                <th className="num">Cajas del pedido</th>
                <th className="num">Ya embarcadas</th>
                <th className="num">En este contenedor</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((l) => {
                const tope = Math.max(0, l.cajas - l.yaAsignadas);
                const valor = cantidades[l.id] ?? 0;
                return (
                  <tr key={l.id}>
                    <td className="font-medium">{l.modelo}</td>
                    <td>{l.color}</td>
                    <td className="cifra">
                      {l.talla || <span style={{ color: "var(--ink-muted)" }}>corrida</span>}
                    </td>
                    <td className="num cifra">{n(l.cajas)}</td>
                    <td className="num cifra">{l.yaAsignadas ? n(l.yaAsignadas) : "—"}</td>
                    <td className="num">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setCantidades((c) => ({ ...c, [l.id]: valor > 0 ? 0 : tope }))}
                          className="rounded border px-1.5 py-0.5 text-[11px]"
                          style={{ borderColor: "var(--borde)", color: "var(--ink-2)" }}
                          title={valor > 0 ? "Quitar de este contenedor" : `Poner el pendiente (${tope})`}
                        >
                          {valor > 0 ? "0" : "todo"}
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={tope}
                          value={valor}
                          onChange={(e) =>
                            setCantidades((c) => ({
                              ...c,
                              [l.id]: Math.max(0, Math.min(tope, Number(e.target.value) || 0)),
                            }))
                          }
                          className="cifra w-20 rounded-lg border px-2 py-1 text-right text-sm"
                          style={{
                            borderColor: valor > 0 ? "var(--acento)" : "var(--borde)",
                            background: "var(--surface-2)",
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lineas === null ? (
            <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
              Cargando renglones…
            </p>
          ) : null}
          {lineas !== null && !visibles.length ? (
            <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
              Ningún renglón coincide con la búsqueda.
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm" style={{ color: "var(--ink-2)" }}>
            Se van <strong className="cifra">{n(total)}</strong> cajas en este contenedor.
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
              disabled={guardando || !numero.trim()}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--acento)" }}
            >
              {guardando ? "Guardando…" : "Guardar contenedor"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <span className="block text-xs" style={{ color: "var(--ink-2)" }}>
        {etiqueta}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Corrección de los RENGLONES del pedido: si una parte ya no se fabricó, se
 * bajan sus cajas (los pares se recalculan solos) o se quita el renglón. El
 * piso siempre es lo ya embarcado en contenedores: eso se corrige primero
 * en la sección Contenedores.
 */
function EditarRenglones({
  pedido,
  onCerrar,
  onGuardado,
}: {
  pedido: Pedido;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [lineas, setLineas] = useState<LineaPedido[] | null>(null);
  const [cajas, setCajas] = useState<Record<string, number>>({});
  const [quitar, setQuitar] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/pedidos/${pedido.id}/lineas`)
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        const ls: LineaPedido[] = j.lineas ?? [];
        setLineas(ls);
        const inicial: Record<string, number> = {};
        for (const l of ls) inicial[l.id] = l.cajas;
        setCajas(inicial);
      })
      .catch(() => {
        if (vivo) setLineas([]);
      });
    return () => {
      vivo = false;
    };
  }, [pedido.id]);

  const filtro = busqueda.trim().toUpperCase();
  const visibles = (lineas ?? []).filter(
    (l) => !filtro || `${l.modelo} ${l.color} ${l.talla ?? ""}`.toUpperCase().includes(filtro),
  );

  async function guardar() {
    if (!lineas) return;
    setGuardando(true);
    setError(null);
    try {
      // Primero las bajas de cajas, luego los renglones que se quitan; en
      // serie para que un error diga exactamente en qué renglón se detuvo.
      for (const l of lineas) {
        if (quitar.has(l.id)) continue;
        const nuevas = cajas[l.id] ?? l.cajas;
        if (nuevas === l.cajas) continue;
        const r = await fetch(`/api/pedidos/${pedido.id}/lineas`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineaId: l.id, cajas: nuevas }),
        });
        const j = await r.json();
        if (!r.ok) {
          throw new Error(`${l.modelo} ${l.color}${l.talla ? ` T${l.talla}` : ""}: ${j.error}`);
        }
      }
      for (const l of lineas) {
        if (!quitar.has(l.id)) continue;
        const r = await fetch(`/api/pedidos/${pedido.id}/lineas?linea=${l.id}`, {
          method: "DELETE",
        });
        const j = await r.json();
        if (!r.ok) {
          throw new Error(`${l.modelo} ${l.color}${l.talla ? ` T${l.talla}` : ""}: ${j.error}`);
        }
      }
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const hayCambios =
    quitar.size > 0 ||
    (lineas ?? []).some((l) => !quitar.has(l.id) && (cajas[l.id] ?? l.cajas) !== l.cajas);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: "rgba(0,0,0,.45)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Renglones del pedido ${pedido.pedido}`}
    >
      <div className="tarjeta my-8 w-full max-w-3xl p-5" style={{ background: "var(--surface-1)" }}>
        <h3 className="text-lg font-semibold">Renglones del pedido {pedido.pedido}</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Si una parte ya no se fabricó, baja sus cajas o quita el renglón: los pares se
          recalculan solos y deja de contar como en camino. No se puede bajar de lo ya
          embarcado en contenedores; eso se corrige primero en{" "}
          <strong>Contenedores → Contenido</strong>. Las corridas no se tocan.
        </p>

        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar modelo, color o talla…"
          className="mt-3 w-full rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
        />

        <div className="mt-3 max-h-96 overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Color</th>
                <th>Talla</th>
                <th className="num">Embarcadas</th>
                <th className="num">Cajas</th>
                <th className="num">Pares</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((l) => {
                const marcada = quitar.has(l.id);
                const valor = cajas[l.id] ?? l.cajas;
                return (
                  <tr key={l.id} style={marcada ? { opacity: 0.5 } : undefined}>
                    <td
                      className="font-medium"
                      style={marcada ? { textDecoration: "line-through" } : undefined}
                    >
                      {l.modelo}
                    </td>
                    <td style={marcada ? { textDecoration: "line-through" } : undefined}>
                      {l.color}
                    </td>
                    <td className="cifra">
                      {l.talla || <span style={{ color: "var(--ink-muted)" }}>corrida</span>}
                    </td>
                    <td className="num cifra">{l.yaAsignadas ? n(l.yaAsignadas) : "—"}</td>
                    <td className="num">
                      <input
                        type="number"
                        min={l.yaAsignadas}
                        value={valor}
                        disabled={marcada}
                        onChange={(e) =>
                          setCajas((c) => ({
                            ...c,
                            [l.id]: Math.max(l.yaAsignadas, Number(e.target.value) || 0),
                          }))
                        }
                        className="cifra w-20 rounded-lg border px-2 py-1 text-right text-sm disabled:opacity-50"
                        style={{
                          borderColor: valor !== l.cajas ? "var(--acento)" : "var(--borde)",
                          background: "var(--surface-2)",
                        }}
                      />
                    </td>
                    <td className="num cifra">{n(valor * l.paresPorCaja)}</td>
                    <td>
                      <button
                        onClick={() =>
                          setQuitar((s) => {
                            const nuevo = new Set(s);
                            if (nuevo.has(l.id)) nuevo.delete(l.id);
                            else nuevo.add(l.id);
                            return nuevo;
                          })
                        }
                        disabled={l.yaAsignadas > 0}
                        title={
                          l.yaAsignadas > 0
                            ? "Tiene cajas embarcadas: quítalas primero del contenedor"
                            : marcada
                              ? "Conservar el renglón"
                              : "Quitar el renglón (ya no se surte)"
                        }
                        className="rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-40"
                        style={{
                          borderColor: marcada ? "var(--borde)" : "var(--estado-critico)",
                          color: marcada ? "var(--ink-2)" : "var(--estado-critico)",
                        }}
                      >
                        {marcada ? "Conservar" : "Quitar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lineas === null ? (
            <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
              Cargando renglones…
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          {quitar.size > 0 ? (
            <span className="text-sm" style={{ color: "var(--estado-critico)" }}>
              Se van a quitar {quitar.size} renglones.
            </span>
          ) : null}
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
              disabled={guardando || !hayCambios}
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
