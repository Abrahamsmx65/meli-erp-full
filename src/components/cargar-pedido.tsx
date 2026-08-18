"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface LineaProforma {
  modelo: string;
  color: string;
  colorCrudo: string;
  descripcion: string;
  tallas: Record<string, number>;
  paresPorCaja: number;
  cajas: number;
  pares: number;
  cuadra: boolean;
}

interface Proforma {
  pedido: string;
  proveedor: string | null;
  lineas: LineaProforma[];
  totales: { cajas: number; pares: number; importe: number | null };
  tallasDetectadas: string[];
  avisos: string[];
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Carga de una proforma, en dos pasos.
 *
 * Primero se lee el archivo y se muestra exactamente lo que va a entrar; solo
 * después se guarda. La separación importa porque cargar un pedido también da
 * de alta sus corridas, y las corridas son las que el planeador usa para
 * decidir qué cajas mandar a Full. Un archivo equivocado soltado sin querer
 * acabaría moviendo producto real.
 */
export function CargarPedido() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [previsualizacion, setPrevisualizacion] = useState<Proforma | null>(null);
  const [yaExiste, setYaExiste] = useState(false);
  const [fechaPi, setFechaPi] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  async function previsualizar(f: File) {
    setCargando(true);
    setError(null);
    setExito(null);
    setPrevisualizacion(null);

    try {
      const fd = new FormData();
      fd.append("archivo", f);
      fd.append("accion", "previsualizar");

      const r = await fetch("/api/pedidos", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer el archivo.");

      setArchivo(f);
      setPrevisualizacion(j.proforma);
      setYaExiste(Boolean(j.yaExiste));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function confirmar() {
    if (!archivo) return;
    setCargando(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("archivo", archivo);
      fd.append("accion", "confirmar");
      if (fechaPi) fd.append("fechaPi", fechaPi);

      const r = await fetch("/api/pedidos", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar el pedido.");

      setExito(
        `Pedido ${j.pedido} cargado: ${j.lineasCreadas} renglones y ${j.corridasCreadas} corridas dadas de alta.`,
      );
      cancelar();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  function cancelar() {
    setPrevisualizacion(null);
    setArchivo(null);
    setYaExiste(false);
    setFechaPi("");
    if (input.current) input.current.value = "";
  }

  const p = previsualizacion;

  return (
    <section className="tarjeta p-4">
      <h2 className="font-semibold">Cargar un pedido nuevo</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
        Sube la Proforma Invoice de la fábrica tal como te llega. De ahí salen el
        pedido, sus modelos y colores, y <strong>las corridas</strong> — el reparto de
        tallas por caja ya viene en el archivo, así que no hay que capturarlo.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          accept=".xls,.xlsx"
          disabled={cargando}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) previsualizar(f);
          }}
          className="text-sm"
        />
        {cargando && !p ? (
          <span className="text-sm" style={{ color: "var(--ink-2)" }}>
            Leyendo el archivo…
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
      {exito ? (
        <p className="mt-3 text-sm" style={{ color: "var(--exito-texto)" }}>
          {exito}
        </p>
      ) : null}

      {/* ---- Ventana de confirmación ------------------------------------- */}
      {p ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          style={{ background: "rgba(0,0,0,.45)" }}
          role="dialog"
          aria-modal="true"
          aria-label={`Confirmar carga del pedido ${p.pedido}`}
        >
          <div
            className="tarjeta my-8 w-full max-w-4xl p-5"
            style={{ background: "var(--surface-1)" }}
          >
            <h3 className="text-lg font-semibold">
              Esto es lo que se va a cargar
            </h3>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
              Pedido <strong>{p.pedido}</strong>
              {p.proveedor ? ` · ${p.proveedor}` : ""} · archivo {archivo?.name}
            </p>

            {yaExiste ? (
              <p
                className="mt-3 rounded-lg p-3 text-sm"
                style={{
                  background: "color-mix(in oklab, var(--estado-critico) 12%, transparent)",
                  color: "var(--estado-critico)",
                }}
              >
                Este pedido <strong>ya está cargado</strong>. Bórralo primero si quieres
                volver a subirlo.
              </p>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Dato titulo="Renglones" valor={String(p.lineas.length)} />
              <Dato titulo="Cajas" valor={n(p.totales.cajas)} />
              <Dato titulo="Pares" valor={n(p.totales.pares)} />
              <Dato titulo="Tallas" valor={p.tallasDetectadas.join(", ")} />
            </div>

            {p.avisos.length ? (
              <ul
                className="mt-3 flex flex-col gap-1 rounded-lg p-3 text-sm"
                style={{
                  background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)",
                }}
              >
                {p.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 max-h-80 overflow-auto">
              <table className="datos">
                <thead>
                  <tr>
                    <th>Modelo</th>
                    <th>Color</th>
                    {p.tallasDetectadas.map((t) => (
                      <th key={t} className="num">
                        {t}
                      </th>
                    ))}
                    <th className="num">Por caja</th>
                    <th className="num">Cajas</th>
                    <th className="num">Pares</th>
                  </tr>
                </thead>
                <tbody>
                  {p.lineas.map((l, i) => (
                    <tr key={`${l.modelo}-${l.color}-${i}`}>
                      <td className="font-medium">{l.modelo}</td>
                      <td>
                        {l.color}
                        {l.colorCrudo !== l.color ? (
                          <div className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                            {l.colorCrudo}
                          </div>
                        ) : null}
                      </td>
                      {p.tallasDetectadas.map((t) => (
                        <td key={t} className="num cifra">
                          {l.tallas[t] || "—"}
                        </td>
                      ))}
                      <td
                        className="num cifra font-medium"
                        style={{ color: l.cuadra ? "var(--ink-1)" : "var(--estado-alerta)" }}
                      >
                        {l.paresPorCaja}
                      </td>
                      <td className="num cifra">{n(l.cajas)}</td>
                      <td className="num cifra">{n(l.pares)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block" style={{ color: "var(--ink-2)" }}>
                  Fecha de la proforma (opcional)
                </span>
                <input
                  type="date"
                  value={fechaPi}
                  onChange={(e) => setFechaPi(e.target.value)}
                  className="mt-1"
                />
              </label>

              <div className="ml-auto flex gap-2">
                <button
                  onClick={cancelar}
                  disabled={cargando}
                  className="rounded-lg border px-3 py-2 text-sm font-medium"
                  style={{ borderColor: "var(--borde)" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmar}
                  disabled={cargando || yaExiste}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: "var(--acento)" }}
                >
                  {cargando ? "Guardando…" : `Cargar pedido ${p.pedido}`}
                </button>
              </div>
            </div>

            <p className="mt-3 text-xs" style={{ color: "var(--ink-muted)" }}>
              Al confirmar, el pedido queda como <strong>creado</strong> y pendiente de
              número de contenedor. Sus corridas entran de inmediato y el planeador
              podrá usarlas.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
        {titulo}
      </div>
      <div className="cifra mt-0.5 font-semibold">{valor}</div>
    </div>
  );
}
