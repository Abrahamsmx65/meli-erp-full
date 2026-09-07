const ZONA = "America/Mexico_City";

export function pesos(n: number | string): string {
  const v = typeof n === "string" ? Number(n) : n;
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v);
}

export function fechaLarga(iso: string | Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: ZONA,
  }).format(new Date(iso));
}

export function fechaCorta(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ZONA,
  }).format(new Date(iso));
}

/** Valor para <input type="datetime-local"> en hora de México. */
export function paraInputFecha(iso: string | Date): string {
  const partes = new Intl.DateTimeFormat("sv-SE", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: "Esperando pago",
  por_confirmar: "Avisó que pagó",
  pagado: "Pagado",
  cancelado: "Cancelado",
  valido: "Sin usar",
  usado: "Usado",
};
