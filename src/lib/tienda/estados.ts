/** Estados y forma de un pedido de la tienda en línea (puro: lo usa también la pantalla). */

export const ESTADOS_TIENDA = [
  "pendiente_pago",
  "pagado",
  "enviado",
  "entregado",
  "cancelado",
  "expirado",
  "sin_stock",
] as const;
export type EstadoTienda = (typeof ESTADOS_TIENDA)[number];

export const NOMBRE_ESTADO: Record<EstadoTienda, string> = {
  pendiente_pago: "Esperando pago",
  pagado: "Pagado · por enviar",
  enviado: "Enviado",
  entregado: "Entregado",
  cancelado: "Cancelado",
  expirado: "Caducó sin pago",
  sin_stock: "Pagado sin stock · devolver",
};

export interface ItemPedidoTienda {
  skuInterno: string;
  titulo: string | null;
  color: string | null;
  talla: string | null;
  cantidad: number;
  precio: number;
  imagen: string | null;
}

export interface PedidoTienda {
  id: number;
  folio: string;
  estado: EstadoTienda;
  creadoEn: string;
  pagadoEn: string | null;
  enviadoEn: string | null;
  nombre: string;
  email: string;
  telefono: string | null;
  direccion: Record<string, string>;
  subtotal: number;
  envio: number;
  total: number;
  pagoEstado: string | null;
  mpPago: string | null;
  guia: string | null;
  paqueteria: string | null;
  nota: string | null;
  items: ItemPedidoTienda[];
}
