import type { EntradaDop, ModeloDop } from "./client";

/**
 * Recetas de video para calzado.
 *
 * Los prompts van en inglés a propósito: los modelos de video entienden
 * mejor así. La etiqueta y la descripción son lo que ve el vendedor.
 */

export interface Preset {
  id: string;
  etiqueta: string;
  descripcion: string;
  prompt: string;
}

export const PRESETS: Preset[] = [
  {
    id: "caminata",
    etiqueta: "Caminata urbana",
    descripcion: "Alguien camina por la calle con los zapatos puestos, cámara siguiendo los pies.",
    prompt:
      "Realistic handheld tracking shot at ground level following a person walking " +
      "confidently down a city sidewalk wearing these exact shoes, natural daylight, " +
      "shallow depth of field focused on the footwear, cinematic, true to the product photo",
  },
  {
    id: "giro",
    etiqueta: "Giro de producto",
    descripcion: "La cámara orbita lento alrededor del zapato, estilo escaparate.",
    prompt:
      "Slow cinematic orbit around the shoe on a clean studio surface, soft key light, " +
      "sharp focus on stitching and materials, premium product showcase, " +
      "the shoe stays exactly as in the photo",
  },
  {
    id: "ponerse",
    etiqueta: "Poniéndoselos",
    descripcion: "Una persona se pone los zapatos y se levanta, escena casera real.",
    prompt:
      "Natural lifestyle scene: a person sits, puts on these exact shoes, ties them and " +
      "stands up, warm indoor lighting, realistic body motion, camera at low angle " +
      "focused on the shoes, true to the product photo",
  },
  {
    id: "detalle",
    etiqueta: "Acercamiento a detalles",
    descripcion: "Dolly lento acercándose a la textura y costuras del zapato.",
    prompt:
      "Slow dolly-in macro shot revealing the texture, sole and stitching of the shoe, " +
      "dramatic soft lighting, extremely detailed, product commercial style, " +
      "the shoe remains identical to the photo",
  },
];

export const MODELOS: { id: ModeloDop; etiqueta: string; nota: string }[] = [
  { id: "dop-turbo", etiqueta: "Turbo", nota: "El bueno; rápido y con calidad." },
  { id: "dop-preview", etiqueta: "Preview", nota: "Borrador para probar prompts." },
  { id: "dop-lite", etiqueta: "Lite", nota: "El más económico." },
];

const MODELOS_VALIDOS = new Set<string>(MODELOS.map((m) => m.id));

/**
 * Arma y valida el cuerpo que se manda a Higgsfield. Lanza con mensaje en
 * español si algo no cuadra, para que el error llegue tal cual a la UI.
 */
export function construirEntradaDop(datos: {
  prompt: string;
  imagenUrl: string;
  modelo: string;
}): EntradaDop {
  const prompt = datos.prompt.trim();
  if (!prompt) throw new Error("Falta el prompt del video.");
  if (prompt.length > 1500) throw new Error("El prompt es demasiado largo (máximo 1500 caracteres).");

  const imagen = datos.imagenUrl.trim();
  if (!/^https?:\/\//.test(imagen)) {
    throw new Error("La imagen debe ser una URL pública (http o https).");
  }

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
