"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import localFont from "next/font/local";
import { codificar128 } from "@/lib/etiquetas/code128";

// Las MISMAS letras que los PDF del paquete de la fábrica (extraídas de las
// fuentes embebidas): Roboto Condensed Bold para MELI y Open Sans Condensed
// Light para Amazon.
const fuenteMeli = localFont({ src: "../fonts/roboto-condensed-bold.ttf" });
const fuenteAmazon = localFont({ src: "../fonts/open-sans-condensed-light.ttf" });

interface Etiqueta {
  sku: string;
  codigoFull: string | null;
  fnsku: string | null;
  titulo: string | null;
  variante: string;
  cantidad: number;
  problema: string | null;
  /** Está en Amazon pero sin FNSKU: se puede ir a buscar al API. */
  faltaFnsku?: boolean;
  /** El SKU tal como está dado de alta en Amazon, que puede no ser el de MELI. */
  skuAmazon?: string | null;
}

/**
 * Qué etiquetas salen: la de MELI (código Full), la de Amazon (FNSKU) o LAS
 * DOS por par — Amazon seguida de MELI, como el paquete de la fábrica.
 */
type TipoEtiqueta = "meli" | "amazon" | "ambas";

/** Cada etiqueta física impresa es de una plataforma concreta. */
type Plataforma = "meli" | "amazon";

interface Resultado {
  sku: string;
  codigoFull: string | null;
  /** productos solo-de-Amazon (las fundas): sin código Full pero con FNSKU */
  fnsku: string | null;
  titulo: string | null;
  variante: string;
}

type Tamano = "rollo2x1" | "rollo" | "hoja";

const TAMANOS: Record<Tamano, { etiqueta: string; ancho: number; alto: number; columnas: number }> = {
  // Medidas en milímetros. El rollo de 2 × 1 pulgadas es el que se usa en la
  // bodega: va primero y es el de arranque.
  rollo2x1: { etiqueta: "Rollo térmico 2 × 1 pulgadas (50.8 × 25.4 mm)", ancho: 50.8, alto: 25.4, columnas: 1 },
  rollo: { etiqueta: "Rollo térmico 10 × 5 cm", ancho: 100, alto: 50, columnas: 1 },
  hoja: { etiqueta: "Hoja tamaño carta, 24 por hoja", ancho: 63.5, alto: 33.9, columnas: 3 },
};

/* -------------------------------------------------------------------------- */

/**
 * El código de barras, dibujado como rectángulos.
 *
 * Se dibuja en SVG y no como imagen porque esto se imprime: un vector sale
 * con filo en cualquier impresora, mientras que un mapa de bits estirado a
 * cuatro centímetros sale con los bordes lavados justo donde el escáner
 * necesita distinguir barra de espacio.
 */
