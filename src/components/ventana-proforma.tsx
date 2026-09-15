"use client";

import { useState } from "react";

export interface LineaProforma {
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
export interface AjusteLinea {
  esCajaCompleta?: boolean;
  modelo?: string;
  color?: string;
}

export interface Proforma {
  pedido: string;
  proveedor: string | null;
  lineas: LineaProforma[];
  totales: { cajas: number; pares: number; importe: number | null };
  tallasDetectadas: string[];
  avisos: string[];
}

export type Ajustes = Record<number, AjusteLinea>;

/** Los ajustes como los espera `/api/pedidos` (`overrides`): solo los que dicen algo. */
export function overridesDeAjustes(ajustes: Ajustes) {
  return Object.entries(ajustes)
    .map(([indice, a]) => ({ indice: Number(indice), ...a }))
    .filter((o) => o.esCajaCompleta || o.modelo?.trim() || o.color?.trim());
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/** El renglón como va a quedar YA con los ajustes, para verlo antes de confirmar. */
export function lineaEfectiva(l: LineaProforma, a: AjusteLinea | undefined) {
  const modelo = a?.modelo?.trim() ? a.modelo.trim().toUpperCase() : l.modelo;
  const color = a?.color?.trim() ? a.color.trim().toUpperCase() : l.color;

  if (a?.esCajaCompleta && !l.unitalla) {
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

/**
 * La ventana de confirmación de UNA proforma: enseña exactamente lo que va
 * a entrar y deja corregir modelo, color y "caja completa" por renglón.
 *
 * La usan la carga individual y la carga en lote. En el lote los ajustes
 * se pueden GUARDAR sin cargar todavía (`onGuardarAjustes`): se aplican
 * cuando se carga todo el lote, o al momento con `onConfirmar`.
 */
export function VentanaProforma({
  proforma,
  archivoNombre,
  yaExiste,
  ajustesIniciales,
  cargando,
  error,
  textoConfirmar,
  onConfirmar,
  onGuardarAjustes,
  onCancelar,
}: {
  proforma: Proforma;
  archivoNombre: string;
  yaExiste: boolean;
  ajustesIniciales?: Ajustes;
  cargando: boolean;
  error: string | null;
  textoConfirmar?: string;
  onConfirmar: (ajustes: Ajustes) => void;
  /** Si viene, aparece el botón "Guardar ajustes" que cierra sin cargar. */
  onGuardarAjustes?: (ajustes: Ajustes) => void;
  onCancelar: () => void;
}) {
  const [ajustes, setAjustes] = useState<Ajustes>(ajustesIniciales ?? {});

  function ajustar(i: number, cambio: AjusteLinea) {
    setAjustes((prev) => ({ ...prev, [i]: { ...prev[i], ...cambio } }));
  }

  const p = proforma;
  const efectivas = p.lineas.map((l, i) => lineaEfectiva(l, ajustes[i]));
  const totalCajas = efectivas.reduce((a, e) => a + e.cajas, 0);
  const totalPares = efectivas.reduce((a, e) => a + e.pares, 0);
  const hayProblema = efectivas.some((e) => e.problema);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: "rgba(0,0,0,.45)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Confirmar carga del pedido ${p.pedido}`}
    >
      <div className="tarjeta my-8 w-full max-w-4xl p-5" style={{ background: "var(--surface-1)" }}>
        <h3 className="text-lg font-semibold">Esto es lo que se va a cargar</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Pedido <strong>{p.pedido}</strong>
          {p.proveedor ? ` · ${p.proveedor}` : ""} · archivo {archivoNombre}
        </p>

        {yaExiste ? (
          <p
            className="mt-3 rounded-lg p-3 text-sm"
            style={{
              background: "color-mix(in oklab, var(--estado-critico) 12%, transparent)",
              color: "var(--estado-critico)",
            }}
          >
            Este pedido <strong>ya está cargado</strong>. Bórralo primero si quieres volver a
            subirlo.
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
            style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
          >
            {p.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        ) : null}

        <p className="mt-3 text-xs" style={{ color: "var(--ink-muted)" }}>
          Puedes corregir el modelo y el color de cada renglón, y marcar{" "}
          <strong>Caja completa</strong> cuando las columnas de talla traen CAJAS de una sola
          talla (46 cajas de la 23, 88 de la 24…): el renglón se parte en una caja por talla y
          los pares por caja salen del propio archivo (pares ÷ cajas). Aquí mismo ves cómo
          queda antes de confirmar.
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
                              style={{ color: e.problema ? "var(--estado-critico)" : "var(--ink-muted)" }}
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

        {error ? (
          <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={onCancelar}
              disabled={cargando}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "var(--borde)" }}
            >
              Cancelar
            </button>
            {onGuardarAjustes ? (
              <button
                onClick={() => onGuardarAjustes(ajustes)}
                disabled={cargando || hayProblema}
                className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
                title="Deja los ajustes listos; se aplican cuando cargues el lote"
              >
                Guardar ajustes
              </button>
            ) : null}
            <button
              onClick={() => onConfirmar(ajustes)}
              disabled={cargando || yaExiste || hayProblema}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--acento)" }}
            >
              {cargando ? "Guardando…" : (textoConfirmar ?? `Cargar pedido ${p.pedido}`)}
            </button>
          </div>
        </div>

        <p className="mt-3 text-xs" style={{ color: "var(--ink-muted)" }}>
          Al confirmar, el pedido queda como <strong>creado</strong> y pendiente de número de
          contenedor. Sus corridas entran de inmediato y el planeador podrá usarlas.
        </p>
      </div>
    </div>
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
