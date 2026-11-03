import type { ProductoInfluencer } from "@/lib/influencers";
import { categoriaVisible } from "@/lib/catalogo-vista";

/** La portada del catálogo: qué es, cuánto hay y el aviso de las ideas para el video. */
export function PortadaCatalogo({ ceja, titulo, texto, productos }: { ceja: string; titulo: string; texto: string; productos: ProductoInfluencer[] }) {
  const categorias = new Set(productos.map((p) => categoriaVisible(p.categoria)).filter(Boolean)).size;
  const colores = productos.reduce((n, p) => n + p.colores.length, 0);
  return (
    <section className="catalogo-portada">
      <div>
        <span className="catalogo-ceja">{ceja}</span>
        <h1>{titulo}</h1>
        <p>{texto}</p>
        {productos.length > 0 && (
          <div className="catalogo-cifras">
            <div>
              <strong>{productos.length}</strong>
              <span>modelos</span>
            </div>
            <div>
              <strong>{colores}</strong>
              <span>colores</span>
            </div>
            {categorias > 1 && (
              <div>
                <strong>{categorias}</strong>
                <span>categorías</span>
              </div>
            )}
          </div>
        )}
      </div>
      <aside className="catalogo-aviso" role="note">
        <span className="catalogo-aviso-icono" aria-hidden="true">
          💡
        </span>
        <div>
          <strong>Nuevo: ideas para tu video</strong>
          <p>Pícale a cualquier producto y te damos sus puntos fuertes, cómo mostrarlo y ganchos para los primeros 3 segundos.</p>
        </div>
      </aside>
    </section>
  );
}
