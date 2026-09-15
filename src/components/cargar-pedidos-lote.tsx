"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  VentanaProforma,
  lineaEfectiva,
  overridesDeAjustes,
  type Ajustes,
  type Proforma,
} from "./ventana-proforma";

type Estado =
  | "leyendo"
  | "listo"
  | "ya_existe"
  | "repetido"
  | "error"
  | "guardando"
  | "cargado"
  | "fallo";

interface Renglon {
  archivo: File;
  estado: Estado;
  proforma: Proforma | null;
  /** ajustes por renglón de la proforma, hechos en la ventana de revisión */
  ajustes: Ajustes;
  mensaje: string | null;
}

const ETIQUETA: Record<Estado, { texto: string; color: string }> = {
  leyendo: { texto: "Leyendo…", color: "var(--ink-muted)" },
  listo: { texto: "Listo para cargar", color: "var(--exito-texto)" },
  ya_existe: { texto: "Ya está cargado", color: "var(--estado-alerta)" },
  repetido: { texto: "Repetido en el lote", color: "var(--estado-alerta)" },
  error: { texto: "No se pudo leer", color: "var(--estado-critico)" },
  guardando: { texto: "Guardando…", color: "var(--acento)" },
  cargado: { texto: "Cargado", color: "var(--exito-texto)" },
  fallo: { texto: "No se cargó", color: "var(--estado-critico)" },
};

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/** Cajas y pares del archivo YA con los ajustes del usuario. */
function totalesDe(r: Renglon): { cajas: number; pares: number; problemas: number } {
  if (!r.proforma) return { cajas: 0, pares: 0, problemas: 0 };
  let cajas = 0;
  let pares = 0;
  let problemas = 0;
  r.proforma.lineas.forEach((l, i) => {
    const e = lineaEfectiva(l, r.ajustes[i]);
    cajas += e.cajas;
    pares += e.pares;
    if (e.problema) problemas++;
  });
  return { cajas, pares, problemas };
}

function cuantosAjustes(a: Ajustes): number {
  return overridesDeAjustes(a).length;
}

/**
 * Carga de MUCHAS proformas de un jalón.
 *
 * Cada archivo se lee primero (sin guardar) y se enseña qué trae. Un pedido
 * que ya está en el ERP, uno que viene dos veces en el lote, o un archivo
 * que no se pudo leer, NO se cargan: se quedan marcados y los demás sí
 * entran. Así un lote de veinte proformas no se detiene por una mala.
 *
 * Cada archivo se puede REVISAR con la misma ventana de la carga
 * individual (modelo, color y "caja completa" por renglón): los ajustes se
 * guardan por archivo y se aplican al cargar el lote, o al momento con
 * "Cargar este pedido".
 */