function CodigoBarras({ texto, alto = 42 }: { texto: string; alto?: number }) {
  const barras = useMemo(() => {
    try {
      return codificar128(texto);
    } catch {
      return null;
    }
  }, [texto]);

  if (!barras) return null;

  const rects: { x: number; w: number }[] = [];
  let x = 0;
  let esBarra = true;
  for (const a of barras.anchos) {
    if (esBarra) rects.push({ x, w: a });
    x += a;
    esBarra = !esBarra;
  }

  return (
    <svg
      viewBox={`0 0 ${barras.modulos} ${alto}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      style={{ width: "100%", height: alto }}
      role="img"
      aria-label={`Código de barras ${texto}`}
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={0} width={r.w} height={alto} fill="#000" />
      ))}
    </svg>
  );
}

/** El código que va en las barras según la plataforma. */
function codigoDe(e: Etiqueta, tipo: Plataforma): string | null {
  return tipo === "amazon" ? e.fnsku : e.codigoFull;
}

/** ¿Este SKU tiene con qué imprimirse en el modo elegido? */
function imprimible(e: Etiqueta, tipo: TipoEtiqueta): boolean {
  if (tipo === "ambas") return Boolean(e.fnsku || e.codigoFull);
  return Boolean(codigoDe(e, tipo));
}

/**
 * Una etiqueta física, CALCADA de las plantillas de 2 × 1 del paquete de la
 * fábrica — las mismas del PDF y el TXT: barras arriba, código en negritas,
 * título en dos líneas, variante y SKU (MELI), o barras del FNSKU, FNSKU
 * centrado, "NEW - título" y SKU (Amazon). Los otros tamaños son la misma
 * plantilla escalada, para que pantalla, navegador y térmica digan lo mismo.
 */
function Etiqueta({ e, tamano, tipo }: { e: Etiqueta; tamano: Tamano; tipo: Plataforma }) {
  const codigo = codigoDe(e, tipo);
  const t = TAMANOS[tamano];
  // 50.8 mm es el 2 × 1 real: ahí la escala es 1 y los puntos son los del PDF.
  const esc = t.ancho / 50.8;
  const pt = (n: number) => `${(n * esc).toFixed(2)}pt`;
  const px = (n: number) => Math.max(6, Math.round(n * esc * (96 / 72)));

  const fraccionBarras = useMemo(() => {
    if (!codigo) return 0;
    try {
      // Módulo de 2 dots sobre los 406 dots de ancho de la etiqueta.
      return Math.min(0.88, (codificar128(codigo).modulos * 2) / 406);
    } catch {
      return 0;
    }
  }, [codigo]);

  const caja: React.CSSProperties = {
    width: `${t.ancho}mm`,
    height: `${t.alto}mm`,
    border: "1px solid #ddd",
    background: "#fff",
    color: "#000",
    overflow: "hidden",
    boxSizing: "border-box",
    breakInside: "avoid",
  };

  if (!codigo || !fraccionBarras) {
    return (
      <div
        className="etiqueta"
        style={{ ...caja, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <span style={{ fontSize: pt(7), color: "#a00" }}>
          {tipo === "amazon" ? "Sin FNSKU" : "Sin código Full"} · {e.sku}
        </span>
      </div>
    );
  }

  if (tipo === "amazon") {
    return (
      <div className={`etiqueta ${fuenteAmazon.className}`} style={caja}>
        <div style={{ marginTop: pt(6.7), marginLeft: "9.9%", width: `${fraccionBarras * 100}%` }}>
          <CodigoBarras texto={codigo} alto={px(17.7)} />
        </div>
        <div
          style={{
            marginLeft: "17.2%",
            width: "54.2%",
            textAlign: "center",
            fontSize: pt(8.5),
            lineHeight: 1.05,
            marginTop: pt(0.8),
          }}
        >
          {codigo}
        </div>
        <div
          style={{
            marginLeft: "7.4%",
            width: "74%",
            fontSize: pt(6.4),
            lineHeight: 1.44,
            marginTop: pt(1.4),
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {`NEW - ${(e.titulo ?? e.sku).slice(0, 55)}`}
        </div>
        <div style={{ marginLeft: "7.4%", fontSize: pt(5.7), marginTop: pt(1.4) }}>
          SKU: {e.sku}
        </div>
      </div>
    );
  }

  return (
    <div className={`etiqueta ${fuenteMeli.className}`} style={caja}>
      <div style={{ marginTop: pt(6.4), marginLeft: "6.2%", width: `${fraccionBarras * 100}%` }}>
        <CodigoBarras texto={codigo} alto={px(16)} />
      </div>
      <div style={{ marginLeft: "26.8%", fontSize: pt(7.8), lineHeight: 1, marginTop: pt(1.6) }}>
        {codigo}
      </div>
      <div
        style={{
          marginLeft: "5.4%",
          width: "74%",
          fontSize: pt(6.4),
          lineHeight: 1,
          marginTop: pt(2.2),
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {(e.titulo ?? e.sku).slice(0, 60)}
      </div>
      <div style={{ marginLeft: "5.4%", fontSize: pt(6.4), lineHeight: 1, marginTop: pt(1) }}>
        {e.variante}
      </div>
      <div style={{ marginLeft: "5.4%", fontSize: pt(6.4), lineHeight: 1, marginTop: pt(1.4) }}>
        SKU: {e.sku}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Generador de etiquetas.
 *
 * La primera vez que se manda un producto a Full, la etiqueta la da Mercado
 * Libre en un archivo. De ahí en adelante ya no hace falta: el código Full, el
 * título y la variante viven en el catálogo que este sistema sincroniza, así
 * que basta decir qué SKU y cuántas.
 */
export function Etiquetas({ sugeridas }: { sugeridas: { sku: string; cantidad: number }[] }) {
  const [lista, setLista] = useState<Etiqueta[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [pegado, setPegado] = useState("");
  const [tamano, setTamano] = useState<Tamano>("rollo2x1");
  const [tipo, setTipo] = useState<TipoEtiqueta>("meli");
  const [cargando, setCargando] = useState(false);
  const [buscandoFnskus, setBuscandoFnskus] = useState(false);
  const [avisoFnskus, setAvisoFnskus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Búsqueda con freno: no tiene caso pegarle a la base en cada tecla.
  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    const q = busqueda.trim();
    if (q.length < 2) {
      setResultados([]);
      return;
    }
    temporizador.current = setTimeout(() => {
      fetch(`/api/etiquetas?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((j) => setResultados(j.resultados ?? []))
        .catch(() => setResultados([]));
    }, 250);
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [busqueda]);

  async function resolver(skus: { sku: string; cantidad: number }[]) {
    if (!skus.length) return;
    setCargando(true);
    setError(null);
    try {
      const r = await fetch("/api/etiquetas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudo armar la etiqueta.");

      setLista((prev) => {
        const mapa = new Map(prev.map((e) => [e.sku, { ...e }]));
        for (const e of j.etiquetas as Etiqueta[]) {
          const ya = mapa.get(e.sku);
          if (ya) ya.cantidad += e.cantidad;
          else mapa.set(e.sku, e);
        }
        return [...mapa.values()];
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  /**
   * Le pregunta a Amazon el FNSKU de los que están en su catálogo pero no lo
   * tienen, y vuelve a armar la lista con lo que haya contestado.
   *
   * No se puede usar `resolver`: esa SUMA cantidades (es la de agregar), y
   * aquí se está reemplazando lo mismo que ya está en pantalla.
   */
  async function buscarFnskus() {
    // Se pregunta por el SKU tal como está en Amazon: el de MELI puede traer
    // el sufijo del sitio o los pedazos en otro orden, y el API no lo conoce.
    const pendientes = lista.filter((e) => e.faltaFnsku).map((e) => e.skuAmazon ?? e.sku);
    if (!pendientes.length || buscandoFnskus) return;

    setBuscandoFnskus(true);
    setAvisoFnskus(null);
    setError(null);
    try {
      const r = await fetch("/api/amazon/fnskus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: pendientes }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Amazon no contestó.");

      const rr = await fetch("/api/etiquetas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: lista.map((e) => ({ sku: e.sku, cantidad: e.cantidad })) }),
      });
      const jj = await rr.json();
      if (rr.ok && Array.isArray(jj.etiquetas)) setLista(jj.etiquetas as Etiqueta[]);

      setAvisoFnskus(
        j.resueltos
          ? `Amazon contestó el FNSKU de ${j.resueltos} de ${pendientes.length}.`
          : "Amazon no tiene FNSKU para ninguno de estos: nunca entraron a FBA.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuscandoFnskus(false);
    }
  }

  function agregarPegado() {
    // Acepta "SKU 12", "SKU,12", "SKU<tab>12" y también solo el SKU (una).
    const filas = pegado
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const partes = l.split(/[\t,;]+|\s{2,}|\s+(?=\d+$)/).filter(Boolean);
        const sku = partes[0] ?? "";
        const cantidad = Number(partes[1] ?? 1) || 1;
        return { sku, cantidad };
      })
      .filter((x) => x.sku);

    if (!filas.length) {
      setError("No encontré ningún SKU en lo que pegaste.");
      return;
    }
    setPegado("");
    resolver(filas);
  }

  const total = lista.reduce((a, e) => a + e.cantidad, 0);
  const conProblema = lista.filter((e) => e.problema).length;
  const faltanFnskus = lista.filter((e) => e.faltaFnsku).length;
  const [descargando, setDescargando] = useState<"zpl" | "pdf" | null>(null);

  // TXT (ZPL) y PDF con el formato de las "Etiquetas de producto" de MELI.
  const descargar = async (formato: "zpl" | "pdf") => {
    if (descargando) return;
    setDescargando(formato);
    setError(null);
    try {
      const r = await fetch(`/api/etiquetas/${formato}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          skus: lista
            .filter((e) => imprimible(e, tipo))
            .map((e) => ({ sku: e.sku, cantidad: e.cantidad })),
        }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "No se pudo generar.");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const sufijo = tipo === "meli" ? "" : `-${tipo}`;
      a.download = formato === "zpl" ? `etiquetas${sufijo}.txt` : `etiquetas${sufijo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDescargando(null);
    }
  };

  // Cada etiqueta se repite tantas veces como pida su cantidad. En "las dos"
  // cada copia sale en PAR: la de Amazon y en seguida la de MELI.
  const impresas: { e: Etiqueta; plataforma: Plataforma }[] = lista.flatMap((e) => {
    const unidades: { e: Etiqueta; plataforma: Plataforma }[] = [];
    for (let i = 0; i < e.cantidad; i++) {
      if (tipo === "ambas") {
        if (e.fnsku) unidades.push({ e, plataforma: "amazon" });
        if (e.codigoFull) unidades.push({ e, plataforma: "meli" });
      } else if (codigoDe(e, tipo)) {
        unidades.push({ e, plataforma: tipo });
      }
    }
    return unidades;
  });

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Cómo agregar ------------------------------------------------- */}
      <section className="tarjeta p-4 no-imprimir">
        <h2 className="text-sm font-semibold">Qué etiquetas necesitas</h2>

        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm" style={{ color: "var(--ink-2)" }}>
              Buscar por SKU o título
            </label>
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="GT104-BLK-27, «sandalia» o una funda (499…)"
              className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            />

            {resultados.length ? (
              <ul
                className="mt-2 max-h-56 overflow-auto rounded-lg border"
                style={{ borderColor: "var(--borde)" }}
              >
                {resultados.map((r) => (
                  <li key={r.sku}>
                    <button
                      onClick={() => {
                        resolver([{ sku: r.sku, cantidad: 1 }]);
                        setBusqueda("");
                      }}
                      className="w-full px-2 py-1.5 text-left text-sm hover:opacity-80"
                    >
                      <span className="font-medium">{r.sku}</span>
                      <span style={{ color: "var(--ink-muted)" }}>
                        {r.codigoFull
                          ? ` · ${r.codigoFull}`
                          : r.fnsku
                            ? ` · Amazon · FNSKU ${r.fnsku}`
                            : " · sin código Full"}
                      </span>
                      <div className="truncate text-xs" style={{ color: "var(--ink-2)" }}>
                        {r.titulo}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            <label className="text-sm" style={{ color: "var(--ink-2)" }}>
              O pega una lista: un SKU por renglón, y al lado cuántas etiquetas
            </label>
            <textarea
              value={pegado}
              onChange={(e) => setPegado(e.target.value)}
              rows={5}
              placeholder={"GT104-BLK-27-MX\t48\nGT204-PINK-23-MX\t24"}
              className="mt-1 w-full rounded-lg border px-2 py-1.5 font-mono text-xs"
              style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
            />
            <button
              onClick={agregarPegado}
              disabled={cargando || !pegado.trim()}
              className="mt-2 rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--acento)" }}
            >
              Agregar la lista
            </button>
          </div>
        </div>

        {sugeridas.length ? (
          <div className="mt-4 border-t pt-3 hairline">
            <button
              onClick={() => resolver(sugeridas)}
              disabled={cargando}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium"
              style={{ borderColor: "var(--borde)" }}
            >
              Traer las {sugeridas.length} SKUs del envío que está planeado
            </button>
            <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
              Toma el plan de envío a Full de hoy y pide una etiqueta por par de cada
              SKU que va en las cajas.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
            {error}
          </p>
        ) : null}
      </section>

      {/* ---- Lo que se va a imprimir --------------------------------------- */}
      {lista.length ? (
        <section className="tarjeta overflow-hidden no-imprimir">
          <header className="flex flex-wrap items-center gap-3 border-b p-3 hairline">
            <h2 className="text-sm font-semibold">
              {total} etiquetas de {lista.length} SKUs
            </h2>

            <label className="ml-auto flex items-center gap-2 text-sm">
              <span style={{ color: "var(--ink-2)" }}>Etiqueta</span>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoEtiqueta)}
                className="rounded-lg border px-2 py-1 text-sm"
                style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
              >
                <option value="meli">Mercado Libre (código Full)</option>
                <option value="amazon">Amazon (FNSKU)</option>
                <option value="ambas">Los dos (Amazon + MELI por par)</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <span style={{ color: "var(--ink-2)" }}>Tamaño</span>
              <select
                value={tamano}
                onChange={(e) => setTamano(e.target.value as Tamano)}
                className="rounded-lg border px-2 py-1 text-sm"
                style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
              >
                {Object.entries(TAMANOS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.etiqueta}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={() => setLista([])}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium"
              style={{ borderColor: "var(--borde)" }}
            >
              Vaciar
            </button>
            <button
              onClick={() => descargar("pdf")}
              disabled={!impresas.length || descargando !== null}
              className="rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--acento)" }}
            >
              {descargando === "pdf" ? "Generando…" : "PDF"}
            </button>
            <button
              onClick={() => descargar("zpl")}
              disabled={!impresas.length || descargando !== null}
              className="rounded-lg border px-4 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
            >
              {descargando === "zpl" ? "Generando…" : "TXT (ZPL)"}
            </button>
            <button
              onClick={() => window.print()}
              disabled={!impresas.length}
              className="rounded-lg border px-4 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: "var(--borde)" }}
            >
              Imprimir
            </button>
          </header>

          <table className="datos">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Código Full</th>
                <th>FNSKU</th>
                <th>Título</th>
                <th>Variante</th>
                <th className="num">Etiquetas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.sku}>
                  <td className="font-medium">{e.sku}</td>
                  <td className="cifra">
                    {e.codigoFull ?? (
                      <span style={{ color: "var(--estado-critico)" }}>—</span>
                    )}
                  </td>
                  <td className="cifra">
                    {e.fnsku ?? <span style={{ color: "var(--ink-muted)" }}>—</span>}
                  </td>
                  <td
                    className="max-w-72 truncate text-xs"
                    style={{ color: "var(--ink-2)" }}
                    title={e.titulo ?? ""}
                  >
                    {e.titulo ?? "—"}
                  </td>
                  <td className="text-xs">{e.variante || "—"}</td>
                  <td className="num">
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={e.cantidad}
                      onChange={(ev) =>
                        setLista((l) =>
                          l.map((x) =>
                            x.sku === e.sku
                              ? {
                                  ...x,
                                  cantidad: Math.max(
                                    1,
                                    Math.min(999, Number(ev.target.value) || 1),
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      className="cifra w-20 rounded-lg border px-2 py-1 text-right text-sm"
                      style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
                    />
                  </td>
                  <td>
                    <button
                      onClick={() => setLista((l) => l.filter((x) => x.sku !== e.sku))}
                      className="text-sm"
                      style={{ color: "var(--ink-muted)" }}
                      aria-label={`Quitar ${e.sku}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {conProblema || faltanFnskus ? (
            <div className="border-t p-3 text-sm hairline">
              {lista
                .filter((e) => e.problema)
                .map((e) => (
                  <p key={e.sku} style={{ color: "var(--estado-alerta)" }}>
                    <strong>{e.sku}</strong>: {e.problema}
                  </p>
                ))}

              {/* Lo único que se arregla desde aquí: preguntarle el FNSKU al
                  API de inventario de Amazon. El reporte diario solo trae los
                  listings con existencias, así que todo lo agotado o pausado
                  en FBA llega sin él. */}
              {faltanFnskus ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 no-imprimir">
                  <button
                    onClick={buscarFnskus}
                    disabled={buscandoFnskus}
                    className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    style={{ borderColor: "var(--acento)", color: "var(--acento)" }}
                  >
                    {buscandoFnskus
                      ? "Preguntando a Amazon…"
                      : `Buscar FNSKU en Amazon (${faltanFnskus})`}
                  </button>
                  {avisoFnskus ? (
                    <span style={{ color: "var(--ink-2)" }}>{avisoFnskus}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ---- La hoja de impresión ------------------------------------------ */}
      {impresas.length ? (
        <section className="tarjeta p-4">
          <h2 className="text-sm font-semibold no-imprimir">
            Así se van a ver ({TAMANOS[tamano].etiqueta})
          </h2>

          <div
            className={`hoja-etiquetas mt-3 ${tamano !== "hoja" ? "modo-rollo" : ""}`}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${TAMANOS[tamano].columnas}, ${TAMANOS[tamano].ancho}mm)`,
              gap: tamano === "hoja" ? "0mm" : "2mm",
              justifyContent: "start",
            }}
          >
            {impresas.map((x, i) => (
              <Etiqueta key={`${x.e.sku}-${x.plataforma}-${i}`} e={x.e} tamano={tamano} tipo={x.plataforma} />
            ))}
          </div>
        </section>
      ) : null}

    </div>
  );
}
