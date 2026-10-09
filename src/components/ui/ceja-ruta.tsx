"use client";

import { usePathname } from "next/navigation";
import { ubicacion } from "@/components/menu-lateral";

/**
 * La ceja del encabezado sale del MENÚ: la sección donde vive la pantalla
 * («Ventas y dinero», «Inventario»…). Así, si el menú se reordena, todas las
 * pantallas lo dicen igual sin tocar cada una. El texto que trae la pantalla
 * queda de respaldo (rutas fuera del menú) o manda si es `fija`.
 */
export function CejaDeRuta({ respaldo, fija }: { respaldo?: string; fija?: boolean }) {
  const ruta = usePathname();
  const desdeMenu = fija ? null : ubicacion(ruta)?.grupo;
  const texto = desdeMenu && desdeMenu !== "GETAC" ? desdeMenu : respaldo;
  if (!texto) return null;
  return <div className="ceja mb-1">{texto}</div>;
}