export function CargarPedidosLote() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [resumen, setResumen] = useState<string | null>(null);
  const [revisando, setRevisando] = useState<number | null>(null);
  const [errorVentana, setErrorVentana] = useState<string | null>(null);

  function actualizar(i: number, cambio: Partial<Renglon>) {
    setRenglones((prev) => prev.map((r, k) => (k === i ? { ...r, ...cambio } : r)));
  }

  async function leer(archivos: File[]) {
    setResumen(null);
    const base: Renglon[] = archivos.map((archivo) => ({
      archivo,
      estado: "leyendo",
      proforma: null,
      ajustes: {},
      mensaje: null,
    }));
    setRenglones(base);
    setOcupado(true);

    // Tres a la vez: cada lectura es una función de Vercel.
    let cursor = 0;
    const trabajador = async () => {
      while (cursor < archivos.length) {
        const i = cursor++;
        const fd = new FormData();
        fd.append("archivo", archivos[i]);
        fd.append("accion", "previsualizar");
        try {
          const r = await fetch("/api/pedidos", { method: "POST", body: fd });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "No se pudo leer el archivo.");
          actualizar(i, {
            estado: j.yaExiste ? "ya_existe" : "listo",
            proforma: j.proforma,
            mensaje: j.yaExiste
              ? "Este pedido ya está en el ERP; bórralo primero si quieres volver a subirlo."
              : null,
          });
        } catch (e) {
          actualizar(i, { estado: "error", mensaje: (e as Error).message });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, archivos.length) }, trabajador));

    // Repetidos DENTRO del lote: el primero se queda, los demás se marcan.
    const vistos = new Set<string>();
    setRenglones((prev) =>
      prev.map((r) => {
        if (r.estado !== "listo" || !r.proforma) return r;
        if (vistos.has(r.proforma.pedido)) {
          return {
            ...r,
            estado: "repetido",
            mensaje: `El pedido ${r.proforma.pedido} viene en otro archivo del lote.`,
          };
        }
        vistos.add(r.proforma.pedido);
        return r;
      }),
    );
    setOcupado(false);
  }

  /** Guarda UN archivo con sus ajustes; devuelve el mensaje de éxito o lanza. */
  async function guardarUno(r: Renglon): Promise<string> {
    const fd = new FormData();
    fd.append("archivo", r.archivo);
    fd.append("accion", "confirmar");
    const overrides = overridesDeAjustes(r.ajustes);
    if (overrides.length) fd.append("overrides", JSON.stringify(overrides));
    const resp = await fetch("/api/pedidos", { method: "POST", body: fd });
    const j = await resp.json();
    if (!resp.ok) throw new Error(j.error ?? "No se pudo guardar.");
    return `${j.lineasCreadas} renglones y ${j.corridasCreadas} corridas.`;
  }

  async function cargar() {
    setOcupado(true);
    setResumen(null);
    let cargados = 0;
    let fallidos = 0;

    // En serie: cada pedido da de alta corridas y el orden importa para
    // que un error diga exactamente en cuál se detuvo.
    for (let i = 0; i < renglones.length; i++) {
      const r = renglones[i];
      if (r.estado !== "listo") continue;
      if (totalesDe(r).problemas) {
        fallidos++;
        actualizar(i, { estado: "fallo", mensaje: "Tiene ajustes que no cuadran: ábrelo con Revisar." });
        continue;
      }
      actualizar(i, { estado: "guardando" });
      try {
        const mensaje = await guardarUno(r);
        cargados++;
        actualizar(i, { estado: "cargado", mensaje });
      } catch (e) {
        fallidos++;
        actualizar(i, { estado: "fallo", mensaje: (e as Error).message });
      }
    }

    const omitidos = renglones.filter((r) => ["ya_existe", "repetido", "error"].includes(r.estado)).length;
    setResumen(
      `${cargados} pedidos cargados` +
        (fallidos ? `, ${fallidos} fallaron al guardar` : "") +
        (omitidos ? `, ${omitidos} se dejaron fuera (repetidos, ya cargados o ilegibles)` : "") +
        ".",
    );
    setOcupado(false);
    router.refresh();
  }

  /** Desde la ventana de revisión: carga ESE archivo ahora, con sus ajustes. */
  async function cargarUnoAhora(i: number, ajustes: Ajustes) {
    const r = { ...renglones[i], ajustes };
    setOcupado(true);
    setErrorVentana(null);
    actualizar(i, { ajustes, estado: "guardando" });
    try {
      const mensaje = await guardarUno(r);
      actualizar(i, { estado: "cargado", mensaje });
      setRevisando(null);
      router.refresh();
    } catch (e) {
      actualizar(i, { estado: "listo" });
      setErrorVentana((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function limpiar() {
    setRenglones([]);
    setResumen(null);
    if (input.current) input.current.value = "";
  }

  const listos = renglones.filter((r) => r.estado === "listo");
  const totalCajas = listos.reduce((a, r) => a + totalesDe(r).cajas, 0);
  const terminado =
    renglones.length > 0 &&
    renglones.every((r) => ["cargado", "fallo", "ya_existe", "repetido", "error"].includes(r.estado));
  const abierto = revisando != null ? renglones[revisando] : null;

  return (
    <section className="tarjeta p-4">
      <h2 className="font-semibold">Cargar pedidos nuevos</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
        Elige una o muchas Proformas Invoice de la fábrica. Se leen todas primero y
        se enseña qué trae cada una; un pedido repetido, uno que ya está cargado o
        un archivo con error <strong>no se carga</strong> y los demás sí. Con{" "}
        <strong>Revisar</strong> abres cada uno para corregir modelo, color o marcar
        cajas completas antes de cargar, igual que con un pedido solo.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          accept=".xls,.xlsx"
          multiple
          disabled={ocupado}
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) leer(fs);
          }}
          className="text-sm"
        />
        {renglones.length ? (
          <>
            <button
              onClick={cargar}
              disabled={ocupado || listos.length === 0}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--acento)" }}
            >
              {ocupado
                ? "Trabajando…"
                : `Cargar ${listos.length} pedido${listos.length === 1 ? "" : "s"} (${n(totalCajas)} cajas)`}
            </button>
            <button
              onClick={limpiar}
              disabled={ocupado}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "var(--borde)" }}
            >
              {terminado ? "Limpiar" : "Cancelar"}
            </button>
          </>
        ) : null}
      </div>

      {resumen ? (
        <p className="mt-3 text-sm" style={{ color: "var(--exito-texto)" }}>
          {resumen}
        </p>
      ) : null}

      {renglones.length ? (
        <div className="mt-3 overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Archivo</th>
                <th>Pedido</th>
                <th className="num">Renglones</th>
                <th className="num">Cajas</th>
                <th className="num">Pares</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {renglones.map((r, i) => {
                const e = ETIQUETA[r.estado];
                const t = totalesDe(r);
                const ajustados = cuantosAjustes(r.ajustes);
                const puedeRevisar = Boolean(r.proforma) && !["guardando", "cargado", "leyendo"].includes(r.estado);
                return (
                  <tr key={i}>
                    <td className="max-w-64 truncate text-xs" title={r.archivo.name}>
                      {r.archivo.name}
                    </td>
                    <td className="font-medium">
                      {r.proforma?.pedido ?? "—"}
                      {r.proforma?.proveedor ? (
                        <div
                          className="max-w-56 truncate text-[11px]"
                          style={{ color: "var(--ink-muted)" }}
                          title={r.proforma.proveedor}
                        >
                          {r.proforma.proveedor}
                        </div>
                      ) : null}
                    </td>
                    <td className="num cifra">{r.proforma ? r.proforma.lineas.length : "—"}</td>
                    <td className="num cifra">{t.cajas ? n(t.cajas) : "—"}</td>
                    <td className="num cifra">{t.pares ? n(t.pares) : "—"}</td>
                    <td>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{ background: `color-mix(in oklab, ${e.color} 15%, transparent)`, color: e.color }}
                      >
                        {e.texto}
                      </span>
                      {ajustados ? (
                        <span
                          className="ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            background: "color-mix(in oklab, var(--acento) 15%, transparent)",
                            color: "var(--acento)",
                          }}
                          title="Ajustes hechos en Revisar; se aplican al cargar"
                        >
                          {ajustados} ajuste{ajustados === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      {t.problemas ? (
                        <span className="ml-1.5 text-[11px]" style={{ color: "var(--estado-critico)" }}>
                          {t.problemas} renglón{t.problemas === 1 ? "" : "es"} no cuadra
                        </span>
                      ) : null}
                      {r.mensaje ? (
                        <div className="mt-0.5 max-w-80 text-[11px]" style={{ color: "var(--ink-2)" }}>
                          {r.mensaje}
                        </div>
                      ) : null}
                      {r.proforma?.avisos.length ? (
                        <details className="mt-0.5 text-[11px]" style={{ color: "var(--estado-alerta)" }}>
                          <summary className="cursor-pointer">{r.proforma.avisos.length} avisos de lectura</summary>
                          <ul className="mt-1 flex flex-col gap-0.5">
                            {r.proforma.avisos.map((a, k) => (
                              <li key={k}>{a}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </td>
                    <td>
                      {puedeRevisar ? (
                        <button
                          onClick={() => {
                            setErrorVentana(null);
                            setRevisando(i);
                          }}
                          disabled={ocupado}
                          className="rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50"
                          style={{ borderColor: "var(--borde)" }}
                        >
                          Revisar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {abierto && abierto.proforma && revisando != null ? (
        <VentanaProforma
          key={revisando}
          proforma={abierto.proforma}
          archivoNombre={abierto.archivo.name}
          yaExiste={abierto.estado === "ya_existe" || abierto.estado === "repetido"}
          ajustesIniciales={abierto.ajustes}
          cargando={ocupado}
          error={errorVentana}
          textoConfirmar={`Cargar este pedido (${abierto.proforma.pedido})`}
          onConfirmar={(ajustes) => cargarUnoAhora(revisando, ajustes)}
          onGuardarAjustes={(ajustes) => {
            actualizar(revisando, { ajustes });
            setRevisando(null);
          }}
          onCancelar={() => setRevisando(null)}
        />
      ) : null}
    </section>
  );
}
