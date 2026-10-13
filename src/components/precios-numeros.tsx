"use client";

import { useState } from "react";
import type { RenglonPromo } from "@/lib/precios/promociones";
import { NOMBRE_CLASE } from "@/lib/precios/promociones";
import type { ResultadoPrecio, RevisionPrecios } from "@/lib/servicios/precios-modelos";
import { Aviso } from "@/components/ui/pagina";

const din = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TEXTO_ACCION: Record<string, { texto: string; color: string }> = {
  cambiar: { texto: "se cambia", color: "var(--estado-alerta)" },
  inscribir: { texto: "se inscribe", color: "var(--estado-alerta)" },
  igual: { texto: "ya está", color: "var(--exito-texto)" },
  no_se_toca: { texto: "no se toca", color: "var(--ink-3)" },
  sin_precio: { texto: "sin precio en Números", color: "var(--estado-critico)" },
  fuera_de_rango: { texto: "fuera del rango de MELI", color: "var(--estado-critico)" },
  relampago_candidata: { texto: "relámpago sin programar: se hace en MELI", color: "var(--ink-3)" },
};

function Accion({ a }: { a: string }) {
  const t = TEXTO_ACCION[a] ?? { texto: a, color: "var(--ink-3)" };
  return <span style={{ color: t.color }}>{t.texto}</span>;
}

/**
 * Lleva los precios de Números a MELI y Amazon: primero REVISA en vivo lo
 * que cada publicación tiene contra lo nuevo y solo con «Aplicar» escribe.
 */
export function PreciosNumeros() {
  const [modelos, setModelos] = useState("");
  const [cargando, setCargando] = useState<"revisar" | "aplicar" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState<RevisionPrecios | null>(null);
  const [resultados, setResultados] = useState<ResultadoPrecio[] | null>(null);

  const revisar = async () => {
    setCargando("revisar");
    setError(null);
    setResultados(null);
    try {
      const r = await fetch(`/api/finanzas/numeros/precios?modelos=${encodeURIComponent(modelos)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo revisar.");
      setRevision(j as RevisionPrecios);
    } catch (err) {
      setRevision(null);
      setError((err as Error).message);
    } finally {
      setCargando(null);
    }
  };

  const porHacer =
    (revision?.meli.filter((r) => r.accion === "cambiar" || r.accion === "inscribir").length ?? 0) +
    (revision?.amazon.filter((a) => a.accion === "cambiar").length ?? 0);

  const aplicar = async () => {
    if (!revision || !porHacer) return;
    if (!confirm(`Se van a cambiar ${porHacer} precios en Mercado Libre y Amazon. ¿Continuar?`)) return;
    setCargando("aplicar");
    setError(null);
    try {
      const r = await fetch("/api/finanzas/numeros/precios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelos }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "No se pudo aplicar.");
      setResultados(j.resultados as ResultadoPrecio[]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(null);
    }
  };

  const filaMeli = (r: RenglonPromo, i: number) => (
    <tr key={`${r.itemId}-${r.promoId}-${i}`} className="border-t hairline">
      <td className="px-2 py-1 cifra">{r.itemId}</td>
      <td className="px-2 py-1">{r.clase ? NOMBRE_CLASE[r.clase] : "—"}</td>
      <td className="px-2 py-1">{r.nombre}</td>
      <td className="px-2 py-1 texto-tenue">{r.estado}</td>
      <td className="px-2 py-1 text-right cifra">{din(r.actual)}</td>
      <td className="px-2 py-1 text-right cifra font-semibold">{din(r.nuevo)}</td>
      <td className="px-2 py-1">
        <Accion a={r.accion} />
      </td>
    </tr>
  );

  return (
    <div className="flex flex-col gap-3 p-3">
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void revisar();
        }}
      >
        <input
          value={modelos}
          onChange={(e) => setModelos(e.target.value)}
          placeholder="Modelos: GT251 GT253 GT254…"
          className="min-w-[16rem] flex-1 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
        />
        <button type="submit" className="boton boton-secundario" disabled={!!cargando || !modelos.trim()}>
          {cargando === "revisar" ? "Leyendo MELI y Amazon…" : "Revisar precios"}
        </button>
        <button type="button" className="boton boton-primario" disabled={!!cargando || !porHacer} onClick={() => void aplicar()}>
          {cargando === "aplicar" ? "Aplicando…" : `Aplicar ${porHacer || ""}`.trim()}
        </button>
      </form>

      {error ? <Aviso tono="critico">{error}</Aviso> : null}
      {revision?.avisos.map((a, i) => (
        <Aviso key={i} tono="alerta">
          {a}
        </Aviso>
      ))}

      {revision ? (
        <>
          <table className="text-xs">
            <thead>
              <tr className="texto-tenue text-left">
                <th className="px-2">Modelo</th>
                <th className="px-2 text-right">Relámpago</th>
                <th className="px-2 text-right">Buen Fin y todos los días</th>
                <th className="px-2 text-right">Amazon (PVP deal)</th>
              </tr>
            </thead>
            <tbody>
              {revision.objetivos.map((o) => (
                <tr key={o.modelo} className="border-t hairline">
                  <td className="px-2 py-1 font-semibold">{o.modelo}</td>
                  <td className="px-2 py-1 text-right cifra">{din(o.relampago)}</td>
                  <td className="px-2 py-1 text-right cifra">{din(o.normal)}</td>
                  <td className="px-2 py-1 text-right cifra">{din(o.pvpDeal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="texto-tenue text-left">
                  <th className="px-2">Publicación</th>
                  <th className="px-2">Oferta</th>
                  <th className="px-2">Promoción en MELI</th>
                  <th className="px-2">Estado</th>
                  <th className="px-2 text-right">Hoy</th>
                  <th className="px-2 text-right">Nuevo</th>
                  <th className="px-2" />
                </tr>
              </thead>
              <tbody>
                {revision.meli.map(filaMeli)}
                {revision.amazon.map((a) => (
                  <tr key={a.sku} className="border-t hairline">
                    <td className="px-2 py-1 cifra">{a.sku}</td>
                    <td className="px-2 py-1">Amazon</td>
                    <td className="px-2 py-1">PVP deal</td>
                    <td className="px-2 py-1 texto-tenue">{a.estado ?? ""}</td>
                    <td className="px-2 py-1 text-right cifra">{din(a.actual)}</td>
                    <td className="px-2 py-1 text-right cifra font-semibold">{din(a.nuevo)}</td>
                    <td className="px-2 py-1">
                      <Accion a={a.accion} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {resultados ? (
        <ul className="flex flex-col gap-0.5 text-xs">
          {resultados.length === 0 ? <li className="texto-tenue">No había nada que cambiar.</li> : null}
          {resultados.map((r, i) => (
            <li key={i}>
              <span className="cifra">{r.donde}</span>{" "}
              <span style={{ color: r.ok ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                {r.ok ? "✓" : "✗"} {r.detalle}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
