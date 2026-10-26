"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductoInfluencer } from "@/lib/influencers";
import { guiaDeContenido, textoDeGuia } from "@/lib/guia-contenido";
import { fotoAmazon, tituloCorto } from "@/lib/catalogo-vista";

/**
 * La ayuda para armar el video de un producto: puntos fuertes, cómo
 * mostrarlo, ideas, ganchos y datos (`lib/guia-contenido.ts`). Se abre en una
 * ventana sobre el catálogo y se puede copiar completa.
 */
export function GuiaContenido({ p, foto, abierta, cerrar }: { p: ProductoInfluencer; foto?: string; abierta: boolean; cerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copiado, setCopiado] = useState(false);
  const guia = useMemo(() => guiaDeContenido(p), [p]);

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

        {secciones.map(([titulo, xs], i) =>
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
          <button type="button" className="boton boton-comprar" onClick={copiar}>
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
