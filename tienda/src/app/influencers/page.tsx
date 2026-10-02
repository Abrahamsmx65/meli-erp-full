import type { Metadata } from "next";
import { CatalogoInfluencers } from "@/components/catalogo-influencers";
import { catalogoInfluencers } from "@/lib/catalogo";

// El catálogo va en caché de 5 min (lib/catalogo.ts).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Catálogo para creadores",
  description: "Elige los productos GETAC que quieres promocionar en TikTok.",
  // Se comparte por enlace con los creadores; no tiene por qué salir en buscadores.
  robots: { index: false, follow: false },
};

export default async function Influencers() {
  const productos = await catalogoInfluencers();
  // Número de WhatsApp del dueño (solo dígitos, con lada: 5233…). Sin él, WhatsApp deja elegir el contacto.
  const whatsapp = (process.env.INFLUENCERS_WHATSAPP ?? "").replace(/\D/g, "") || null;
  return (
    <div className="contenedor">
      <section className="portada portada-creadores">
        <h1 className="titulo-catalogo">Catálogo para creadores</h1>
        <p>
          Todo lo que GETAC tiene en TikTok Shop, activo e inactivo. Elige los modelos, colores y tallas que quieres
          promocionar y mándanos tu selección por WhatsApp.
        </p>
      </section>
      {productos.length ? (
        <CatalogoInfluencers productos={productos} whatsapp={whatsapp} />
      ) : (
        <p className="nota">Estamos cargando el catálogo. Vuelve en unos minutos.</p>
      )}
    </div>
  );
}
