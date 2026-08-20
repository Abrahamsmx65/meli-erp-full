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

  if (!pedidos.length) {
    return (
      <section className="tarjeta p-6 text-center">
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          Todavía no hay pedidos cargados. Sube una proforma arriba y aparecerá aquí
          con sus corridas ya dadas de alta.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-3 hairline">
          <h2 className="text-sm font-semibold">Pedidos cargados</h2>
        </header>

        <div className="overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fecha PI</th>
                <th className="num">Modelos</th>
                <th className="num">Cajas</th>
                <th className="num">Pares</th>
                <th className="num">Sin barco</th>
                <th>Contenedores</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => {
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
                    <td className="cifra text-sm">{fecha(p.fechaPi)}</td>
                    <td className="num cifra">{n(p.modelos)}</td>
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
                        {/* ZIP con las etiquetas MELI + Amazon de cada modelo/color,
                            el Excel de códigos y las etiquetas de cartón (CTNS LABELS). */}
                        <a
                          href={`/api/pedidos/${p.id}/etiquetas`}
                          className="rounded-lg border px-2 py-1 text-xs font-medium"
                          style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
                        >
                          Etiquetas
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
    </>
  );
}

/* -------------------------------------------------------------------------- */

interface LineaPedido {
  id: string;
  modelo: string;
  color: string;
  cajas: number;
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
  const [numero, setNumero] = useState("");
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
        // Por defecto se embarca todo lo que falta: es lo normal.
        const inicial: Record<string, number> = {};
        for (const l of ls) inicial[l.id] = Math.max(0, l.cajas - l.yaAsignadas);
        setCantidades(inicial);
      })
      .catch(() => {
        if (vivo) setLineas([]);
      });
    return () => {
      vivo = false;
    };
  }, [pedido.id]);

  const total = Object.values(cantidades).reduce((a, b) => a + (Number(b) || 0), 0);

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
          <Campo etiqueta="Número de contenedor">
            <input
              value={numero}
              onChange={(e) => setNumero(e.target.value.toUpperCase())}
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

        <div className="mt-4 max-h-72 overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Color</th>
                <th className="num">Cajas del pedido</th>
                <th className="num">Ya embarcadas</th>
                <th className="num">En este contenedor</th>
              </tr>
            </thead>
            <tbody>
              {(lineas ?? []).map((l) => {
                const tope = Math.max(0, l.cajas - l.yaAsignadas);
                return (
                  <tr key={l.id}>
                    <td className="font-medium">{l.modelo}</td>
                    <td>{l.color}</td>
                    <td className="num cifra">{n(l.cajas)}</td>
                    <td className="num cifra">{l.yaAsignadas ? n(l.yaAsignadas) : "—"}</td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        max={tope}
                        value={cantidades[l.id] ?? 0}
                        onChange={(e) =>
                          setCantidades((c) => ({
                            ...c,
                            [l.id]: Math.max(0, Math.min(tope, Number(e.target.value) || 0)),
                          }))
                        }
                        className="cifra w-20 rounded-lg border px-2 py-1 text-right text-sm"
                        style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                      />
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
