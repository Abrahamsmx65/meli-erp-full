/**
 * Códigos del sistema. Funciones puras, sin base de datos.
 *
 * - Referencia del pedido: corta, para que el comprador la escriba como
 *   concepto de la transferencia y el organizador la encuentre en su banco.
 * - Código del boleto: largo y aleatorio, va dentro del QR. Es la única
 *   llave del boleto, así que no se puede adivinar.
 *
 * Alfabeto sin caracteres confusos (sin 0/O, 1/I/L): lo que se lee en
 * voz alta o se teclea a mano no se equivoca.
 */
export const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Aleatorio criptográfico con Web Crypto (existe en Node y en el navegador;
 * este archivo también lo importa el escáner). Muestreo por rechazo para no
 * sesgar el alfabeto de 31 símbolos.
 */
function aleatorio(largo: number): string {
  const limite = 256 - (256 % ALFABETO.length);
  let s = "";
  const bytes = new Uint8Array(largo * 2);
  while (s.length < largo) {
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limite) s += ALFABETO[b % ALFABETO.length];
      if (s.length === largo) break;
    }
  }
  return s;
}

/** Referencia de pago: "EV-7K3M2P". */
export function generarReferencia(): string {
  return `EV-${aleatorio(6)}`;
}

/** Código del boleto: 20 caracteres (~99 bits). */
export function generarCodigoBoleto(): string {
  return aleatorio(20);
}

export function esCodigoBoleto(texto: string): boolean {
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{20}$/.test(texto);
}

/** Dirección que va dentro del QR: cualquier cámara la abre. */
export function urlBoleto(codigo: string, base: string): string {
  return `${base.replace(/\/+$/, "")}/boleto/${codigo}`;
}

/**
 * Saca el código de lo que leyó el escáner: puede venir la URL completa,
 * el código pelón, con espacios o en minúsculas. Devuelve null si no hay
 * nada que parezca un código.
 */
export function extraerCodigo(texto: string): string | null {
  const limpio = texto.trim();
  if (!limpio) return null;
  const partes = limpio.split(/[/?#\s]+/).filter(Boolean);
  for (let i = partes.length - 1; i >= 0; i--) {
    const candidato = partes[i].toUpperCase();
    if (esCodigoBoleto(candidato)) return candidato;
  }
  return null;
}

/** Folio legible: "#000123". */
export function formatearFolio(folio: number | string): string {
  return `#${String(folio).padStart(6, "0")}`;
}
