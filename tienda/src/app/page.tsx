import Link from "next/link";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { bannersAmazon, listarProductos } from "@/lib/catalogo";
import { pesos } from "@/lib/tienda";

// El catálogo va en caché de un minuto (lib/catalogo.ts); la existencia se lee en cada visita.
export const dynamic = "force-dynamic";

/**
 * Banners de la portada: los que se pongan a mano en public/banners (en
 * orden alfabético) y luego los copiados de la tienda de marca de Amazon.
 */
async function banners(): Promise<string[]> {
  let propios: string[] = [];
  try {
    const archivos = await readdir(path.join(process.cwd(), "public", "banners"));
    propios = archivos.filter((a) => /\.(jpe?g|png|webp|avif)$/i.test(a)).sort().map((a) => `/banners/${a}`);
  } catch {
    /* sin carpeta */
  }
  const deAmazon = await bannersAmazon().catch(() => [] as string[]);
  return [...propios, ...deAmazon];
}

export default async function Inicio({ searchParams }: { searchParams: Promise<{ modelo?: string; categoria?: string }> }) {
  const [{ modelo, categoria }, productos, imagenes] = await Promise.all([searchParams, listarProductos(), banners()]);
  const modelos = [...new Set(productos.map((p) => p.modelo).filter(Boolean) as string[])].sort((a, b) =>
    a.localeCompare(b, "es", { numeric: true }),
  );
  const categorias = [...new Set(productos.map((p) => p.categoria).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "es"));
  const visibles = productos.filter((p) => (!modelo || p.modelo === modelo) && (!categoria || p.categoria === categoria));

  return (
    <div className="contenedor">
      <section className="portada">
        <h1>Calzado GETAC</h1>
        <p>Botas, botines, tenis y sandalias. Elige tu talla, paga con Mercado Pago y te lo mandamos a todo México.</p>
      </section>

      {imagenes.length > 0 && (
        <div className="banners" aria-label="Novedades">
          {imagenes.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" />
          ))}
        </div>
      )}

      {categorias.length > 1 && (
        <nav className="filtros" aria-label="Categorías">
          <Link href="/" className="filtro" aria-current={!categoria && !modelo}>
            Todo
          </Link>
          {categorias.map((c) => (
            <Link key={c} href={`/?categoria=${encodeURIComponent(c)}`} className="filtro" aria-current={categoria === c}>
              {c}
            </Link>
          ))}
        </nav>
      )}

      {modelos.length > 1 && (
        <nav className="filtros filtros-modelo" aria-label="Modelos">
          <Link href="/" className="filtro" aria-current={!modelo}>
            Todos
          </Link>
          {modelos.map((m) => (
            <Link key={m} href={`/?modelo=${encodeURIComponent(m)}`} className="filtro" aria-current={modelo === m}>
              {m}
            </Link>
          ))}
        </nav>
      )}

      {!visibles.length ? (
        <p className="nota">Estamos cargando el catálogo. Vuelve en unos minutos.</p>
      ) : (
        <div className="rejilla">
          {visibles.map((p) => {
            // La foto de la tarjeta: la principal de Amazon del primer color con existencia.
            const foto = p.colores[0]?.fotos[0] ?? p.imagenes[0] ?? null;
            const agotado = p.disponible <= 0;
            return (
              <Link key={p.product_id} href={`/p/${p.product_id}`} className={`tarjeta ${agotado ? "tarjeta-agotada" : ""}`}>
                <div className="tarjeta-foto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {foto && <img src={foto} alt={p.titulo} loading="lazy" />}
                  {p.modelo && <span className="sello-caja modelo">{p.modelo}</span>}
                </div>
                <div className="tarjeta-cuerpo">
                  <span className="tarjeta-titulo">{p.titulo}</span>
                  {p.precioDesde != null && (
                    <span className="precio">
                      {pesos(p.precioDesde)}
                      {p.precioListaDesde && <span className="precio-lista">{pesos(p.precioListaDesde)}</span>}
                    </span>
                  )}
                  <span className="datos-chicos">
                    {agotado
                      ? "Agotado por ahora"
                      : `${p.colores.filter((c) => c.disponible > 0).length} ${p.colores.filter((c) => c.disponible > 0).length === 1 ? "color" : "colores"} · tallas ${p.tallasRango}`}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
