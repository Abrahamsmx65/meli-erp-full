"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
  pedido: string | null;
  proveedor: string | null;
  renglones: number;
  cajas: number;
  pares: number;
  avisos: string[];
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

/**
 * Carga de MUCHAS proformas de un jalón.
 *
 * Cada archivo se lee primero (sin guardar) y se enseña qué trae. Un pedido
 * que ya está en el ERP, uno que viene dos veces en el lote, o un archivo
 * que no se pudo leer, NO se cargan: se quedan marcados y los demás sí
 * entran. Así un lote de veinte proformas no se detiene por una mala.
 */
export function CargarPedidosLote() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [resumen, setResumen] = useState<string | null>(null);

  function actualizar(i: number, cambio: Partial<Renglon>) {
    setRenglones((prev) => prev.map((r, k) => (k === i ? { ...r, ...cambio } : r)));
  }

  async function leer(archivos: File[]) {
    setResumen(null);
    const base: Renglon[] = archivos.map((archivo) => ({
      archivo,
      estado: "leyendo",
      pedido: null,
      proveedor: null,
      renglones: 0,
      cajas: 0,
      pares: 0,
      avisos: [],
      mensaje: null,
    }));
    setRenglones(base);
    setOcupado(true);

    // Tres a la vez: cada lectura es una función de Vercel.
    const resultados: Partial<Renglon>[] = new Array(archivos.length);
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
          resultados[i] = {
            estado: j.yaExiste ? "ya_existe" : "listo",
            pedido: j.proforma.pedido,
            proveedor: j.proforma.proveedor ?? null,
            renglones: j.proforma.lineas.length,
            cajas: j.proforma.totales.cajas,
            pares: j.proforma.totales.pares,
            avisos: j.proforma.avisos ?? [],
            mensaje: j.yaExiste ? "Este pedido ya está en el ERP; bórralo primero si quieres volver a subirlo." : null,
          };
        } catch (e) {
          resultados[i] = { estado: "error", mensaje: (e as Error).message };
        }
        actualizar(i, resultados[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, archivos.length) }, trabajador));

    // Repetidos DENTRO del lote: el primero se queda, los demás se marcan.
    const vistos = new Set<string>();
    setRenglones((prev) =>
      prev.map((r) => {
        if (r.estado !== "listo" || !r.pedido) return r;
        if (vistos.has(r.pedido)) {
          return { ...r, estado: "repetido", mensaje: `El pedido ${r.pedido} viene en otro archivo del lote.` };
        }
        vistos.add(r.pedido);
        return r;
      }),
    );
    setOcupado(false);
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
      actualizar(i, { estado: "guardando" });
      const fd = new FormData();
      fd.append("archivo", r.archivo);
      fd.append("accion", "confirmar");
      try {
        const resp = await fetch("/api/pedidos", { method: "POST", body: fd });
        const j = await resp.json();
        if (!resp.ok) throw new Error(j.error ?? "No se pudo guardar.");
        cargados++;
        actualizar(i, {
          estado: "cargado",
          mensaje: `${j.lineasCreadas} renglones y ${j.corridasCreadas} corridas.`,
        });
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

  function limpiar() {
    setRenglones([]);
    setResumen(null);
    if (input.current) input.current.value = "";
  }

  const listos = renglones.filter((r) => r.estado === "listo").length;
  const totalCajas = renglones.filter((r) => r.estado === "listo").reduce((a, r) => a + r.cajas, 0);
  const terminado = renglones.length > 0 && renglones.every((r) => ["cargado", "fallo", "ya_existe", "repetido", "error"].includes(r.estado));

  return (
    <section className="tarjeta p-4">
      <h2 className="font-semibold">Cargar pedidos nuevos</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
        Elige una o muchas Proformas Invoice de la fábrica. Se leen todas primero y
        se enseña qué trae cada una; un pedido repetido, uno que ya está cargado o
        un archivo con error <strong>no se carga</strong> y los demás sí. De cada
        proforma salen el pedido, sus renglones y sus corridas.
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
              disabled={ocupado || listos === 0}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--acento)" }}
            >
              {ocupado ? "Trabajando…" : `Cargar ${listos} pedido${listos === 1 ? "" : "s"} (${n(totalCajas)} cajas)`}
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
              </tr>
            </thead>
            <tbody>
              {renglones.map((r, i) => {
                const e = ETIQUETA[r.estado];
                return (
                  <tr key={i}>
                    <td className="max-w-64 truncate text-xs" title={r.archivo.name}>
                      {r.archivo.name}
                    </td>
                    <td className="font-medium">
                      {r.pedido ?? "—"}
                      {r.proveedor ? (
                        <div className="max-w-56 truncate text-[11px]" style={{ color: "var(--ink-muted)" }} title={r.proveedor}>
                          {r.proveedor}
                        </div>
                      ) : null}
                    </td>
                    <td className="num cifra">{r.renglones || "—"}</td>
                    <td className="num cifra">{r.cajas ? n(r.cajas) : "—"}</td>
                    <td className="num cifra">{r.pares ? n(r.pares) : "—"}</td>
                    <td>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{ background: `color-mix(in oklab, ${e.color} 15%, transparent)`, color: e.color }}
                      >
                        {e.texto}
                      </span>
                      {r.mensaje ? (
                        <div className="mt-0.5 max-w-80 text-[11px]" style={{ color: "var(--ink-2)" }}>
                          {r.mensaje}
                        </div>
                      ) : null}
                      {r.avisos.length ? (
                        <details className="mt-0.5 text-[11px]" style={{ color: "var(--estado-alerta)" }}>
                          <summary className="cursor-pointer">{r.avisos.length} avisos de lectura</summary>
                          <ul className="mt-1 flex flex-col gap-0.5">
                            {r.avisos.map((a, k) => (
                              <li key={k}>{a}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
