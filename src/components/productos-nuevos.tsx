"use client";

import { useEffect, useMemo, useState } from "react";

interface Producto {
  clave: string;
  modelo: string;
  color: string;
  pedidos: { pedido: string; estado: string; cajas: number; pares: number }[];
  cajas: number;
  pares: number;
  enBodega: number;
  meli: { publicaciones: { sku: string; itemId: string | null; variationId: string | null }[] };
  amazon: { skus: string[]; asins: string[] };
}

interface Fotos {
  clave: string;
  meli: { fotos: number | null; itemId: string | null; estado: string | null };
  amazon: { fotos: number | null; asin: string | null };
}

const ETIQUETA_PEDIDO: Record<string, string> = {
  creado: "sin embarcar",
  con_contenedor: "parcial",
  en_transito: "en tránsito",
  recibido: "recibido",
};

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * La tabla de productos nuevos con el semáforo de fotos. La lista viene del
 * servidor; las fotos se preguntan a MELI y Amazon al abrir la página y se
 * pueden volver a revisar con un botón.
 */
export function ProductosNuevos({
  productos,
  fotosMinimas,
  amazonConectado,
}: {
  productos: Producto[];
  fotosMinimas: number;
  amazonConectado: boolean;
}) {
  const [fotos, setFotos] = useState<Map<string, Fotos> | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [soloConFalta, setSoloConFalta] = useState(false);

  const [resumenRevision, setResumenRevision] = useState<string | null>(null);

  // Lo ya revisado con fotos completas viene guardado; por defecto solo se
  // le pregunta a MELI y Amazon por lo que falta. `todo` revisa todo de nuevo.
  async function revisar(todo = false) {
    setRevisando(true);
    setError(null);
    try {
      const r = await fetch(`/api/pedidos/nuevos/fotos${todo ? "?todo=1" : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "No se pudieron revisar las fotos.");
      setFotos(new Map((j.productos as Fotos[]).map((f) => [f.clave, f])));
      setErrores(j.errores ?? []);
      setResumenRevision(
        typeof j.revisados === "number"
          ? `${j.revisados} revisados ahora · ${j.guardados} ya guardados con sus fotos`
          : null,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRevisando(false);
    }
  }

  useEffect(() => {
    if (productos.length) revisar();
    // Solo al abrir: el botón vuelve a preguntar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filas = useMemo(() => {
    const filtro = busqueda.trim().toUpperCase();
    return productos
      .map((p) => {
        const f = fotos?.get(p.clave);
        const publicadoMeli = p.meli.publicaciones.length > 0;
        const publicadoAmz = p.amazon.skus.length > 0;
        const fotosMeli = f?.meli.fotos ?? null;
        const fotosAmz = f?.amazon.fotos ?? null;
        const faltaMeli = !publicadoMeli || (fotosMeli != null && fotosMeli < fotosMinimas);
        const faltaAmz = amazonConectado && (!publicadoAmz || (fotosAmz != null && fotosAmz < fotosMinimas));
        return { p, f, publicadoMeli, publicadoAmz, fotosMeli, fotosAmz, faltaMeli, faltaAmz };
      })
      .filter((x) => {
        if (soloConFalta && !(x.faltaMeli || x.faltaAmz)) return false;
        if (!filtro) return true;
        return `${x.p.modelo} ${x.p.color} ${x.p.pedidos.map((q) => q.pedido).join(" ")}`
          .toUpperCase()
          .includes(filtro);
      });
  }, [productos, fotos, busqueda, soloConFalta, fotosMinimas, amazonConectado]);

  if (!productos.length) {
    return (
      <section className="tarjeta p-6 text-center">
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          No hay productos nuevos: todo lo que viene en los pedidos ya ha tenido stock
          en Full o en FBA alguna vez.
        </p>
      </section>
    );
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b p-3 hairline">
        <h2 className="text-sm font-semibold">
          Productos nuevos
          <span className="ml-2 cifra font-normal" style={{ color: "var(--ink-muted)" }}>
            {filas.length === productos.length ? productos.length : `${filas.length} de ${productos.length}`}
          </span>
        </h2>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar modelo, color o pedido…"
          className="min-w-56 flex-1 rounded-lg border px-3 py-1.5 text-sm md:max-w-sm"
          style={{ borderColor: "var(--borde)", background: "var(--surface-2)" }}
        />
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-2)" }}>
          <input type="checkbox" checked={soloConFalta} onChange={(e) => setSoloConFalta(e.target.checked)} />
          Solo con algo que falta
        </label>
        {resumenRevision ? (
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {resumenRevision}
          </span>
        ) : null}
        <button
          onClick={() => revisar(false)}
          disabled={revisando}
          className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--borde)" }}
        >
          {revisando ? "Revisando fotos…" : "Revisar lo que falta"}
        </button>
        <button
          onClick={() => revisar(true)}
          disabled={revisando}
          className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--borde)" }}
          title="Vuelve a preguntar a MELI y Amazon por todos, también los que ya tienen fotos"
        >
          Revisar todo de nuevo
        </button>
      </header>

      {error ? (
        <p className="px-3 pt-3 text-sm" style={{ color: "var(--estado-critico)" }}>
          {error}
        </p>
      ) : null}
      {errores.map((e, i) => (
        <p key={i} className="px-3 pt-2 text-xs" style={{ color: "var(--estado-alerta)" }}>
          {e}
        </p>
      ))}

      <div className="overflow-auto">
        <table className="datos">
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Color</th>
              <th>Pedidos</th>
              <th className="num">Cajas</th>
              <th className="num">Pares</th>
              <th>Dónde está</th>
              <th>MELI</th>
              <th>Amazon</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ p, f, publicadoMeli, publicadoAmz, fotosMeli, fotosAmz, faltaMeli, faltaAmz }) => (
              <tr key={p.clave}>
                <td className="font-medium">{p.modelo}</td>
                <td>{p.color || "—"}</td>
                <td className="text-xs">
                  {p.pedidos.map((q) => (
                    <div key={q.pedido}>
                      <span className="font-medium">{q.pedido}</span>{" "}
                      <span style={{ color: "var(--ink-muted)" }}>
                        {n(q.cajas)} cajas · {ETIQUETA_PEDIDO[q.estado] ?? q.estado}
                      </span>
                    </div>
                  ))}
                </td>
                <td className="num cifra">{n(p.cajas)}</td>
                <td className="num cifra">{n(p.pares)}</td>
                <td className="text-xs">
                  {p.enBodega > 0 ? (
                    <span style={{ color: "var(--exito-texto)" }}>Ya en bodega ({n(p.enBodega)} cajas)</span>
                  ) : (
                    <span style={{ color: "var(--ink-2)" }}>En camino</span>
                  )}
                </td>
                <td>
                  <Semaforo
                    publicado={publicadoMeli}
                    fotos={fotosMeli}
                    cargando={revisando && !f}
                    minimas={fotosMinimas}
                    link={f?.meli.itemId ? `https://articulo.mercadolibre.com.mx/${f.meli.itemId.replace(/^(MLM)(\d+)$/, "$1-$2")}` : null}
                    nota={f?.meli.estado && f.meli.estado !== "active" ? f.meli.estado : null}
                  />
                </td>
                <td>
                  {amazonConectado ? (
                    <Semaforo
                      publicado={publicadoAmz}
                      fotos={fotosAmz}
                      cargando={revisando && !f}
                      minimas={fotosMinimas}
                      link={f?.amazon.asin ? `https://www.amazon.com.mx/dp/${f.amazon.asin}` : null}
                      nota={null}
                    />
                  ) : (
                    <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      Amazon no conectado
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filas.length ? (
          <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
            Ningún producto coincide con el filtro.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Semaforo({
  publicado,
  fotos,
  cargando,
  minimas,
  link,
  nota,
}: {
  publicado: boolean;
  fotos: number | null;
  cargando: boolean;
  minimas: number;
  link: string | null;
  nota: string | null;
}) {
  let texto: string;
  let color: string;
  if (!publicado) {
    texto = "Sin publicar";
    color = "var(--estado-critico)";
  } else if (fotos == null) {
    texto = cargando ? "Revisando…" : "Publicado · fotos sin revisar";
    color = "var(--ink-muted)";
  } else if (fotos < minimas) {
    texto = fotos === 0 ? "Sin fotos" : `Faltan fotos (${fotos})`;
    color = "var(--estado-critico)";
  } else {
    texto = `${fotos} fotos`;
    color = "var(--exito-texto)";
  }
  return (
    <div>
      <span
        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{ background: `color-mix(in oklab, ${color} 15%, transparent)`, color }}
      >
        {texto}
      </span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="ml-1.5 text-[11px] underline"
          style={{ color: "var(--acento)" }}
        >
          ver
        </a>
      ) : null}
      {nota ? (
        <div className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
          {nota}
        </div>
      ) : null}
    </div>
  );
}
