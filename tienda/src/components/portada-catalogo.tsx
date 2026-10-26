import type { ProductoInfluencer } from "@/lib/influencers";
import { categoriaVisible } from "@/lib/catalogo-vista";

/** La portada del catálogo: qué es, cuánto hay y cómo se pide. */
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
      <ol className="catalogo-pasos" aria-label="Cómo pedir">
        <li>
          <b>1</b> Elige los modelos y colores que te gustan
        </li>
        <li>
          <b>2</b> Escoge tu talla en cada uno
        </li>
        <li>
          <b>3</b> Mándanos tu selección por WhatsApp
        </li>
      </ol>
    </section>
  );
}
