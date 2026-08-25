import type { EntradaDop, ModeloDop } from "./client";

/**
 * Modelos DoP para la prueba rápida (~5 s, sin control de formato).
 * El clip para MELI no pasa por aquí: usa Soul + Kling (ver escenas.ts).
 */
export const MODELOS: { id: ModeloDop; etiqueta: string; nota: string }[] = [
  { id: "dop-turbo", etiqueta: "Turbo", nota: "El bueno; rápido y con calidad." },
  { id: "dop-preview", etiqueta: "Preview", nota: "Borrador para probar prompts." },
  { id: "dop-lite", etiqueta: "Lite", nota: "El más económico." },
];

const MODELOS_VALIDOS = new Set<string>(MODELOS.map((m) => m.id));

/** Valida un prompt; lanza en español para que el error llegue tal cual a la UI. */
export function validarPrompt(prompt: string): string {
  const limpio = prompt.trim();
  if (!limpio) throw new Error("Falta el prompt del video.");
  if (limpio.length > 1500) throw new Error("El prompt es demasiado largo (máximo 1500 caracteres).");
  return limpio;
}

/** Valida que la imagen sea una URL pública. */
export function validarImagenUrl(url: string): string {
  const limpia = url.trim();
  if (!/^https?:\/\//.test(limpia)) {
    throw new Error("La imagen debe ser una URL pública (http o https).");
  }
  return limpia;
}

/**
 * Arma y valida el cuerpo que se manda al modelo DoP. Lanza con mensaje en
 * español si algo no cuadra.
 */
export function construirEntradaDop(datos: {
  prompt: string;
  imagenUrl: string;
  modelo: string;
}): EntradaDop {
  const prompt = validarPrompt(datos.prompt);
  const imagen = validarImagenUrl(datos.imagenUrl);

  if (!MODELOS_VALIDOS.has(datos.modelo)) {
    throw new Error(`Modelo desconocido: "${datos.modelo}".`);
  }

  return {
    model: datos.modelo as ModeloDop,
    prompt,
    input_images: [{ type: "image_url", image_url: imagen }],
    enhance_prompt: true,
  };
}
