/**
 * Reglas de la tienda, sin base ni red (probadas en tienda.test.ts).
 *
 * El inventario NO es de la tienda: es el kardex de TikTok del ERP. Aquí
 * solo se ordena lo que la base ya decidió (`tienda_disponibles`).
 */

export interface Variante {
  sku_id: string;
  sku_interno: string | null;
  color: string | null;
  talla: string | null;
  precio: number | null;
  precio_lista: number | null;
  imagen: string | null;
}

export interface Producto {
  product_id: string;
  modelo: string | null;
  titulo: string;
  descripcion: string | null;
  imagenes: string[];
  /** fotos de la ficha de Amazon por color (decisión del dueño: las mismas imágenes que Amazon) */
  fotos_amazon?: Record<string, string[]>;
  /** puntos clave de la ficha de Amazon */
  bullets?: string[];
  /** categoría de Productos y costos del ERP (Botas y Botines, Tenis…) */
  categoria?: string | null;
  /** imágenes del contenido A+ de Amazon, en orden */
  aplus?: string[];
}

export interface TallaVista {
  skuId: string;
  talla: string;
  precio: number;
  precioLista: number | null;
  disponible: number;
}

export interface ColorVista {
  color: string;
  imagen: string | null;
  /** las fotos de ESTE color (Amazon primero; si no hay, las del producto en TikTok) */
  fotos: string[];
  tallas: TallaVista[];
  disponible: number;
}

export interface ProductoVista extends Producto {
  colores: ColorVista[];
  precioDesde: number | null;
  precioListaDesde: number | null;
  disponible: number;
  tallasRango: string | null;
}

/** Con esto o menos se avisa «quedan N». */
export const POCAS_PIEZAS = 3;

export function compararTallas(a: string, b: string): number {
  const x = Number(a.replace(",", "."));
  const y = Number(b.replace(",", "."));
  const nx = a !== "" && Number.isFinite(x);
  const ny = b !== "" && Number.isFinite(y);
  if (nx && ny) return x - y;
  if (nx) return -1;
  if (ny) return 1;
  return a.localeCompare(b, "es");
}

/**
 * Agrupa las variantes de un producto por color y talla con su existencia.
 * Una variante sin amarre al kardex o sin precio no se ofrece.
 */
