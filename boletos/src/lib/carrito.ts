/**
 * Lo que pide el comprador, antes de tocar la base. Funciones puras: las usa
 * el formulario para mostrar el total y el servidor para validar la forma.
 * La verdad del total la calcula la base con los precios vigentes.
 */
import type { TipoBoleto } from "./tipos";

export interface Seleccion {
  tipo_id: string;
  cantidad: number;
}

export interface Carrito {
  renglones: Seleccion[];
  donativos: number;
}

export interface ResumenCarrito {
  boletos: number;
  total: number;
  lineas: { nombre: string; cantidad: number; importe: number }[];
}

export function resumirCarrito(
  carrito: Carrito,
  tipos: Pick<TipoBoleto, "id" | "nombre" | "precio">[],
  donativo: { nombre: string | null; monto: number | null },
): ResumenCarrito {
  const lineas: ResumenCarrito["lineas"] = [];
  let boletos = 0;
  let total = 0;
  for (const r of carrito.renglones) {
    if (r.cantidad <= 0) continue;
    const t = tipos.find((x) => x.id === r.tipo_id);
    if (!t) continue;
    boletos += r.cantidad;
    total += t.precio * r.cantidad;
    lineas.push({ nombre: t.nombre, cantidad: r.cantidad, importe: t.precio * r.cantidad });
  }
  if (carrito.donativos > 0 && donativo.monto) {
    total += donativo.monto * carrito.donativos;
    lineas.push({ nombre: donativo.nombre ?? "Donativo", cantidad: carrito.donativos, importe: donativo.monto * carrito.donativos });
  }
  return { boletos, total: Math.round(total * 100) / 100, lineas };
}

/** Lee del formulario los campos "tipo_<id>" y "donativos". */
export function leerCarrito(form: FormData, tipos: Pick<TipoBoleto, "id">[]): Carrito {
  const renglones = tipos.map((t) => ({
    tipo_id: t.id,
    cantidad: enteroNoNegativo(form.get(`tipo_${t.id}`)),
  }));
  return { renglones, donativos: enteroNoNegativo(form.get("donativos")) };
}

function enteroNoNegativo(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function carritoVacio(c: Carrito): boolean {
  return c.donativos === 0 && c.renglones.every((r) => r.cantidad === 0);
}
