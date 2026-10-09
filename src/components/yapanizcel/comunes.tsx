export function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

export function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

export function dias(x: number): string {
  if (!Number.isFinite(x)) return "∞";
  return `${Math.round(x)} d`;
}

/**
 * La frescura vive en el kit de pantallas (`@/components/ui/pagina`). Se
 * re-exporta aquí para las pantallas que aún la importan de este archivo.
 */
export { Frescura } from "@/components/ui/pagina";

export const estiloInput = {
  borderColor: "var(--borde)",
  background: "var(--surface-1)",
  color: "var(--ink-1)",
} as const;
