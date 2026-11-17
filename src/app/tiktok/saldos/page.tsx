import { VENDEDOR_SALDOS } from "@/lib/tiktok/externos";
import { PaginaVendedorExterno } from "../externos/pagina-vendedor";

export const dynamic = "force-dynamic";

/**
 * Los SALDOS de la tienda de TikTok (dueño, 17-nov-2026: «lo mismo que la
 * sección de David para saldos: se van a manejar por separado desde otra
 * bodega y van a ser solo saldos; los SKUs van a empezar con S»): qué
 * publicaciones son de saldos, su stock capturado a mano (otra bodega, no
 * Industher) y sus cortes aparte.
 */
export default async function SaldosPagina() {
  return <PaginaVendedorExterno vendedor={VENDEDOR_SALDOS} />;
}
