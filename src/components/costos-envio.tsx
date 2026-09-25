"use client";

import { useMemo, useState } from "react";
import type { Medida, ModeloRevisado, VarianteRevisada } from "@/lib/servicios/costos-envio";

/**
 * Pantalla de costos de envío: qué publicaciones están mal medidas en MELI y
 * cuánto se paga de más por eso en cada venta.
 *
 * La comparación siempre es contra las hermanas del mismo modelo, porque son
 * la misma caja: si quince tallas del GT229 miden 27 × 24 × 10 y una dice
 * 11 × 29 × 37, el error está en esa una. Por eso cada renglón muestra las
 * dos medidas juntas — es lo que hay que enseñarle a MELI para abrir el caso.
 */

const pesos = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

function caja(m: Medida | null): string {
  if (!m) return "—";
  const n = (x: number) => String(Math.round(x * 10) / 10);
  return `${n(m.largo)} × ${n(m.ancho)} × ${n(m.alto)}`;
}

const fechaCorta = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}/${y.slice(2)}`;
};

/** Los dos últimos cobros reales: "$59.60 (24/9, pedido $230.25, hermanas $59.60)". */
function UltimosCobros({ real }: { real: VarianteRevisada["envioReal"] }) {
  if (!real || !real.ultimos.length) return <span style={{ color: "var(--ink-muted)" }}>sin ventas</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {real.ultimos.map((u, i) => {
        const deMas = u.normal != null ? u.envio - u.normal : null;
        const malo = deMas != null && deMas > 5;
        return (
          <div key={i} className="cifra text-xs" style={{ color: malo ? "var(--estado-critico)" : undefined }}>
            <strong>{pesos(u.envio)}</strong>
            <span style={{ color: "var(--ink-muted)" }}>
              {" "}
              {fechaCorta(u.fecha)} · pedido {pesos(u.total)} ·{" "}
              {u.normal == null
                ? "sin hermana a ese precio"
                : `hermanas ${pesos(u.normal)}${malo ? ` (+${pesos(deMas!)})` : ""}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Renglon({ v, malo }: { v: VarianteRevisada; malo: boolean }) {
  return (
    <tr>
      <td className="text-sm font-medium">{v.sku}</td>
      <td className="cifra text-xs" style={{ color: "var(--ink-2)" }}>
        {v.inventoryId ?? "—"}
      </td>
      <td className="cifra text-xs" style={{ color: "var(--ink-2)" }}>
        {v.itemId ?? "—"}
      </td>
      <td className="cifra text-sm" style={{ color: malo ? "var(--estado-critico)" : undefined }}>
        {caja(v.medida)}
        <span className="ml-1 text-[11px]" style={{ color: "var(--ink-muted)" }}>
          {v.medida ? `${Math.round(v.medida.peso)} g` : ""}
        </span>
      </td>
      <td className="cifra text-sm" style={{ color: "var(--ink-2)" }}>
        {caja(v.medidaReal)}
        <span className="ml-1 text-[11px]" style={{ color: "var(--ink-muted)" }}>
          {v.medidaReal ? `${Math.round(v.medidaReal.peso)} g` : ""}
        </span>
      </td>
      <td className="text-xs" style={{ color: "var(--ink-2)" }}>
        {v.envioGratis ? "yo" : "el comprador"}
      </td>
      <td className="num cifra text-sm" style={{ color: malo ? "var(--estado-critico)" : undefined }}>
        {pesos(v.costo)}
      </td>
      <td className="num cifra text-sm" style={{ color: "var(--ink-2)" }}>
        {pesos(v.costoNormal)}
      </td>
      <td className="num cifra text-sm" style={{ color: "var(--ink-2)" }}>
        {v.sobrecosto > 0 ? `+${pesos(v.sobrecosto)}` : "—"}
      </td>
      <td>
        <UltimosCobros real={v.envioReal} />
      </td>
      <td className="num cifra text-sm font-semibold" style={{ color: v.pagadoDeMas > 0 ? "var(--estado-critico)" : undefined }}>
        {v.conVentas ? (v.pagadoDeMas > 0 ? `+${pesos(v.pagadoDeMas)}` : "$0") : "—"}
        {v.envioReal && (
          <div className="text-[11px] font-normal" style={{ color: "var(--ink-muted)" }}>
            {v.envioReal.ordenes} ventas · {v.envioReal.comparables} comparables
          </div>
        )}
      </td>
    </tr>
  );
}

