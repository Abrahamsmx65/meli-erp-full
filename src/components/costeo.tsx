"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CostoModeloVista } from "@/lib/servicios/costeo";

function pesos(x: number | null | undefined, dec = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return "$" + x.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

async function post(cuerpo: unknown): Promise<any> {
  const r = await fetch("/api/finanzas/costeo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "No se pudo.");
  return j;
}

/** Botones de arriba: volver a leer los sheets y subir el Excel de costeo. */
export function AccionesCosteo() {
  const router = useRouter();
  const archivo = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState("");

  async function refrescar() {
    setOcupado("refrescar");
    setMensaje("");
    try {
      const r = await post({ accion: "refrescar" });
      setMensaje(`Listo: ${r.costeados} contenedores costeados.`);
      router.refresh();
    } catch (e) {
      setMensaje((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function subir(f: File) {
    setOcupado("subir");
    setMensaje("");
    try {
      const fd = new FormData();
      fd.append("archivo", f);
      const r = await fetch("/api/finanzas/costeo", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo leer el archivo.");
      setMensaje(`Leí ${j.contenedoresExcel} contenedores del Excel; ${j.costeados} ya cuentan.`);
      router.refresh();
    } catch (e) {
      setMensaje((e as Error).message);
    } finally {
      setOcupado(null);
      if (archivo.current) archivo.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {mensaje ? <span className="texto-2 text-[13px]">{mensaje}</span> : null}
      <input
        ref={archivo}
        type="file"
        accept=".xls,.xlsx"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])}
      />
      <button className="boton boton-fantasma boton-chico" disabled={!!ocupado} onClick={() => archivo.current?.click()}>
        {ocupado === "subir" ? "Leyendo…" : "Subir Excel de costeo"}
      </button>
      <button className="boton boton-primario boton-chico" disabled={!!ocupado} onClick={refrescar}>
        {ocupado === "refrescar" ? "Leyendo sheets…" : "Actualizar"}
      </button>
    </div>
  );
}

/** Tabla por modelo con el costo real, el del último contenedor y el que usan hoy los cortes. */
export function CostosPorModelo({ modelos }: { modelos: CostoModeloVista[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [soloDistintos, setSoloDistintos] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState("");

  const diferencia = (m: CostoModeloVista) =>
    m.real != null && m.costoActual != null && m.costoActual > 0 ? (m.real - m.costoActual) / m.costoActual : null;
  const distinto = (m: CostoModeloVista) => {
    const d = diferencia(m);
    return m.real != null && (d == null || Math.abs(d) >= 0.01);
  };

  const visibles = useMemo(() => {
    const q = busca.trim().toUpperCase().replace(/[\s-]/g, "");
    return modelos.filter(
      (m) =>
        (!q || m.modelo.replace(/-/g, "").includes(q) || (m.categoria ?? "").toUpperCase().includes(busca.trim().toUpperCase())) &&
        (!soloDistintos || distinto(m)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelos, busca, soloDistintos]);
  const porAplicar = modelos.filter(distinto);

  async function aplicar(lista: string[] | null) {
    const n = lista ? lista.length : porAplicar.length;
    if (!window.confirm(`¿Usar el costo real en Catálogo y costos para ${n} modelo${n === 1 ? "" : "s"}? Los cortes que se recalculen desde ahora lo usarán.`)) return;
    setOcupado(lista?.[0] ?? "todos");
    setError("");
    try {
      await post({ accion: "aplicar", modelos: lista });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
          placeholder="Buscar modelo o categoría"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <label className="texto-2 flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={soloDistintos} onChange={(e) => setSoloDistintos(e.target.checked)} />
          Solo los que no cuadran con el catálogo
        </label>
        <span className="texto-tenue text-[13px]">{visibles.length} modelos</span>
        {porAplicar.length ? (
          <button className="boton boton-primario boton-chico ml-auto" disabled={!!ocupado} onClick={() => aplicar(null)}>
            {ocupado === "todos" ? "Guardando…" : `Usar costo real en ${porAplicar.length} modelos`}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-[13px]" style={{ color: "var(--estado-critico)" }}>{error}</p> : null}
      <div className="tabla-caja alta">
        <table className="datos">
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Categoría</th>
              <th className="num">Existencias</th>
              <th className="num">Costo real</th>
              <th>Sale de</th>
              <th className="num">Último contenedor</th>
              <th className="num">En catálogo hoy</th>
              <th className="num">Diferencia</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibles.map((m) => {
              const d = diferencia(m);
              return (
                <tr key={m.modelo}>
                  <td className="font-medium">{m.modelo}</td>
                  <td className="texto-2">{m.categoria ?? "—"}</td>
                  <td className="num cifra">
                    {m.existencias == null ? "—" : m.existencias.toLocaleString("es-MX")}
                    {m.sinCubrir > 0 ? (
                      <div className="texto-tenue text-[11px]" title="Pares que llegaron en contenedores sin costear (antes del S239 o sin detalle)">
                        {m.sinCubrir.toLocaleString("es-MX")} sin costear
                      </div>
                    ) : null}
                  </td>
                  <td className="num cifra font-semibold">{pesos(m.real)}</td>
                  <td className="texto-2 text-[12px]">
                    {m.tomas.map((t) => `${t.id} (${t.pares.toLocaleString("es-MX")} · ${pesos(t.porPar)})`).join(", ") || "—"}
                  </td>
                  <td className="num cifra">
                    {pesos(m.ultimo?.porPar)}
                    <div className="texto-tenue text-[11px]">{m.ultimo?.id ?? ""}</div>
                  </td>
                  <td className="num cifra">{pesos(m.costoActual)}</td>
                  <td
                    className="num cifra"
                    style={{ color: d == null ? undefined : Math.abs(d) < 0.01 ? "var(--exito-texto)" : Math.abs(d) >= 0.1 ? "var(--estado-critico)" : "var(--alerta-texto)" }}
                  >
                    {d == null ? "—" : `${d > 0 ? "+" : ""}${(d * 100).toFixed(1)}%`}
                  </td>
                  <td>
                    {distinto(m) ? (
                      <button className="boton boton-fantasma boton-chico" disabled={!!ocupado} onClick={() => aplicar([m.modelo])}>
                        {ocupado === m.modelo ? "…" : "Usar"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
