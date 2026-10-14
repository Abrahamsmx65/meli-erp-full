"use client";

import { useMemo, useState } from "react";
import type { Asignaciones, ClasePromo, RenglonPromo } from "@/lib/precios/promociones";
import { NOMBRE_CLASE, ORDEN_CLASES, claveRenglon, precioMinimoAmazon } from "@/lib/precios/promociones";
import type { ResultadoPrecio, RevisionPrecios } from "@/lib/servicios/precios-modelos";
import { Aviso } from "@/components/ui/pagina";

const din = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fecha = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

const TEXTO_ACCION: Record<string, { texto: string; color: string }> = {
  cambiar: { texto: "se cambia", color: "var(--estado-alerta)" },
  inscribir: { texto: "se inscribe", color: "var(--estado-alerta)" },
  igual: { texto: "ya está", color: "var(--exito-texto)" },
  no_se_toca: { texto: "no se toca", color: "var(--ink-3)" },
  sin_precio: { texto: "sin precio en Números", color: "var(--estado-critico)" },
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
  const [asignadas, setAsignadas] = useState<Asignaciones>({});
  const [stocks, setStocks] = useState<Record<string, string>>({});

  const revisar = async (asig: Asignaciones = asignadas) => {
    setCargando("revisar");
    setError(null);
    setResultados(null);
    try {
      const r = await fetch(
        `/api/finanzas/numeros/precios?modelos=${encodeURIComponent(modelos)}&asignadas=${encodeURIComponent(JSON.stringify(asig))}`,
      );
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
        body: JSON.stringify({ modelos, asignadas, stocks }),
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

  // Cada promoción distinta (tipo + nombre) una vez, con cuántas publicaciones la traen.
  const promos = useMemo(() => {
    const m = new Map<string, { clave: string; tipo: string; nombre: string; clase: ClasePromo | null; veces: number }>();
    for (const r of revision?.meli ?? []) {
      const nombre = r.clave.split("|").slice(1).join("|") || "(sin nombre)";
      const p = m.get(r.clave) ?? { clave: r.clave, tipo: r.tipo, nombre, clase: r.clase, veces: 0 };
      p.veces++;
      m.set(r.clave, p);
    }
    return [...m.values()];
  }, [revision]);

  const asignar = (clave: string, valor: string) => {
    const nuevas = { ...asignadas, [clave]: valor as ClasePromo | "no_tocar" };
    setAsignadas(nuevas);
    void revisar(nuevas);
  };

  const filaMeli = (r: RenglonPromo, i: number) => (
    <tr key={`${r.itemId}-${r.promoId}-${i}`} className="border-t hairline">
      <td className="px-2 py-1 cifra">{r.itemId}</td>
      <td className="px-2 py-1">{r.clase ? NOMBRE_CLASE[r.clase] : "—"}</td>
      <td className="px-2 py-1">{r.nombre}</td>
      <td className="px-2 py-1 texto-tenue">
        {r.tipo} · {r.estado}
        {r.inicio ? <div>{fecha(r.inicio)}{r.fin ? ` → ${fecha(r.fin)}` : ""}</div> : null}
      </td>
      <td className="px-2 py-1 text-right cifra">{din(r.actual)}</td>
      <td className="px-2 py-1 text-right cifra font-semibold">
        {din(r.nuevo)}
        {r.minimo || r.maximo ? (
          <div
            className="text-[10px] font-normal"
            style={{ color: r.fueraDeRango ? "var(--estado-alerta)" : "var(--ink-3)" }}
            title="Rango que MELI mandó para esta promoción; si no lo acepta, al aplicar sale su mensaje"
          >
            MELI {din(r.minimo)}–{din(r.maximo)}
          </div>
        ) : null}
      </td>
      <td className="px-2 py-1">
        <Accion a={r.accion} />
        {r.accion === "inscribir" && r.tipo.toUpperCase() === "LIGHTNING" ? (
          <label className="ml-2 inline-flex items-center gap-1">
            <input
              type="number"
              min={r.stockMin ?? 1}
              max={r.stockMax ?? undefined}
              value={stocks[claveRenglon(r)] ?? (r.stockMin != null ? String(r.stockMin) : "")}
              placeholder="5"
              onChange={(e) => setStocks((prev) => ({ ...prev, [claveRenglon(r)]: e.target.value }))}
              className="w-16 rounded border px-1 py-0.5 text-right"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            />
            <span className="texto-tenue">
              pares{r.stockMin != null || r.stockMax != null ? ` (${r.stockMin ?? 1}–${r.stockMax ?? "?"})` : ""}
            </span>
          </label>
        ) : null}
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

          {promos.length ? (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-semibold">¿Qué oferta es cada promoción de MELI?</span>
              {promos.map((p) => (
                <label key={p.clave} className="flex flex-wrap items-center gap-2">
                  <select
                    value={asignadas[p.clave] ?? p.clase ?? "no_tocar"}
                    onChange={(e) => asignar(p.clave, e.target.value)}
                    disabled={!!cargando}
                    className="rounded border px-1 py-0.5"
                    style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                  >
                    {ORDEN_CLASES.map((c) => (
                      <option key={c} value={c}>
                        {NOMBRE_CLASE[c]}
                      </option>
                    ))}
                    <option value="no_tocar">No tocar</option>
                  </select>
                  <span>
                    {p.nombre} <span className="texto-tenue">({p.tipo} · {p.veces} publicaciones)</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="texto-tenue text-left">
                  <th className="px-2">Publicación</th>
                  <th className="px-2">Oferta</th>
                  <th className="px-2">Promoción en MELI</th>
                  <th className="px-2">Tipo · estado</th>
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
                    <td className="px-2 py-1 text-right cifra font-semibold">
                      {din(a.nuevo)}
                      {a.nuevo != null ? (
                        <div className="text-[10px] font-normal texto-tenue">mínimo {din(precioMinimoAmazon(a.nuevo))}</div>
                      ) : null}
                    </td>
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
