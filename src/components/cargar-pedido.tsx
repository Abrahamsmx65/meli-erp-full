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
  unitalla: string | null;
}

/**
 * Ajustes que el usuario hace por renglón en la ventana de confirmación.
 * Viajan al servidor junto con el archivo y se aplican allá, sobre los
 * mismos datos que se van a guardar.
 */
interface AjusteLinea {
  esCajaCompleta?: boolean;
  modelo?: string;
  color?: string;
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
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [ajustes, setAjustes] = useState<Record<number, AjusteLinea>>({});

  function ajustar(i: number, cambio: AjusteLinea) {
    setAjustes((prev) => ({ ...prev, [i]: { ...prev[i], ...cambio } }));
  }

  /** El renglón como va a quedar YA con los ajustes, para verlo antes de confirmar. */
  function efectiva(l: LineaProforma, i: number) {
    const a = ajustes[i] ?? {};
    const modelo = a.modelo?.trim() ? a.modelo.trim().toUpperCase() : l.modelo;
    const color = a.color?.trim() ? a.color.trim().toUpperCase() : l.color;

    if (a.esCajaCompleta && !l.unitalla) {
      // Cajas completas: las columnas de talla son CAJAS de esa talla, CTNS
      // el total de cajas, y los pares por caja salen del archivo: PRS ÷ CTNS.
      const sumaTallas = Object.values(l.tallas).reduce((x, y) => x + (Number(y) || 0), 0);
      const divide = l.cajas > 0 && l.pares > 0 && l.pares % l.cajas === 0;
      const cuadraTallas = sumaTallas === l.cajas;
      const problema = !divide
        ? `${n(l.pares)} pares no es múltiplo de ${n(l.cajas)} cajas.`
        : !cuadraTallas
          ? `Las tallas suman ${n(sumaTallas)} cajas pero el archivo dice ${n(l.cajas)}.`
          : null;
      return {
        modelo,
        color,
        cajas: l.cajas,
        pares: l.pares,
        porCaja: divide ? l.pares / l.cajas : null,
        problema,
      };
    }

    return { modelo, color, cajas: l.cajas, pares: l.pares, porCaja: l.paresPorCaja, problema: null };
  }

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

      const overrides = Object.entries(ajustes)
        .map(([indice, a]) => ({ indice: Number(indice), ...a }))
        .filter((o) => o.esCajaCompleta || o.modelo?.trim() || o.color?.trim());
      if (overrides.length) fd.append("overrides", JSON.stringify(overrides));

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
    setAjustes({});
    if (input.current) input.current.value = "";
  }

  const p = previsualizacion;
  const efectivas = p ? p.lineas.map((l, i) => efectiva(l, i)) : [];
  const totalCajas = efectivas.reduce((a, e) => a + e.cajas, 0);
  const totalPares = efectivas.reduce((a, e) => a + e.pares, 0);
  const hayProblema = efectivas.some((e) => e.problema);

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
              <Dato titulo="Cajas" valor={n(totalCajas)} />
              <Dato titulo="Pares" valor={n(totalPares)} />
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

            <p className="mt-3 text-xs" style={{ color: "var(--ink-muted)" }}>
              Puedes corregir el modelo y el color de cada renglón, y marcar{" "}
              <strong>Caja completa</strong> cuando las columnas de talla traen CAJAS de
              una sola talla (46 cajas de la 23, 88 de la 24…): el renglón se parte en
              una caja por talla y los pares por caja salen del propio archivo (pares ÷
              cajas). Aquí mismo ves cómo queda antes de confirmar.
            </p>

            <div className="mt-2 max-h-80 overflow-auto">
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
                    <th>Caja completa</th>
                    <th className="num">Cajas</th>
                    <th className="num">Pares</th>
                  </tr>
                </thead>
                <tbody>
                  {p.lineas.map((l, i) => {
                    const e = efectivas[i];
                    const a = ajustes[i] ?? {};
                    const cambiado = a.esCajaCompleta || a.modelo?.trim() || a.color?.trim();
                    return (
                      <tr key={i}>
                        <td>
                          <input
                            value={a.modelo ?? l.modelo}
                            onChange={(ev) => ajustar(i, { modelo: ev.target.value })}
                            className="w-24 rounded border px-1.5 py-0.5 text-sm font-medium"
                            style={{ borderColor: "var(--borde)", background: "transparent" }}
                            aria-label={`Modelo del renglón ${i + 1}`}
                          />
                        </td>
                        <td>
                          <input
                            value={a.color ?? l.color}
                            onChange={(ev) => ajustar(i, { color: ev.target.value })}
                            className="w-28 rounded border px-1.5 py-0.5 text-sm"
                            style={{ borderColor: "var(--borde)", background: "transparent" }}
                            aria-label={`Color del renglón ${i + 1}`}
                          />
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
                          style={{
                            color: e.problema
                              ? "var(--estado-critico)"
                              : a.esCajaCompleta
                                ? "var(--acento)"
                                : l.cuadra
                                  ? "var(--ink-1)"
                                  : "var(--estado-alerta)",
                          }}
                        >
                          {e.porCaja ?? "¿?"}
                        </td>
                        <td className="text-center">
                          {l.unitalla ? (
                            <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                              talla {l.unitalla}
                            </span>
                          ) : (
                            <>
                              <input
                                type="checkbox"
                                checked={Boolean(a.esCajaCompleta)}
                                onChange={(ev) => ajustar(i, { esCajaCompleta: ev.target.checked })}
                                aria-label={`Las tallas del renglón ${i + 1} son cajas de una sola talla`}
                              />
                              {a.esCajaCompleta ? (
                                <div
                                  className="text-[10px] leading-tight"
                                  style={{
                                    color: e.problema ? "var(--estado-critico)" : "var(--ink-muted)",
                                  }}
                                >
                                  {e.problema ?? "una caja por talla"}
                                </div>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td
                          className="num cifra"
                          style={cambiado ? { color: "var(--acento)", fontWeight: 600 } : undefined}
                        >
                          {n(e.cajas)}
                        </td>
                        <td
                          className="num cifra"
                          style={cambiado ? { color: "var(--acento)", fontWeight: 600 } : undefined}
                        >
                          {n(e.pares)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
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
                  disabled={cargando || yaExiste || hayProblema}
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
