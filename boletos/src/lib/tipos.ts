export type EstadoPedido = "pendiente" | "por_confirmar" | "pagado" | "cancelado";
export type EstadoBoleto = "valido" | "usado" | "cancelado";

export interface Evento {
  id: string;
  nombre: string;
  descripcion: string | null;
  lugar: string | null;
  fecha: string;
  precio: number;
  capacidad: number;
  maximo_por_pedido: number;
  datos_transferencia: string;
  activo: boolean;
  creado_en: string;
}

export interface Pedido {
  id: string;
  evento_id: string;
  referencia: string;
  nombre: string;
  correo: string;
  telefono: string | null;
  cantidad: number;
  total: number;
  estado: EstadoPedido;
  comprobante_ruta: string | null;
  aviso_pago_en: string | null;
  pagado_en: string | null;
  confirmado_por: string | null;
  cancelado_en: string | null;
  notas: string | null;
  correo_enviado_en: string | null;
  creado_en: string;
}

export interface Boleto {
  id: string;
  folio: number;
  pedido_id: string;
  evento_id: string;
  codigo: string;
  estado: EstadoBoleto;
  usado_en: string | null;
  usado_por: string | null;
  creado_en: string;
}

export type ResultadoEscaneo = "ok" | "ya_usado" | "no_existe" | "cancelado" | "no_pagado";

export interface Escaneo {
  resultado: ResultadoEscaneo;
  boleto_id: string | null;
  folio: number | null;
  nombre: string | null;
  correo: string | null;
  cantidad: number | null;
  evento: string | null;
  usado_en: string | null;
  usado_por: string | null;
}
