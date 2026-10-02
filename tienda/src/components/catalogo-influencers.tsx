"use client";

import { useEffect, useMemo, useState } from "react";
import { mensajeDeSeleccion, type Eleccion, type ProductoInfluencer } from "@/lib/influencers";
import { pesos } from "@/lib/tienda";

const LLAVE = "getac:creadores:seleccion";
type Estado = "todos" | "activos" | "inactivos";

const clave = (e: Pick<Eleccion, "productId" | "color">) => `${e.productId}|${e.color}`;

function sinAcentos(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function Tarjeta({
  p,
  elegidos,
  alternar,
  cambiarTalla,
}: {
  p: ProductoInfluencer;
  elegidos: Map<string, Eleccion>;
  alternar: (e: Eleccion) => void;
  cambiarTalla: (k: string, talla: string | null) => void;
}) {
  const [color, setColor] = useState(0);
  const [foto, setFoto] = useState(0);
  const c = p.colores[color];
  const k = clave({ productId: p.productId, color: c.color });
  const elegido = elegidos.get(k);
  const precio =
    p.precioDesde == null ? null : p.precioDesde === p.precioHasta ? pesos(p.precioDesde) : `${pesos(p.precioDesde)} – ${pesos(p.precioHasta!)}`;

  return (
    <article className={`tarjeta creador ${elegido ? "creador-elegido" : ""}`}>
      <div className="tarjeta-foto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {c.fotos[foto] && <img src={c.fotos[foto]} alt={`${p.titulo} ${c.color}`} loading="lazy" />}
        {p.modelo && <span className="sello-caja modelo">{p.modelo}</span>}
        <span className={`estado-tiktok ${p.activo ? "estado-activo" : "estado-inactivo"}`}>{p.activo ? "Activo" : "Inactivo"}</span>
      </div>
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
      <div className="tarjeta-cuerpo">
        <span className="tarjeta-titulo">{p.titulo}</span>
        {precio && <span className="precio">{precio}</span>}
        {p.categoria && <span className="datos-chicos">{p.categoria}</span>}

        {p.colores.length > 1 && (
          <div className="filtros creador-colores" role="group" aria-label="Color">
            {p.colores.map((x, i) => (
              <button
                key={x.color}
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
        <span className="datos-chicos">
          {p.colores.length === 1 ? `${c.color} · ` : ""}Tallas {c.tallas.join(", ")}
          {c.tallasConStock.length ? ` · con existencia: ${c.tallasConStock.join(", ")}` : " · sin existencia hoy"}
        </span>

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
    </article>
  );
}

export function CatalogoInfluencers({ productos, whatsapp }: { productos: ProductoInfluencer[]; whatsapp: string | null }) {
  const [estado, setEstado] = useState<Estado>("todos");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [elegidos, setElegidos] = useState<Map<string, Eleccion>>(new Map());
  const [quien, setQuien] = useState("");
  const [abierta, setAbierta] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // La selección se recuerda en este navegador (si se puede).
  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(LLAVE) ?? "null");
      if (g?.elegidos) setElegidos(new Map((g.elegidos as Eleccion[]).map((e) => [clave(e), e])));
      if (g?.quien) setQuien(String(g.quien));
    } catch {
      /* sin almacenamiento: empieza vacía */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LLAVE, JSON.stringify({ elegidos: [...elegidos.values()], quien }));
    } catch {
      /* sin almacenamiento */
    }
  }, [elegidos, quien]);

  const categorias = useMemo(
    () => [...new Set(productos.map((p) => p.categoria).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "es")),
    [productos],
  );
  const cuenta = { todos: productos.length, activos: productos.filter((p) => p.activo).length, inactivos: productos.filter((p) => !p.activo).length };
  const palabras = sinAcentos(busca).split(/[\s-]+/).filter(Boolean);
  const visibles = productos.filter((p) => {
    if (estado === "activos" && !p.activo) return false;
    if (estado === "inactivos" && p.activo) return false;
    if (categoria && p.categoria !== categoria) return false;
    const texto = sinAcentos(`${p.modelo ?? ""} ${p.titulo} ${p.colores.map((c) => c.color).join(" ")}`);
    return palabras.every((w) => texto.includes(w));
  });

  const lista = [...elegidos.values()];
  const url = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
  const mensaje = mensajeDeSeleccion(quien, lista, url);

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
      <nav className="filtros" aria-label="Estado en TikTok">
        {(["todos", "activos", "inactivos"] as Estado[]).map((e) => (
          <button key={e} type="button" className="filtro" aria-current={estado === e} onClick={() => setEstado(e)}>
            {e === "todos" ? "Todos" : e === "activos" ? "Activos" : "Inactivos"} ({cuenta[e]})
          </button>
        ))}
      </nav>
      {categorias.length > 1 && (
        <nav className="filtros" aria-label="Categorías">
          <button type="button" className="filtro" aria-current={!categoria} onClick={() => setCategoria(null)}>
            Todas
          </button>
          {categorias.map((c) => (
            <button key={c} type="button" className="filtro" aria-current={categoria === c} onClick={() => setCategoria(c)}>
              {c}
            </button>
          ))}
        </nav>
      )}
      <label className="campo creador-busca">
        <span className="sr">Buscar</span>
        <input type="search" placeholder="Buscar modelo, color… (gt134 negro)" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </label>

      {visibles.length ? (
        <div className="rejilla">
          {visibles.map((p) => (
            <Tarjeta key={p.productId} p={p} elegidos={elegidos} alternar={alternar} cambiarTalla={cambiarTalla} />
          ))}
        </div>
      ) : (
        <p className="nota">Nada coincide con la búsqueda.</p>
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