function Tabla({ variantes, malas }: { variantes: VarianteRevisada[]; malas: Set<string> }) {
  return (
    <div className="overflow-auto">
      <table className="datos">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Código Full</th>
            <th>Publicación</th>
            <th>Medida en sistema</th>
            <th>Medida real (hermanas)</th>
            <th>Paga</th>
            <th className="num">Simulador: hoy</th>
            <th className="num">Simulador: debería</th>
            <th className="num">Simulador: de más</th>
            <th>Últimos 2 cobros reales</th>
            <th className="num">Pagado de más (60 d, real)</th>
          </tr>
        </thead>
        <tbody>
          {variantes.map((v) => (
            <Renglon key={v.sku} v={v} malo={malas.has(v.sku)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CostosEnvio({
  modelos: inicial,
  evidencias: evidenciasIniciales,
}: {
  modelos: ModeloRevisado[];
  /** modelo → link público de su ficha de evidencia (la que se le manda a MELI) */
  evidencias: Record<string, string>;
}) {
  const [modelos, setModelos] = useState(inicial);
  const [evidencias, setEvidencias] = useState(evidenciasIniciales);
  const [busqueda, setBusqueda] = useState("");
  const [revisando, setRevisando] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  const conProblema = useMemo(() => modelos.filter((m) => m.malas.length > 0), [modelos]);
  const totales = useMemo(
    () => ({
      publicaciones: modelos.reduce((a, m) => a + m.variantes.length, 0),
      medidas: modelos.reduce((a, m) => a + m.variantes.filter((v) => v.medida).length, 0),
      malas: conProblema.reduce((a, m) => a + m.malas.length, 0),
      mias: conProblema.reduce(
        (a, m) => a + m.malas.filter((v) => v.envioGratis).length,
        0,
      ),
      sobrecosto: conProblema.reduce((a, m) => a + m.sobrecosto, 0),
      pagadoDeMas: conProblema.reduce((a, m) => a + m.pagadoDeMas, 0),
      conVentas: conProblema.reduce((a, m) => a + m.malas.filter((v) => v.conVentas).length, 0),
      sinCosto: modelos.reduce(
        (a, m) => a + m.variantes.filter((v) => v.medida && v.costo == null).length,
        0,
      ),
    }),
    [modelos, conProblema],
  );

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    const base = q ? modelos.filter((m) => m.modelo.toUpperCase().includes(q)) : conProblema;
    return base;
  }, [modelos, conProblema, busqueda]);

  const recargar = async () => {
    const r = await fetch("/api/costos-envio");
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error ?? "No se pudo leer la revisión.");
    setModelos(j.modelos as ModeloRevisado[]);
    setEvidencias((j.evidencias ?? {}) as Record<string, string>);
  };

  /**
   * Las fichas de evidencia: una imagen por modelo con la foto real de la
   * publicación y la tabla de lo que MELI midió en cada talla, subida a un
   * link público para pegarlo en la solicitud. Va por pasadas como la
   * revisión; las fichas que no cambiaron no se vuelven a subir.
   */
  const generarEvidencias = async () => {
    setGenerando(true);
    setError(null);
    try {
      let hechas = 0;
      for (let pasada = 0; pasada < 60; pasada++) {
        const r = await fetch("/api/costos-envio/evidencia", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? "No se pudieron generar las evidencias.");
        hechas += Number(j.generadas ?? 0);
        const faltan = Number(j.pendientes ?? 0);
        setAviso(
          faltan
            ? `Dibujando las fichas de evidencia… faltan ${faltan}`
            : `Listo: ${hechas} fichas nuevas, ${Number(j.sinCambio ?? 0)} ya estaban al día.`,
        );
        if (!faltan) break;
      }
      await recargar();
    } catch (err) {
      setError((err as Error).message);
      setAviso(null);
    } finally {
      setGenerando(false);
    }
  };

  /**
   * Revisar es releer las medidas y preguntarle los costos que falten al
   * simulador de MELI.
   *
   * Va en pasadas cortas y no en una sola petición larga: la primera versión
   * hacía todo de un tirón y el navegador cortaba la conexión a los pocos
   * minutos con un "load failed", aunque el servidor seguía trabajando bien.
   * Cada pasada avanza un pedazo, contesta cuánto falta y se guarda; si una
   * se cae, se reintenta sin perder lo andado.
   */
  const revisar = async () => {
    setRevisando(true);
    setError(null);
    let fallos = 0;

    try {
      for (let pasada = 0; pasada < 400; pasada++) {
        let respuesta: { pendientes?: number } | null = null;
        try {
          const r = await fetch("/api/costos-envio", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ medidas: true }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j?.error ?? "No se pudo revisar.");
          respuesta = j;
          fallos = 0;
        } catch (err) {
          // Un corte de red no tira la revisión: lo hecho ya está guardado.
          fallos++;
          if (fallos >= 3) throw err;
          setAviso(`Se cortó la conexión, reintentando (${fallos} de 3)…`);
          continue;
        }

        const faltan = Number(respuesta?.pendientes ?? 0);
        setAviso(
          faltan
            ? `Leyendo las medidas de MELI… faltan ${faltan.toLocaleString("es-MX")}`
            : "Actualizando la pantalla…",
        );
        // Cada tantas pasadas se refresca la tabla para ver el avance.
        if (pasada % 5 === 4) await recargar();
        if (!faltan) break;
      }

      await recargar();
      setAviso(null);
    } catch (err) {
      setError(
        `${(err as Error).message} — lo que ya se revisó quedó guardado; puedes darle otra vez.`,
      );
      setAviso(null);
    } finally {
      setRevisando(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="tarjeta p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={revisar}
            disabled={revisando}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--acento)" }}
          >
            {revisando ? "Revisando…" : "Revisar de nuevo"}
          </button>
          <a
            href="/api/costos-envio/excel?formato=meli"
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hairline"
            style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
          >
            Excel para MELI (Item ID · Site · medidas · link)
          </a>
          <button
            onClick={generarEvidencias}
            disabled={generando || revisando}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hairline disabled:opacity-60"
          >
            {generando ? "Dibujando evidencias…" : "Generar imágenes de evidencia"}
          </button>
          <a
            href="/api/costos-envio/excel"
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hairline"
          >
            Excel del caso (solo lo que está mal)
          </a>
          <a
            href="/api/costos-envio/excel?todo=1"
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hairline"
            style={{ color: "var(--ink-2)" }}
          >
            Excel del catálogo completo
          </a>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar un modelo (GT229…)"
            className="ml-auto w-56"
          />
        </div>

        <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>
          <strong className="cifra">{totales.malas}</strong> publicaciones cobran de más, en{" "}
          <strong className="cifra">{conProblema.length}</strong> modelos ·{" "}
          <span style={{ color: "var(--estado-critico)" }}>
            <strong className="cifra">{pesos(totales.pagadoDeMas)}</strong> pagados de más en los
            últimos 60 días
          </span>{" "}
          según lo que MELI cobró de verdad en cada venta (
          <span className="cifra">{totales.conVentas}</span> con ventas comparables; las otras{" "}
          <span className="cifra">{totales.malas - totales.conVentas}</span> solo las señala el
          simulador, {pesos(totales.sobrecosto)} de más por venta) · revisadas{" "}
          <span className="cifra">{totales.medidas}</span> de{" "}
          <span className="cifra">{totales.publicaciones}</span> publicaciones
          {totales.sinCosto > 0 && (
            <>
              {" "}
              · <span className="cifra">{totales.sinCosto}</span> sin costo todavía: dale a
              «Revisar de nuevo»
            </>
          )}
        </p>

        {aviso && (
          <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
            {aviso}
          </p>
        )}
        {error && (
          <p className="mt-2 text-sm" style={{ color: "var(--estado-critico)" }}>
            {error}
          </p>
        )}
      </section>

      {!filtrados.length && (
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          {busqueda
            ? `No hay ningún modelo que se llame así.`
            : totales.medidas === 0
              ? "Todavía no hay nada revisado. Dale a «Revisar de nuevo» para leer las medidas de MELI."
              : "Ninguna publicación está cobrando de más. "}
        </p>
      )}

      {filtrados.map((m) => {
        const malas = new Set(m.malas.map((v) => v.sku));
        const abierto = abiertos[m.modelo] ?? false;
        const evidencia = evidencias[m.modelo];
        return (
          <section key={m.modelo} className="tarjeta overflow-hidden">
            <header className="flex flex-wrap items-center gap-3 border-b p-4 hairline">
              <h2 className="text-base font-semibold">{m.modelo}</h2>
              <span className="text-sm" style={{ color: "var(--ink-2)" }}>
                caja real <span className="cifra">{caja(m.medidaReal)}</span> cm según{" "}
                <span className="cifra">{m.hermanas}</span> publicaciones · envío normal{" "}
                <span className="cifra">{pesos(m.costoNormal)}</span>
              </span>
              {m.malas.length > 0 && (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{ background: "var(--acento-suave)", color: "var(--estado-critico)" }}
                >
                  {m.malas.length} cobran de más ·{" "}
                  {m.pagadoDeMas > 0 ? `+${pesos(m.pagadoDeMas)} en 60 días` : `+${pesos(m.sobrecosto)} por venta (simulador)`}
                </span>
              )}
              <button
                onClick={() => setAbiertos((p) => ({ ...p, [m.modelo]: !abierto }))}
                className="ml-auto rounded-lg border px-3 py-1.5 text-xs font-medium hairline"
              >
                {abierto ? "Ver solo las malas" : `Ver las ${m.variantes.length} publicaciones`}
              </button>
              <a
                href={`/api/costos-envio/excel?todo=1&modelo=${encodeURIComponent(m.modelo)}`}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium hairline"
              >
                Excel
              </a>
              {m.medidaReal && (
                <a
                  href={evidencia ?? `/api/costos-envio/evidencia?modelo=${encodeURIComponent(m.modelo)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium hairline"
                  style={evidencia ? { borderColor: "var(--acento)", color: "var(--acento)" } : { color: "var(--ink-2)" }}
                  title={
                    evidencia
                      ? "El link público de la ficha, el que va en el Excel para MELI"
                      : "Vista previa de la ficha; el link público sale al generar las evidencias"
                  }
                >
                  {evidencia ? "Evidencia (link)" : "Evidencia (vista previa)"}
                </a>
              )}
            </header>
            <Tabla variantes={abierto ? m.variantes : m.malas} malas={malas} />
          </section>
        );
      })}
    </div>
  );
}
