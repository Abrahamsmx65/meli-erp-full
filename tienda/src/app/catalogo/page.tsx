import type { Metadata } from "next";
import { CatalogoInfluencers } from "@/components/catalogo-influencers";
import { PortadaCatalogo } from "@/components/portada-catalogo";
import { catalogoCompleto } from "@/lib/catalogo";

// El catálogo va en caché de 10 min (lib/catalogo.ts); el ERP lo refresca cada hora.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Catálogo completo",
  description: "Todos los modelos GETAC por categoría.",
  // Se comparte por enlace; no tiene por qué salir en buscadores.
  robots: { index: false, follow: false },
};

export default async function CatalogoCompleto() {
  const { productos } = await catalogoCompleto();
  const whatsapp = (process.env.INFLUENCERS_WHATSAPP ?? "").replace(/\D/g, "") || null;
  return (
    <div className="contenedor">
      <link rel="preconnect" href="https://m.media-amazon.com" />
      <PortadaCatalogo ceja="Calzado GETAC" titulo="Catálogo completo" texto="Todos nuestros modelos por categoría, con las existencias de hoy." productos={productos} />
      {productos.length ? (
        <CatalogoInfluencers productos={productos} whatsapp={whatsapp} porCategoria mostrarExistencia={false} llave="getac:catalogo:seleccion" />
      ) : (
        <p className="nota">Estamos armando el catálogo. Vuelve en un rato.</p>
      )}
    </div>
  );
}
