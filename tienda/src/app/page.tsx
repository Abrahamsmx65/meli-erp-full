import Link from "next/link";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { listarProductos, tiendaAmazon, type PaginaAmazon } from "@/lib/catalogo";
import { pesos } from "@/lib/tienda";

// El catálogo va en caché de un minuto (lib/catalogo.ts); la existencia se lee en cada visita.
export const dynamic = "force-dynamic";

/** Banners propios: las imágenes en public/banners, en orden alfabético. */
async function bannersPropios(): Promise<string[]> {
  try {
    const archivos = await readdir(path.join(process.cwd(), "public", "banners"));
    return archivos.filter((a) => /\.(jpe?g|png|webp|avif)$/i.test(a)).sort().map((a) => `/banners/${a}`);
  } catch {
    return [];
  }
}

/** Una imagen de la tienda de Amazon: las anchas a todo lo ancho, las chicas en mosaico. */
function Mosaico({ pagina }: { pagina: PaginaAmazon }) {
  return (
    <div className="mosaico">
      {pagina.imagenes.map((i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i.url} src={i.url} alt="" loading="lazy" className={i.ancho == null || i.ancho >= 1400 ? "ancha" : ""} />
      ))}
    </div>
  );
}

export default async function Inicio({ searchParams }: { searchParams: Promise<{ modelo?: string; categoria?: string }> }) {
  const [{ modelo, categoria }, productos, propios, amazon] = await Promise.all([
    searchParams,
    listarProductos(),
    bannersPropios(),
    tiendaAmazon().catch(() => [] as PaginaAmazon[]),
  ]);
  const [principal, ...secciones] = amazon;
  // Sin la tienda de marca, los banners salen del A+ de cada producto (su
  // primera imagen es el encabezado de la marca) y llevan a ese producto.
  const bannersAplus = principal
    ? []
    : productos
        .filter((p) => p.disponible > 0 && p.aplus && p.aplus.length)
        .map((p) => ({ src: p.aplus![0], href: `/p/${p.product_id}`, titulo: p.titulo }))
        .slice(0, 8);
  const filtrando = Boolean(modelo || categoria);
  const modelos = [...new Set(productos.map((p) => p.modelo).filter(Boolean) as string[])].sort((a, b) =>
    a.localeCompare(b, "es", { numeric: true }),
  );
  const categorias = [...new Set(productos.map((p) => p.categoria).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "es"));
  const visibles = productos.filter((p) => (!modelo || p.modelo === modelo) && (!categoria || p.categoria === categoria));

  return (
    <>
      {/* La portada copia la tienda de marca de GETAC en Amazon: sus banners primero. */}
      {!filtrando && (propios.length > 0 || principal) && (
        <section className="escaparate" aria-label="GETAC">
          {propios.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="ancha" />
          ))}
          {principal && <Mosaico pagina={principal} />}
        </section>
      )}
      {!filtrando && bannersAplus.length > 0 && (
        <section className="escaparate" aria-label="Destacados">
          <div className="banners">
            {bannersAplus.map((b) => (
              <Link key={b.src} href={b.href} aria-label={b.titulo}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.src} alt="" />
              </Link>
            ))}
          </div>
        </section>
      )}
    <div className="contenedor">
      {!filtrando && !principal && !propios.length && !bannersAplus.length && (
        <section className="portada">
          <h1>Calzado GETAC</h1>
          <p>Botas, botines, tenis y sandalias. Elige tu talla, paga con Mercado Pago y te lo mandamos a todo México.</p>
        </section>
      )}
      <h2 className="titulo-catalogo">{categoria ?? modelo ?? "Catálogo"}</h2>

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
      {!filtrando &&
        secciones.map((p) => (
          <section key={p.url} className="escaparate seccion-amazon">
            {p.titulo && <h2 className="contenedor titulo-catalogo">{p.titulo}</h2>}
            <Mosaico pagina={p} />
          </section>
        ))}
    </>
  );
}
