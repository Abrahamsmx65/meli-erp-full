"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductoInfluencer } from "@/lib/influencers";
import { guiaConIA, textoDeGuia, type GuiaIA } from "@/lib/guia-contenido";
import { fotoAmazon, tituloCorto } from "@/lib/catalogo-vista";

/**
 * La ayuda para armar el video de un producto: puntos fuertes, cómo
 * mostrarlo, ideas, ganchos y datos (`lib/guia-contenido.ts`). Se abre en una
 * ventana sobre el catálogo y se puede copiar completa. Al abrirse pide la
 * guía que Claude escribió mirando las fotos (`/api/guia-video`); mientras
 * llega, o si el modelo no tiene, se enseña la de reglas.
 */
export function GuiaContenido({
  p,
  foto,
  abierta,
  cerrar,
}: {
  p: ProductoInfluencer;
  foto?: string;
  abierta: boolean;
  cerrar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copiado, setCopiado] = useState(false);
  const [ia, setIa] = useState<GuiaIA | null>(null);
  const [cargando, setCargando] = useState(!!p.modelo);
  const guia = useMemo(() => guiaConIA(p, ia), [p, ia]);

  useEffect(() => {
    if (!p.modelo) return;
    let vivo = true;
    fetch(`/api/guia-video?modelo=${encodeURIComponent(p.modelo)}`)
      .then((r) => (r.ok ? r.json() : { guia: null }))
      .then((d) => vivo && setIa(d?.guia ?? null))
      .catch(() => {
        /* sin red: se queda la de reglas */
      })
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [p.modelo]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierta && !d.open) d.showModal();
    if (!abierta && d.open) d.close();
  }, [abierta]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoDeGuia(p, guia));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* el navegador no dejó copiar */
    }
  }

  const secciones: [string, string[]][] = [
    ["Puntos fuertes", guia.puntosFuertes],
    ["Cómo mostrarlo", guia.comoMostrarlo],
    ["Ideas de video", guia.ideas],
    ["Para los primeros 3 segundos", guia.ganchos],
    ["Para quién es", guia.paraQuien ?? []],
    ["Lo que no debes decir", guia.evitar ?? []],
    ["Datos para tu video", guia.datos],
  ];

  return (
    <dialog
      ref={ref}
      className="guia"
      onClose={cerrar}
      // clic fuera de la ventana (en el fondo) la cierra
      onClick={(e) => {
        if (e.target === ref.current) cerrar();
      }}
      aria-labelledby={`guia-${p.productId}`}
    >
      <div className="guia-in">
        <header className="guia-cabeza">
          {foto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fotoAmazon(foto, 200)} alt="" className="guia-foto" />
          )}
          <div>
            <span className="catalogo-ceja">Ideas para tu video</span>
            <h2 id={`guia-${p.productId}`} className="modelo guia-modelo">
              {p.modelo ?? "Producto"}
            </h2>
            <p className="suave guia-sub">{tituloCorto(p.titulo)}</p>
          </div>
          <button type="button" className="guia-cerrar" onClick={cerrar} aria-label="Cerrar">
            ×
          </button>
        </header>

        {guia.resumen ? <p className="guia-resumen">{guia.resumen}</p> : null}
        {cargando ? <p className="suave guia-cargando">Buscando las ideas de este producto…</p> : null}

        {(cargando ? [] : secciones.filter(([, xs]) => xs.length)).map(([titulo, xs], i) =>
          xs.length ? (
            <section key={titulo} className="guia-seccion">
              <h3>
                <span className="guia-num">{i + 1}</span>
                {titulo}
              </h3>
              <ul>
                {xs.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </section>
          ) : null,
        )}

        <div className="guia-pie">
          <button type="button" className="boton boton-comprar" onClick={copiar} disabled={cargando}>
            {copiado ? "¡Copiado!" : "Copiar guía"}
          </button>
          <button type="button" className="boton" onClick={cerrar}>
            Cerrar
          </button>
        </div>
      </div>
    </dialog>
  );
}
