/**
 * Desmenuza MODELO-COLOR-TALLA. Es best-effort para poder agrupar y filtrar
 * en la app: tanto el modelo como el color pueden traer guiones (GT104-4,
 * DK-BROWN), así que lo único confiable es que la talla va al final.
 */
const SUFIJOS_SITIO = new Set([
  "MX", "MLM", "AR", "MLA", "BR", "MLB", "CL", "MLC",
  "CO", "MCO", "PE", "MPE", "UY", "MLU", "US", "MX1",
]);

export function desglosarSku(sku: string): {
  modelo: string | null;
  color: string | null;
  talla: string | null;
} {
  const partes = sku.split("-").map((p) => p.trim()).filter(Boolean);
  if (partes.length < 2) return { modelo: sku || null, color: null, talla: null };

  // Fuera el sufijo de país: GT110-NAVY-26-MX -> GT110-NAVY-26.
  // Sin esto la talla quedaba escondida en medio y el color se comía el resto.
  while (partes.length > 2 && SUFIJOS_SITIO.has(partes[partes.length - 1].toUpperCase())) {
    partes.pop();
  }

  const ultima = partes[partes.length - 1];
  const esTalla = /^\d{1,2}(\.\d)?$/.test(ultima);

  if (!esTalla) return { modelo: partes[0], color: partes.slice(1).join("-"), talla: null };

  return {
    modelo: partes[0],
    color: partes.slice(1, -1).join("-") || null,
    talla: ultima,
  };
}