export function armarProducto(p: Producto, variantes: Variante[], disponibles: Map<string, number>): ProductoVista {
  const porColor = new Map<string, ColorVista>();
  for (const v of variantes) {
    if (!v.sku_interno || v.precio == null || !(Number(v.precio) > 0)) continue;
    const nombre = (v.color ?? "").trim() || "Único";
    const c = porColor.get(nombre) ?? { color: nombre, imagen: null, fotos: [], tallas: [], disponible: 0 };
    if (!c.imagen && v.imagen) c.imagen = v.imagen;
    const disponible = Math.max(0, disponibles.get(v.sku_interno) ?? 0);
    c.tallas.push({
      skuId: v.sku_id,
      talla: (v.talla ?? "").trim() || "Única",
      precio: Number(v.precio),
      precioLista: v.precio_lista != null && Number(v.precio_lista) > Number(v.precio) ? Number(v.precio_lista) : null,
      disponible,
    });
    c.disponible += disponible;
    porColor.set(nombre, c);
  }
  const colores = [...porColor.values()]
    .map((c) => {
      const deAmazon = p.fotos_amazon?.[c.color] ?? [];
      const fotos = deAmazon.length ? deAmazon : [...(c.imagen ? [c.imagen] : []), ...p.imagenes.filter((u) => u !== c.imagen)];
      return { ...c, fotos, imagen: deAmazon[0] ?? c.imagen, tallas: c.tallas.sort((a, b) => compararTallas(a.talla, b.talla)) };
    })
    // Lo que hay primero; lo agotado al final, pero se enseña.
    .sort((a, b) => Number(b.disponible > 0) - Number(a.disponible > 0) || a.color.localeCompare(b.color, "es"));

  const todas = colores.flatMap((c) => c.tallas);
  const conStock = todas.filter((t) => t.disponible > 0);
  const base = conStock.length ? conStock : todas;
  const precioDesde = base.length ? Math.min(...base.map((t) => t.precio)) : null;
  const listaDesde = base.find((t) => t.precio === precioDesde && t.precioLista != null)?.precioLista ?? null;
  const tallasOrden = [...new Set(conStock.map((t) => t.talla))].sort(compararTallas);
  return {
    ...p,
    colores,
    precioDesde,
    precioListaDesde: listaDesde,
    disponible: conStock.reduce((s, t) => s + t.disponible, 0),
    tallasRango: tallasOrden.length ? (tallasOrden.length === 1 ? tallasOrden[0] : `${tallasOrden[0]}–${tallasOrden[tallasOrden.length - 1]}`) : null,
  };
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

export interface ReglaEnvio {
  costo: number;
  gratisDesde: number | null;
}

export function costoDeEnvio(subtotal: number, regla: ReglaEnvio): number {
  if (subtotal <= 0) return 0;
  if (regla.gratisDesde != null && subtotal >= regla.gratisDesde) return 0;
  return Math.max(0, regla.costo);
}

// ---------------------------------------------------------------------------
// Carrito (vive en el navegador; el servidor vuelve a validar todo)
// ---------------------------------------------------------------------------

export interface RenglonCarrito {
  skuId: string;
  cantidad: number;
}

export const MAX_POR_RENGLON = 10;

/** Limpia lo que venga del navegador: junta repetidos, sin ceros, con tope. */
export function normalizarCarrito(entrada: unknown): RenglonCarrito[] {
  const m = new Map<string, number>();
  if (!Array.isArray(entrada)) return [];
  for (const r of entrada) {
    const skuId = String((r as any)?.skuId ?? "").trim();
    const n = Math.floor(Number((r as any)?.cantidad));
    if (!skuId || !Number.isFinite(n) || n <= 0) continue;
    m.set(skuId, Math.min(MAX_POR_RENGLON, (m.get(skuId) ?? 0) + n));
  }
  return [...m].map(([skuId, cantidad]) => ({ skuId, cantidad }));
}

// ---------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------

export type EstadoPedido =
  | "pendiente_pago"
  | "pagado"
  | "enviado"
  | "entregado"
  | "cancelado"
  | "expirado"
  | "sin_stock";

export const ESTADO_PARA_CLIENTE: Record<EstadoPedido, { titulo: string; detalle: string }> = {
  pendiente_pago: {
    titulo: "Esperando tu pago",
    detalle: "Tus pares están apartados. Si pagaste en OXXO o por transferencia, se confirma solo cuando llegue el pago.",
  },
  pagado: { titulo: "Pago recibido", detalle: "Estamos preparando tu paquete. Te mandamos la guía por correo cuando salga." },
  enviado: { titulo: "En camino", detalle: "Tu paquete ya salió. Rastréalo con la guía de abajo." },
  entregado: { titulo: "Entregado", detalle: "Gracias por tu compra." },
  cancelado: { titulo: "Cancelado", detalle: "Este pedido se canceló. Si lo pagaste, el dinero regresa a tu forma de pago." },
  expirado: { titulo: "Se venció el tiempo para pagar", detalle: "Los pares se liberaron. Puedes volver a pedirlos si siguen disponibles." },
  sin_stock: {
    titulo: "Pago recibido sin existencia",
    detalle: "Tu pago llegó después de que se vendieron los últimos pares. Te devolvemos el dinero completo.",
  },
};

/** Lo que Mercado Pago dice de un pago, reducido a lo que importa para el pedido. */
export function pagoCuadra(pago: { status?: string; transaction_amount?: number; external_reference?: string }, pedido: { id: number; total: number }): boolean {
  if (String(pago.external_reference ?? "") !== String(pedido.id)) return false;
  // Se cobra en pesos enteros o con centavos; se tolera un centavo de redondeo.
  return Number(pago.transaction_amount ?? 0) + 0.01 >= Number(pedido.total);
}

// ---------------------------------------------------------------------------
// Datos del comprador
// ---------------------------------------------------------------------------

export interface DatosEnvio {
  email: string;
  nombre: string;
  telefono: string;
  calle: string;
  numero: string;
  interior: string;
  colonia: string;
  cp: string;
  ciudad: string;
  estado: string;
  referencias: string;
}

export const CAMPOS_OBLIGATORIOS: (keyof DatosEnvio)[] = ["email", "nombre", "telefono", "calle", "numero", "colonia", "cp", "ciudad", "estado"];

export function validarDatos(entrada: Partial<Record<keyof DatosEnvio, unknown>>): { datos: DatosEnvio; errores: Partial<Record<keyof DatosEnvio, string>> } {
  const t = (k: keyof DatosEnvio, max = 120) => String(entrada[k] ?? "").trim().slice(0, max);
  const datos: DatosEnvio = {
    email: t("email").toLowerCase(),
    nombre: t("nombre"),
    telefono: t("telefono", 20),
    calle: t("calle"),
    numero: t("numero", 20),
    interior: t("interior", 20),
    colonia: t("colonia"),
    cp: t("cp", 5),
    ciudad: t("ciudad"),
    estado: t("estado"),
    referencias: t("referencias", 240),
  };
  const errores: Partial<Record<keyof DatosEnvio, string>> = {};
  for (const k of CAMPOS_OBLIGATORIOS) if (!datos[k]) errores[k] = "Falta este dato.";
  if (datos.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) errores.email = "Revisa el correo.";
  if (datos.cp && !/^\d{5}$/.test(datos.cp)) errores.cp = "El código postal son 5 dígitos.";
  if (datos.telefono && datos.telefono.replace(/\D/g, "").length < 10) errores.telefono = "El teléfono son 10 dígitos.";
  return { datos, errores };
}

export const ESTADOS_MX = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua",
  "Ciudad de México", "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero",
  "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro",
  "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz",
  "Yucatán", "Zacatecas",
];

export const pesos = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: n % 1 ? 2 : 0 });
