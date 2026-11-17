import { VENDEDOR_DAVID } from "@/lib/tiktok/externos";
import { PaginaVendedorExterno } from "./pagina-vendedor";

export const dynamic = "force-dynamic";

/**
 * Lo de David en la tienda de TikTok: qué publicaciones son suyas, el stock
 * que él captura (sale de su bodega, no de Industher) y sus cortes aparte.
 */
export default async function ExternosPagina() {
  return <PaginaVendedorExterno vendedor={VENDEDOR_DAVID} />;
}
