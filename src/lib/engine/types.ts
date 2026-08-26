/** Tipos compartidos del motor de reposición. */

/** Fecha en formato YYYY-MM-DD (siempre en la zona horaria del vendedor). */
export type ISODate = string;

export interface VentaDiaria {
  sku: string;
  fecha: ISODate;
  unidades: number;
  ordenes?: number;
  importe?: number;
  /** comisión que MELI cobró (sale_fee); lo recibido es importe - comision */
  comision?: number;
}

export interface SnapshotStock {
  sku: string;
  fecha: ISODate;
  disponible: number;
  enTransferencia?: number;
  origen?: "snapshot" | "reconstruido";
}

export interface OperacionStock {
  /** id que da MELI; sirve para no duplicar entre sincronizaciones */
  id?: string | null;
  sku: string;
  /** timestamp ISO completo */
  fecha: string;
  tipo?: string | null;
  /** cambio en unidades disponibles que provocó esta operación */
  deltaDisponible?: number | null;
  /** nivel de disponibles que quedó después de la operación */
  resultadoDisponible?: number | null;
}

export interface StockFull {
  sku: string;
  disponible: number;
  enTransferencia: number;
  noDisponible: number;
  total: number;
}

export interface InventarioPropio {
  sku: string;
  unidades: number;
}

export interface CajaItem {
  sku: string;
  piezas: number;
}

export interface Caja {
  codigo: string;
  nombre?: string | null;
  /** cuántas cajas de este tipo tengo armadas y listas */
  cajasDisponibles: number;
  items: CajaItem[];
}

export interface SkuOverride {
  sku: string;
  excluir?: boolean;
  /** si viene, reemplaza la demanda diaria calculada del histórico */
  demandaManual?: number | null;
  factorTemporada?: number;
  minimoEnvio?: number | null;
}

export interface Parametros {
  enviosPorSemana: number;
  leadTimeDias: number;
  horizonteDias: number;
  diasHistoria: number;
  /** pesos de los buckets [0-30d, 30-60d, 60-90d] */
  pesosRecencia: number[];
  aplicarTendencia: boolean;
  tendenciaMin: number;
  tendenciaMax: number;
  nivelServicio: number;
  ssMinimoDias: number;
  factorCorreccionMax: number;
  diasStockMinimosConfiables: number;
  sobrestockFactor: number;
  permiteUnidadesSueltas: boolean;
  pesoFaltante: number;
  pesoSobrante: number;
  pesoFaltanteCritico: number;
  /** tope de cajas por envío. 0 = sin tope */
  maxCajasPorEnvio: number;
  /** tope de piezas por envío. 0 = sin tope */
  maxPiezasPorEnvio: number;
  /**
   * Regla de la corrida despareja: sobrante tolerado a las tallas hermanas,
   * como múltiplo de su venta del horizonte (posición ≤ factor × su venta
   * del horizonte = hermanas al día → se manda la MITAD; arriba de eso →
   * la talla agotada recibe `corridaDiasDispareja` días de su venta por
   * envío). El negocio lo fijó en 1.5.
   */
  corridaSobranteFactor: number;
  /** días a cubrir de la talla agotada cuando la corrida ya está dispareja */
  corridaDiasDispareja: number;
}

export type OrigenDia =
  | "snapshot"
  | "operaciones"
  | "inferido"
  | "desconocido";

export interface DiaStock {
  fecha: ISODate;
  /** disponibles al ARRANCAR el día */
  inicio: number;
  /** disponibles al CERRAR el día */
  fin: number;
  unidades: number;
  /** fracción del día en que el SKU realmente tuvo stock (0..1) */
  fraccionConStock: number;
  origen: OrigenDia;
}

export type Confianza = "alta" | "media" | "baja";

export interface Bucket {
  etiqueta: string;
  diasCalendario: number;
  diasEfectivos: number;
  unidades: number;
  tasaDiaria: number;
}

export interface DemandaSku {
  sku: string;
  /** unidades vendidas en toda la ventana */
  unidadesTotales: number;
  diasCalendario: number;
  /** días en que sí hubo stock (suma de fracciones) */
  diasEfectivos: number;
  diasSinStock: number;
  /** ventas / días de calendario — lo que verías sin corregir */
  tasaObservada: number;
  /** ventas / días efectivos — la demanda real */
  tasaCorregida: number;
  /** cuánto infló la corrección: tasaCorregida / tasaObservada */
  factorCorreccion: number;
  buckets: Bucket[];
  tasaPonderada: number;
  factorTendencia: number;
  demandaDiaria: number;
  sigmaDiaria: number;
  coefVariacion: number;
  confianza: Confianza;
  notas: string[];
}

export type EstadoSku =
  | "critico"
  | "urgente"
  | "ok"
  | "sobrestock"
  | "sin_demanda";

export interface LineaPlan {
  sku: string;
  titulo?: string | null;
  demanda: DemandaSku;

  disponible: number;
  enTransferencia: number;
  posicion: number;

  stockSeguridad: number;
  puntoReorden: number;
  nivelObjetivo: number;

  coberturaDias: number;
  fechaQuiebre: ISODate | null;

  /** lo que idealmente habría que mandar */
  sugerido: number;
  /**
   * Recorte por la regla de la corrida despareja: la caja de esta talla
   * sobre-surtiría a sus hermanas, así que se manda menos. `sugerido` ya
   * viene recortado; el pedido completo queda en `sugeridoCompleto`.
   */
  ajusteCorrida?: "mitad_corrida" | "solo_7_dias";
  /** sugerido ANTES del recorte de la corrida (solo cuando hubo ajuste) */
  sugeridoCompleto?: number;
  /** lo que puedo mandar con el inventario propio suelto que tengo */
  inventarioPropio: number;
  faltanteBodega: number;

  estado: EstadoSku;
  explicacion: string;
}

export interface CajaElegida {
  codigo: string;
  nombre?: string | null;
  cantidad: number;
  piezasPorCaja: number;
  aporta: { sku: string; piezas: number }[];
  /**
   * Cuántas de estas cajas entraron por el RESCATE de tallas faltantes con
   * la caja mayormente sobrante ("muy diferencial"): van al envío marcadas
   * como opcionales para que el usuario decida si las sube o no.
   */
  cantidadOpcional?: number;
}

export interface PlanCajas {
  cajas: CajaElegida[];
  sueltas: { sku: string; piezas: number }[];
  /** por SKU: cuánto termina viajando */
  enviadoPorSku: Map<string, number>;
  faltantePorSku: Map<string, number>;
  sobrantePorSku: Map<string, number>;
  costo: number;
  totalCajas: number;
  totalPiezas: number;
}

export interface ResumenPlan {
  generadoEn: string;
  skusAnalizados: number;
  skusCriticos: number;
  skusUrgentes: number;
  skusSobrestock: number;
  skusConQuiebreHistorico: number;
  piezasSugeridas: number;
  piezasPlaneadas: number;
  totalCajas: number;
  ventaPerdidaEstimada: number;
  proximoEnvio: ISODate;
}

export interface Plan {
  parametros: Parametros;
  resumen: ResumenPlan;
  lineas: LineaPlan[];
  cajas: PlanCajas;
}
