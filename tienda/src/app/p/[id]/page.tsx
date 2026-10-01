import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { unProducto } from "@/lib/catalogo";
import { Ficha } from "@/components/ficha";

// La existencia se lee en cada visita: es la misma que TikTok y cambia al minuto.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = await unProducto((await params).id).catch(() => null);
  if (!p) return { title: "Producto" };
  return {
    title: p.modelo ? `${p.modelo} · ${p.titulo}` : p.titulo,
    description: p.descripcion?.slice(0, 160) ?? p.titulo,
    openGraph: { images: p.imagenes.slice(0, 1) },
  };
}

export default async function Producto({ params }: { params: Promise<{ id: string }> }) {
  const p = await unProducto((await params).id);
  if (!p) notFound();
  return (
    <>
      <div className="contenedor">
        <Ficha producto={p} />
      </div>
      {p.aplus && p.aplus.length > 0 && (
        <section className="aplus" aria-label="Más sobre este producto">
          {p.aplus.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" loading={i < 2 ? "eager" : "lazy"} />
          ))}
        </section>
      )}
    </>
  );
}
