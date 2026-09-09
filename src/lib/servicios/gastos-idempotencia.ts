export interface IntentoGastoPendiente {
  clave: string;
  cuerpo: string;
}

export function prepararIntentoGasto(
  pendiente: IntentoGastoPendiente | null,
  cuerpo: string,
  generarClave: () => string = () => crypto.randomUUID(),
): IntentoGastoPendiente {
  if (pendiente?.cuerpo === cuerpo) return pendiente;
  return { clave: generarClave(), cuerpo };
}