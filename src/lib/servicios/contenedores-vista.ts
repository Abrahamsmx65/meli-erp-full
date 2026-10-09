/**
 * La vista de un contenedor (Contenedores): tipos y funciones PURAS, sin
 * base ni servicios, para que la tabla del navegador las importe sin
 * arrastrar código del servidor. `contenedores.ts` las reexporta.
 */

export interface ContenedorVista {
  id: string;
  numero: string;
  numeroNaviera: string | null;
  naviera: string | null;
  fechaSalida: string | null;
  llegadaEst: string | null;
  llegadaReal: string | null;
  almacenDestino: string | null;
  estado: string;
  notas: string | null;
  cajas: number;
  pedidos: { pedido: string; cajas: number }[];
  /** qué viene: por modelo y color, con sus cajas y pares (decisión del dueño: se ve esto, no los pedidos) */
  modelos: { modelo: string; color: string; cajas: number; pares: number }[];
  /** renglones del packing list que NO amarraron: el dueño los resuelve en la pantalla */
  pendientes: PendientePacking[];
}

/** Un renglón del packing list que no entró, tal como se guarda con el contenedor. */
export interface PendientePacking {
  modelo: string;
  color: string;
  talla: string | null;
  /** cajas que se quedaron fuera */
  cajas: number;
  motivo: string;
  /** el pedido que decía el packing list (los guardados antes del 7-oct-2026 no lo traen) */
  pedido?: string | null;
}

/** Lo guardado en `contenedores.pendientes`, sin confiar en su forma. */
export function leerPendientes(valor: unknown): PendientePacking[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((x) => ({
      modelo: String(x.modelo ?? "").toUpperCase(),
      color: String(x.color ?? "").toUpperCase(),
      talla: x.talla ? String(x.talla) : null,
      cajas: Number(x.cajas) || 0,
      motivo: String(x.motivo ?? ""),
      pedido: x.pedido ? String(x.pedido).toUpperCase() : null,
    }))
    .filter((p) => p.modelo && p.cajas > 0);
}

/** Agrupa los renglones de un contenedor por modelo + color. Puro, para probarse. */
export function modelosDeContenedor(
  lineas: { modelo: string; color: string | null; cajas: number; paresPorCaja: number }[],
): ContenedorVista["modelos"] {
  const porClave = new Map<string, { modelo: string; color: string; cajas: number; pares: number }>();
  for (const l of lineas) {
    const modelo = (l.modelo ?? "").trim().toUpperCase();
    const color = (l.color ?? "").trim().toUpperCase();
    if (!modelo || l.cajas <= 0) continue;
    const k = `${modelo}|${color}`;
    const x = porClave.get(k) ?? { modelo, color, cajas: 0, pares: 0 };
    x.cajas += l.cajas;
    x.pares += Math.round(l.cajas * l.paresPorCaja);
    porClave.set(k, x);
  }
  return [...porClave.values()].sort((a, b) => a.modelo.localeCompare(b.modelo) || a.color.localeCompare(b.color));
}

const enMx = (x: number): string => Math.round(x).toLocaleString("es-MX");

/**
 * Lo que viene en el contenedor, en UNA línea (decisión del dueño,
 * 10-sep-2026): la lista completa hacía renglones de veinte líneas y la
 * tabla no se podía leer. Aquí van solo los modelos distintos; el detalle
 * sale al pasar el mouse (`detalleModelos`).
 */
export function resumenModelos(modelos: ContenedorVista["modelos"], tope = 3): string {
  const distintos = [...new Set(modelos.map((m) => m.modelo))];
  if (!distintos.length) return "";
  const primeros = distintos.slice(0, tope).join(", ");
  return distintos.length > tope ? `${primeros} +${distintos.length - tope}` : primeros;
}

/** El detalle del tooltip: un renglón por modelo y color, y los pedidos al final. */
export function detalleModelos(c: Pick<ContenedorVista, "modelos" | "pedidos">): string {
  const lineas = c.modelos.map(
    (m) =>
      `${m.modelo}${m.color ? ` ${m.color}` : ""} · ${enMx(m.cajas)} cajas` +
      (m.pares > 0 ? ` · ${enMx(m.pares)} pares` : ""),
  );
  if (c.pedidos.length) {
    lineas.push(`Pedidos: ${c.pedidos.map((p) => `${p.pedido} (${enMx(p.cajas)})`).join(" · ")}`);
  }
  return lineas.join("\n");
}
