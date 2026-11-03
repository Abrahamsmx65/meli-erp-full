import { colorDeCanal } from "@/lib/graficas/canales";

/**
 * El puntito de color del canal junto a su nombre (colores en
 * `lib/graficas/canales.ts`). Decorativo: el nombre siempre va escrito.
 */
export function PuntoCanal({ canal, className = "" }: { canal: string; className?: string }) {
  const color = colorDeCanal(canal);
  if (!color) return null;
  return <span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${className}`} style={{ background: color }} />;
}
