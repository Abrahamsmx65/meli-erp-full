/**
 * El motor de dinero. Funciones PURAS: reciben lo que la base ya sumó por
 * día y devuelven la cascada del periodo. No tocan la base ni el reloj, y
 * por eso se pueden probar contra capturas reales de Mercado Pago.
 *
 * Todo se suma en CENTAVOS ENTEROS. La entrada llega en pesos (así la
 * devuelven los RPC) y se convierte UNA vez, aquí, en la frontera.
 */
import type { DiaOrdenesAgregado } from "../corte-meli";
import type {
  CoberturaFinanzas,
  FinanzasPeriodo,
  PasoCascada,
  ReventaPeriodo,
  TotalesFinanzas,
} from "./tipos";

/**
 * Pesos → centavos enteros, redondeando al centavo más cercano (mitad hacia
 * afuera del cero, como en contabilidad). Pasa por toPrecision porque en
 * flotante 1.005 × 100 da 100.4999…, y redondear eso da 100 en vez de 101.
 */
export function aCentavos(pesos: number): number {
  const x = Number(pesos) || 0;
  const abs = Math.round(Number((Math.abs(x) * 100).toPrecision(15)));
  return x < 0 ? -abs : abs;
}

/** Un día de venta bruta tal como lo devuelve `ventas_totales_dia`. */
export interface DiaDeVenta {
  fecha: string;
  importe: number;
}

export interface EntradaMotor {
  rango: { desde: string; hasta: string };
  /** Cargos, neto y cobertura por día, de `cortes_ordenes_por_dia`. */
  dias: DiaOrdenesAgregado[];
  /** Venta bruta por día (precio × unidades), de `ventas_totales_dia`. */
  ventas: DiaDeVenta[];
  generadoEn: string;
}

function sumar(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function armarTotales(dias: DiaOrdenesAgregado[], ventas: DiaDeVenta[]): TotalesFinanzas {
  const bruto = sumar(ventas.map((v) => aCentavos(v.importe)));
  const comision = sumar(dias.map((d) => aCentavos(d.comisionMp ?? 0)));
  const envio = sumar(dias.map((d) => aCentavos(d.envio ?? 0)));
  const retenciones = sumar(dias.map((d) => aCentavos(d.isr ?? 0) + aCentavos(d.iva ?? 0)));
  const otros = sumar(dias.map((d) => aCentavos(d.otrosCargos ?? 0)));
  const neto = sumar(dias.map((d) => aCentavos(d.neto)));
  // Lo que no cierra. Es una RESTA, no un dato: por construcción la cascada
  // siempre cuadra y este renglón dice cuánto queda por explicar.
  const sinIdentificar = bruto - comision - envio - retenciones - otros - neto;
  return { bruto, comision, envio, retenciones, otros, sinIdentificar, neto };
}

export function armarCobertura(dias: DiaOrdenesAgregado[]): CoberturaFinanzas {
  const ordenes = sumar(dias.map((d) => d.ordenes));
  const conCargos = sumar(dias.map((d) => d.cargosLeidos ?? 0));
  const conNeto = sumar(dias.map((d) => d.netosLeidos ?? 0));
  return {
    ordenes,
    conCargos,
    conNeto,
    parteCargos: ordenes > 0 ? conCargos / ordenes : 0,
    parteNeto: ordenes > 0 ? conNeto / ordenes : 0,
  };
}

export function armarReventa(dias: DiaOrdenesAgregado[]): ReventaPeriodo {
  return {
    ordenes: sumar(dias.map((d) => d.sinDescOrdenes ?? 0)),
    importe: sumar(dias.map((d) => aCentavos(d.sinDescTotal ?? 0))),
  };
}

/**
 * La cascada tal como se lee: de la venta bruta al neto, restando cada
 * cargo con su nota. El último renglón es el resultado.
 */
export function armarCascada(t: TotalesFinanzas, cob: CoberturaFinanzas): PasoCascada[] {
  const sinLeer = cob.ordenes - cob.conCargos;
  return [
    { clave: "bruto", titulo: "Venta bruta", monto: t.bruto, nota: "Precio × unidades vendidas" },
    { clave: "comision", titulo: "Comisión de MELI", monto: -t.comision, nota: "Cargo por venta" },
    { clave: "envio", titulo: "Envíos", monto: -t.envio, nota: "Cargo por envío de Full" },
    {
      clave: "retenciones",
      titulo: "Retenciones",
      monto: -t.retenciones,
      nota: "ISR e IVA que Mercado Pago retiene",
    },
    { clave: "otros", titulo: "Otros cargos", monto: -t.otros, nota: "Lo demás que Mercado Pago desglosa" },
    {
      clave: "sinIdentificar",
      titulo: "Sin identificar",
      monto: -t.sinIdentificar,
      nota:
        sinLeer > 0
          ? `Cargos que Mercado Pago no desglosó, más ${sinLeer.toLocaleString("es-MX")} órdenes cuyo pago aún no se lee`
          : "Cargos que Mercado Pago no desglosó",
    },
    {
      clave: "neto",
      titulo: "Neto recibido",
      monto: t.neto,
      nota: "Lo que Mercado Pago dice que recibes",
      esResultado: true,
    },
  ];
}

/** De los días sumados en la base a lo que la pantalla pinta. */
export function armarFinanzas(entrada: EntradaMotor): FinanzasPeriodo {
  const dentro = (fecha: string) => fecha >= entrada.rango.desde && fecha <= entrada.rango.hasta;
  const dias = entrada.dias.filter((d) => dentro(d.fecha));
  const ventas = entrada.ventas.filter((v) => dentro(v.fecha));

  const totales = armarTotales(dias, ventas);
  const cobertura = armarCobertura(dias);
  return {
    rango: entrada.rango,
    totales,
    cascada: armarCascada(totales, cobertura),
    reventa: armarReventa(dias),
    cobertura,
    generadoEn: entrada.generadoEn,
  };
}
