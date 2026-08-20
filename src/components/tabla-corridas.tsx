"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface Corrida {
  pedido: string;
  modelo: string;
  color: string;
  tallas: Record<string, number>;
  total: number;
  origen: string;
  actualizadoEn: string | null;
  cajasEnBodega: number;
  paresEnBodega: number;
  almacenes: string[];
}

interface Hueco {
  pedido: string;
  modelo: string;
  color: string;
  cajas: number;
  almacenes: string[];
  tallasVistas: string[];
  paresPorCaja: number;
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Las corridas que hay, y las que faltan.
 *
 * Las que faltan van primero aunque sean menos: una corrida que ya está no
 * pide nada, mientras que cada hueco es un montón de cajas paradas en bodega
 * que el planeador no puede tocar.
 */
export function TablaCorridas({
  corridas,
  huecos,
  tallas,
}: {
  corridas: Corrida[];
  huecos: Hueco[];
  tallas: string[];
}) {
  const [busqueda, setBusqueda] = useState("");
  const [soloConCajas, setSoloConCajas] = useState(false);
  const [capturando, setCapturando] = useState<{
    hueco: Hueco;
    inicial?: Record<string, number>;
  } | null>(null);

  // Editar = el mismo capturador, con las tallas actuales precargadas.
  const editar = (c: Corrida) =>
    setCapturando({
      hueco: {
        pedido: c.pedido,
        modelo: c.modelo,
        color: c.color,
        cajas: c.cajasEnBodega,
        almacenes: c.almacenes,
        tallasVistas: Object.keys(c.tallas),
        paresPorCaja: 0,
      },
      inicial: c.tallas,
    });

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return corridas.filter((c) => {
      if (soloConCajas && c.cajasEnBodega === 0) return false;
      if (!q) return true;
      return `${c.modelo} ${c.color} ${c.pedido}`.toUpperCase().includes(q);
    });
  }, [corridas, busqueda, soloConCajas]);

  const visibles = filtradas.slice(0, 500);

  return (
    <div className="flex flex-col gap-6">
      {huecos.length ? (
        <section className="tarjeta overflow-hidden">
          <header
            className="border-b p-3 hairline"
            style={{ background: "color-mix(in oklab, var(--estado-alerta) 8%, transparent)" }}
          >
            <h2 className="text-sm font-semibold">
              Cajas que no sé qué traen adentro
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
              Hay {n(huecos.reduce((a, h) => a + h.cajas, 0))} cajas en bodega de{" "}
              {huecos.length} modelos sin corrida cargada. El planeador no las puede
              mandar a Full porque no sabe qué tallas hay dentro. Captura la corrida y
              entran al siguiente cálculo.
            </p>
          </header>

          <div className="max-h-72 overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Modelo</th>
                  <th>Color</th>
                  <th className="num">Cajas</th>
                  <th className="num">Pares/caja</th>
                  <th>Almacenes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {huecos.slice(0, 200).map((h) => (
                  <tr key={`${h.pedido}|${h.modelo}|${h.color}`}>
                    <td className="font-medium">{h.pedido || "—"}</td>
                    <td>{h.modelo}</td>
                    <td>{h.color || "—"}</td>
                    <td className="num cifra">{n(h.cajas)}</td>
                    <td className="num cifra">{h.paresPorCaja || "?"}</td>
                    <td className="text-xs" style={{ color: "var(--ink-2)" }}>
                      {h.almacenes.join(", ")}
                    </td>
                    <td>
                      <button
                        onClick={() => setCapturando({ hueco: h })}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-white"
                        style={{ background: "var(--acento)" }}
                      >
                        Capturar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b p-3 hairline">
          <h2 className="text-sm font-semibold">Corridas cargadas</h2>

          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar modelo, color o pedido…"
            className="rounded-lg border px-2 py-1 text-sm"
            style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          />

          <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--ink-2)" }}>
            <input
              type="checkbox"
              checked={soloConCajas}
              onChange={(e) => setSoloConCajas(e.target.checked)}
            />
            Solo las que tienen cajas hoy
          </label>

          <div className="ml-auto text-sm" style={{ color: "var(--ink-2)" }}>
            {visibles.length < filtradas.length
              ? `${visibles.length} de ${filtradas.length}`
              : `${filtradas.length} corridas`}
          </div>
        </header>

        <div className="max-h-[36rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Modelo</th>
                <th>Color</th>
                {tallas.map((t) => (
                  <th key={t} className="num">
                    {t}
                  </th>
                ))}
                <th className="num">Pares/caja</th>
                <th className="num">Cajas hoy</th>
                <th>Origen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => (
                <tr key={`${c.pedido}|${c.modelo}|${c.color}`}>
                  <td className="font-medium">{c.pedido || "—"}</td>
                  <td>{c.modelo}</td>
                  <td>{c.color || "—"}</td>
                  {tallas.map((t) => (
                    <td key={t} className="num cifra">
                      {c.tallas[t] ? (
                        c.tallas[t]
                      ) : (
                        <span style={{ color: "var(--ink-muted)" }}>·</span>
                      )}
                    </td>
                  ))}
                  <td className="num cifra font-medium">{c.total}</td>
                  <td
                    className="num cifra"
                    style={{ color: c.cajasEnBodega ? "var(--ink-1)" : "var(--ink-muted)" }}
                  >
                    {c.cajasEnBodega ? n(c.cajasEnBodega) : "—"}
                  </td>
                  <td className="text-xs">
                    <span
                      className="rounded-full px-2 py-0.5"
                      style={{
                        background:
                          c.origen === "proforma"
                            ? "color-mix(in oklab, var(--exito-texto) 15%, transparent)"
                            : "var(--surface-2)",
                        color: c.origen === "proforma" ? "var(--exito-texto)" : "var(--ink-2)",
                      }}
                    >
                      {c.origen === "proforma" ? "de la proforma" : c.origen}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => editar(c)}
                      className="rounded-lg border px-2 py-1 text-xs font-medium"
                      style={{ borderColor: "var(--borde)" }}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!visibles.length ? (
          <p className="p-6 text-center text-sm" style={{ color: "var(--ink-2)" }}>
            Ninguna corrida coincide con la búsqueda.
          </p>
        ) : null}
      </section>

      {capturando ? (
        <CapturarCorrida
          hueco={capturando.hueco}
          inicial={capturando.inicial}
          onCerrar={() => setCapturando(null)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const TALLAS_SUGERIDAS = ["22", "23", "24", "25", "26", "27", "28", "29", "30", "31"];

function CapturarCorrida({
  hueco,
  inicial,
  onCerrar,
}: {
  hueco: Hueco;
  /** tallas actuales, cuando se está editando una corrida ya cargada */
  inicial?: Record<string, number>;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(inicial ?? {}).map(([t, v]) => [t, String(v)])),
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editando = Boolean(inicial);

  // Si el reporte de existencias ya mencionó tallas para este modelo, esas van
  // primero: es más probable que la caja las traiga.
  const tallas = [...new Set([...hueco.tallasVistas.filter((t) => /^\d/.test(t)), ...TALLAS_SUGERIDAS])];

  const total = Object.values(valores).reduce((a, v) => a + (Number(v) || 0), 0);
  const cuadra = hueco.paresPorCaja === 0 || total === hueco.paresPorCaja;

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const tallasNum: Record<string, number> = {};
      for (const [t, v] of Object.entries(valores)) {
        const x = Number(v);
        if (x > 0) tallasNum[t] = Math.round(x);
      }

      const r = await fetch("/api/corrida", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pedido: hueco.pedido,
          modelo: hueco.modelo,
          color: hueco.color,
          tallas: tallasNum,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar.");
      onCerrar();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,.45)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Capturar corrida"
    >
      <div className="tarjeta w-full max-w-2xl p-5" style={{ background: "var(--surface-1)" }}>
        <h3 className="text-lg font-semibold">
          {editando ? "Editar corrida de" : "Corrida de"} {hueco.modelo} {hueco.color}
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Pedido {hueco.pedido || "sin pedido"} · {n(hueco.cajas)} cajas en{" "}
          {hueco.almacenes.join(", ")}
          {hueco.paresPorCaja ? ` · el reporte dice ${hueco.paresPorCaja} pares por caja` : ""}
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          {editando
            ? "Ajusta los pares por talla y guarda. El plan se recalcula solo con la corrida nueva."
            : "Abre una caja de este modelo y anota cuántos pares hay de cada talla. Es lo único que se captura a mano; los pedidos nuevos traen su corrida en la proforma."}
        </p>

        <div className="mt-4 grid grid-cols-4 gap-2 md:grid-cols-6">
          {tallas.map((t) => (
            <label key={t} className="text-sm">
              <span className="block text-xs" style={{ color: "var(--ink-2)" }}>
                Talla {t}
              </span>
              <input
                type="number"
                min={0}
                value={valores[t] ?? ""}
                onChange={(e) => setValores((v) => ({ ...v, [t]: e.target.value }))}
                className="cifra mt-1 w-full rounded-lg border px-2 py-1.5 text-right text-sm"
                style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
              />
            </label>
          ))}
        </div>

        <p
          className="mt-3 text-sm"
          style={{ color: cuadra ? "var(--ink-2)" : "var(--estado-alerta)" }}
        >
          Suman <strong className="cifra">{total}</strong> pares por caja
          {hueco.paresPorCaja
            ? cuadra
              ? " — cuadra con el reporte."
              : ` — el reporte dice ${hueco.paresPorCaja}. Revisa antes de guardar; si guardas así, manda la corrida.`
            : "."}
        </p>

        {error ? (
          <p className="mt-2 text-sm" style={{ color: "var(--estado-critico)" }}>
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
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
            disabled={guardando || total <= 0}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--acento)" }}
          >
            {guardando ? "Guardando…" : "Guardar corrida"}
          </button>
        </div>
      </div>
    </div>
  );
}
