"use client";

import { useEffect, useMemo, useState } from "react";
import { mensajeDeSeleccion, type Eleccion, type ProductoInfluencer } from "@/lib/influencers";
import { pesos } from "@/lib/tienda";
import { categoriaVisible, rangoTallas, tituloCorto } from "@/lib/catalogo-vista";

const LLAVE = "getac:creadores:seleccion";

const clave = (e: Pick<Eleccion, "productId" | "color">) => `${e.productId}|${e.color}`;

const cat = (p: ProductoInfluencer) => categoriaVisible(p.categoria) ?? "";

function sinAcentos(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function Tarjeta({
  p,
  elegidos,
  alternar,
  cambiarTalla,
  mostrarExistencia,
  mostrarCategoria,
}: {
  p: ProductoInfluencer;
  elegidos: Map<string, Eleccion>;
  alternar: (e: Eleccion) => void;
  cambiarTalla: (k: string, talla: string | null) => void;
  mostrarExistencia: boolean;
  /** la categoría en la tarjeta: sobra cuando ya va en el título de la sección */
  mostrarCategoria: boolean;
}) {
  const [color, setColor] = useState(0);
  const [foto, setFoto] = useState(0);
  const c = p.colores[color];
  const k = clave({ productId: p.productId, color: c.color });
  const elegido = elegidos.get(k);
  const precio =
    p.precioDesde == null ? null : p.precioDesde === p.precioHasta ? pesos(p.precioDesde) : `${pesos(p.precioDesde)} – ${pesos(p.precioHasta!)}`;
  const titulo = tituloCorto(p.titulo);

  return (
    <article className={`tarjeta creador ${elegido ? "creador-elegido" : ""}`}>
      <div className="creador-foto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {c.fotos[foto] && <img src={c.fotos[foto]} alt={`${p.modelo ?? ""} ${titulo} ${c.color}`.trim()} loading="lazy" />}
        {p.total != null ? (
          <span className={`creador-stock ${p.total > 0 ? "" : "creador-stock-sin"}`}>
            {p.total > 0 ? `${p.total.toLocaleString("es-MX")} pares` : "Sin stock"}
          </span>
        ) : null}
        {elegido && <span className="creador-marca">✓ Elegido</span>}
        {c.fotos.length > 1 && (
          <div className="creador-fotos" aria-label="Más fotos">
            {c.fotos.map((f, i) => (
              <button key={f} type="button" onClick={() => setFoto(i)} aria-current={i === foto} aria-label={`Foto ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="creador-cuerpo">
        <div className="creador-cabeza">
          {p.modelo && <span className="modelo creador-modelo">{p.modelo}</span>}
          {precio && <span className="creador-precio">{precio}</span>}
        </div>
        <p className="creador-titulo" title={titulo}>
          {titulo}
        </p>
        {mostrarCategoria && p.categoria && <span className="creador-dato">{categoriaVisible(p.categoria)}</span>}

        <div className="creador-color">
          <span className="creador-etiqueta">
            Color <strong>{c.color}</strong>
            {p.colores.length > 1 ? <span className="suave"> · {p.colores.length} colores</span> : null}
          </span>
          {p.colores.length > 1 && (
            <div className="creador-colores" role="group" aria-label="Color">
              {p.colores.map((x, i) => (
                <button
                  key={`${x.color}-${i}`}
                  type="button"
                  className="filtro"
                  aria-current={i === color}
                  onClick={() => {
                    setColor(i);
                    setFoto(0);
                  }}
                >
                  {elegidos.has(clave({ productId: p.productId, color: x.color })) ? "✓ " : ""}
                  {x.color}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="creador-etiqueta">
          Tallas <strong>{rangoTallas(c.tallas)}</strong>
          {mostrarExistencia && (c.tallasConStock.length ? <span className="suave"> · hay {c.tallasConStock.join(", ")}</span> : <span className="suave"> · sin existencia hoy</span>)}
        </span>

        <div className="creador-pie">
          {elegido && (
            <label className="campo creador-talla">
              <span>Tu talla</span>
              <select value={elegido.talla ?? ""} onChange={(e) => cambiarTalla(k, e.target.value || null)}>
                <option value="">Sin talla</option>
                {c.tallas.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className={`boton boton-ancho ${elegido ? "" : "boton-comprar"}`}
            onClick={() => alternar({ productId: p.productId, modelo: p.modelo, titulo: p.titulo, color: c.color, talla: null })}
          >
            {elegido ? "Quitar de mi selección" : "Elegir este color"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function CatalogoInfluencers({
  productos,
  whatsapp,
  porCategoria = false,
  mostrarExistencia = true,
  llave = LLAVE,
}: {
  productos: ProductoInfluencer[];
  whatsapp: string | null;
  /** una sección por categoría (el catálogo completo) */
  porCategoria?: boolean;
  /** tallas con existencia hoy (el catálogo completo de Amazon no la tiene) */
  mostrarExistencia?: boolean;
  /** dónde se recuerda la selección en el navegador */
  llave?: string;
}) {
  const [categoria, setCategoria] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [elegidos, setElegidos] = useState<Map<string, Eleccion>>(new Map());
  const [quien, setQuien] = useState("");
  const [abierta, setAbierta] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // La selección se recuerda en este navegador (si se puede).
  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(llave) ?? "null");
      if (g?.elegidos) setElegidos(new Map((g.elegidos as Eleccion[]).map((e) => [clave(e), e])));
      if (g?.quien) setQuien(String(g.quien));
    } catch {
      /* sin almacenamiento: empieza vacía */
    }
  }, [llave]);
  useEffect(() => {
    try {
      localStorage.setItem(llave, JSON.stringify({ elegidos: [...elegidos.values()], quien }));
    } catch {
      /* sin almacenamiento */
    }
  }, [elegidos, quien, llave]);

  // Las categorías se agrupan sin importar mayúsculas («Botas lluvia» = «BOTAS LLUVIA»); «OTROS» al final.
  const cuantos = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of productos) m.set(cat(p), (m.get(cat(p)) ?? 0) + 1);
    return m;
  }, [productos]);
  const categorias = useMemo(
    () =>
      [...cuantos.keys()]
        .filter(Boolean)
        .sort((a, b) => Number(a === "OTROS") - Number(b === "OTROS") || a.localeCompare(b, "es")),
    [cuantos],
  );
  const palabras = sinAcentos(busca).split(/[\s-]+/).filter(Boolean);
  const visibles = productos.filter((p) => {
    if (categoria && cat(p) !== categoria) return false;
    const texto = sinAcentos(`${p.modelo ?? ""} ${p.titulo} ${p.colores.map((c) => c.color).join(" ")}`);
    return palabras.every((w) => texto.includes(w));
  });

  const lista = [...elegidos.values()];
  const url = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
  const mensaje = mensajeDeSeleccion(quien, lista, url);

  function elegirCategoria(c: string | null) {
    setCategoria(c);
    const barra = document.querySelector(".creador-herramientas");
    if (barra && barra.getBoundingClientRect().top <= 61) {
      window.scrollTo({ top: window.scrollY + barra.getBoundingClientRect().top - 60, behavior: "smooth" });
    }
  }

  function alternar(e: Eleccion) {
    setElegidos((m) => {
      const n = new Map(m);
      if (n.has(clave(e))) n.delete(clave(e));
      else n.set(clave(e), e);
      return n;
    });
  }
  function cambiarTalla(k: string, talla: string | null) {
    setElegidos((m) => {
      const e = m.get(k);
      if (!e) return m;
      return new Map(m).set(k, { ...e, talla });
    });
  }
  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* el navegador no dejó copiar */
    }
  }

  return (
    <>
      <div className="creador-herramientas">
        <label className="creador-busca">
          <span className="sr">Buscar</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
            <circle cx="8.5" cy="8.5" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="m13 13 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input type="search" placeholder="Buscar modelo o color (gt134 negro)" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        {categorias.length > 1 && (
          <nav className="creador-categorias" aria-label="Categorías">
            <button type="button" className="filtro" aria-current={!categoria} onClick={() => elegirCategoria(null)}>
              Todas <span className="creador-cuenta">{productos.length}</span>
            </button>
            {categorias.map((c) => (
              <button key={c} type="button" className="filtro" aria-current={categoria === c} onClick={() => elegirCategoria(c)}>
                {c} <span className="creador-cuenta">{cuantos.get(c)}</span>
              </button>
            ))}
          </nav>
        )}
      </div>

      {visibles.length ? (
        porCategoria ? (
          (categoria ? [categoria] : [...categorias, ...(visibles.some((p) => !cat(p)) ? [""] : [])]).map((c) => {
            const suyos = visibles.filter((p) => cat(p) === c);
            if (!suyos.length) return null;
            return (
              <section key={c || "sin"} className="creador-seccion" aria-label={c || "OTROS"}>
                <header className="creador-seccion-cabeza">
                  <h2>{c || "OTROS"}</h2>
                  <span className="mono suave">
                    {suyos.length} {suyos.length === 1 ? "modelo" : "modelos"}
                  </span>
                </header>
                <div className="rejilla creador-rejilla">
                  {suyos.map((p) => (
                    <Tarjeta key={p.productId} p={p} elegidos={elegidos} alternar={alternar} cambiarTalla={cambiarTalla} mostrarExistencia={mostrarExistencia} mostrarCategoria={false} />
                  ))}
                </div>
              </section>
            );
          })
        ) : (
          <div className="rejilla creador-rejilla">
            {visibles.map((p) => (
              <Tarjeta key={p.productId} p={p} elegidos={elegidos} alternar={alternar} cambiarTalla={cambiarTalla} mostrarExistencia={mostrarExistencia} mostrarCategoria />
            ))}
          </div>
        )
      ) : (
        <p className="nota creador-vacio">Nada coincide con la búsqueda.</p>
      )}

      {lista.length > 0 && (
        <aside className="creador-barra" aria-label="Tu selección">
          <div className="contenedor creador-barra-in">
            {abierta && (
              <div className="creador-panel">
                <ol>
                  {lista.map((e) => (
                    <li key={clave(e)}>
                      <span>
                        {e.modelo ? <span className="modelo">{e.modelo}</span> : e.titulo} · {e.color}
                        {e.talla ? ` · talla ${e.talla}` : " · sin talla"}
                      </span>
                      <button type="button" className="enlace" onClick={() => alternar(e)}>
                        Quitar
                      </button>
                    </li>
                  ))}
                </ol>
                <label className="campo">
                  <span>Tu nombre o usuario de TikTok</span>
                  <input value={quien} onChange={(e) => setQuien(e.target.value)} placeholder="@tuusuario" />
                </label>
                <div className="creador-acciones">
                  <a
                    className="boton boton-comprar"
                    href={`https://wa.me/${whatsapp ?? ""}?text=${encodeURIComponent(mensaje)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Enviar por WhatsApp
                  </a>
                  <button type="button" className="boton" onClick={copiar}>
                    {copiado ? "¡Copiado!" : "Copiar selección"}
                  </button>
                </div>
              </div>
            )}
            <button type="button" className="boton boton-ancho" onClick={() => setAbierta((a) => !a)} aria-expanded={abierta}>
              {abierta ? "Ocultar" : "Ver"} mi selección ({lista.length})
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
