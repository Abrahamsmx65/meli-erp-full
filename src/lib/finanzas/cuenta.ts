/**
 * CUENTA CON RAFA y SOCIOS (dueño, 11-oct-2026). Motor puro: la pestaña
 * TOTAL del sheet «Cuentas YAPANIZCEL», ahora con los datos del ERP.
 *
 *   recibido  = transferencias a Rafa − su comisión (2/116 de cada una)
 *   salidas   = contenedores de calzado y de fundas (lo pagado en pesos:
 *               fábrica + flete + aduana) + comisión del agente (Joanne)
 *               + gastos en EFECTIVO (los de GASTOS MEX) − ingresos sin
 *               comisión (una deuda que le pagaron al dueño)
 *               + gastos de la cuenta (renta de oficina)
 *   ganancia  = recibido − salidas, repartida por socio (25 / 25 / 50)
 *   sobra     = lo que le toca − lo que ya retiró
 *
 * Las transferencias a Rafa NO son pagos de contenedores (dueño: «esos
 * pagos no tienen nada que ver con los contenedores»): Rafa paga a China o
 * le entrega efectivo. Los retiros de los socios solo se apuntan.
 */

/** Rafa cobra 2 de cada 116 pesos que se le transfieren (B − B/116 × 114). */
export const COMISION_RAFA = 2 / 116;

export function comisionDeTransferencia(monto: number): number {
  return monto > 0 ? Math.round(monto * COMISION_RAFA * 100) / 100 : 0;
}

export interface MovimientoCuenta {
  id: number;
  fecha: string | null;
  tipo: "transferencia" | "ingreso" | "gasto";
  monto: number;
  beneficiario: string | null;
  referencia: string | null;
  comision: number;
  notas: string | null;
}

export interface Socio {
  id: number;
  nombre: string;
  porcentaje: number;
}

export interface Retiro {
  id: number;
  socioId: number;
  fecha: string | null;
  concepto: string;
  monto: number;
}

export interface EntradaResumen {
  movimientos: MovimientoCuenta[];
  /** lo pagado por los contenedores en pesos (fábrica + flete + aduana) */
  contenedoresCalzado: number;
  contenedoresFundas: number;
  comisionAgenteCalzado: number;
  comisionAgenteFundas: number;
  /** gastos de Gastos con medio «efectivo» */
  gastosEfectivo: number;
  socios: Socio[];
  retiros: Retiro[];
}

export interface RenglonSocio {
  socio: Socio;
  leToca: number;
  retirado: number;
  /** de lo retirado, lo que fue tsedaka */
  tsedaka: number;
  sobra: number;
  retiros: number;
}

export interface ResumenCuenta {
  transferencias: number;
  comision: number;
  recibido: number;
  ingresos: number;
  salidas: { concepto: string; monto: number }[];
  totalSalidas: number;
  ganancia: number;
  socios: RenglonSocio[];
  porMes: { mes: string; transferido: number; comision: number }[];
  porBeneficiario: { beneficiario: string; monto: number; comision: number; movimientos: number }[];
}

const esTsedaka = (c: string) => /TS[EDA]{2,4}KA|TESEDAKA|TSDEAKA/i.test(c);

export function resumenCuenta(e: EntradaResumen): ResumenCuenta {
  const transf = e.movimientos.filter((m) => m.tipo === "transferencia");
  const transferencias = transf.reduce((s, m) => s + m.monto, 0);
  const comision = transf.reduce((s, m) => s + m.comision, 0);
  const ingresos = e.movimientos.filter((m) => m.tipo === "ingreso").reduce((s, m) => s + m.monto, 0);
  const gastosCuenta = e.movimientos.filter((m) => m.tipo === "gasto");

  const salidas = [
    { concepto: "Contenedores de calzado", monto: e.contenedoresCalzado },
    { concepto: "Contenedores de fundas", monto: e.contenedoresFundas },
    { concepto: "Comisión del agente (calzado)", monto: e.comisionAgenteCalzado },
    { concepto: "Comisión del agente (fundas)", monto: e.comisionAgenteFundas },
    // Los gastos en efectivo se pagaron en parte con ingresos sin comisión.
    { concepto: "Gastos en efectivo", monto: e.gastosEfectivo - ingresos },
    ...gastosCuenta.map((g) => ({ concepto: g.beneficiario ?? g.notas ?? "Gasto", monto: g.monto })),
  ];
  const totalSalidas = salidas.reduce((s, x) => s + x.monto, 0);
  const recibido = transferencias - comision;
  const ganancia = recibido - totalSalidas;

  const socios = e.socios.map((socio) => {
    const suyos = e.retiros.filter((r) => r.socioId === socio.id);
    const retirado = suyos.reduce((s, r) => s + r.monto, 0);
    const tsedaka = suyos.filter((r) => esTsedaka(r.concepto)).reduce((s, r) => s + r.monto, 0);
    const leToca = (ganancia * socio.porcentaje) / 100;
    return { socio, leToca, retirado, tsedaka, sobra: leToca - retirado, retiros: suyos.length };
  });

  const meses = new Map<string, { transferido: number; comision: number }>();
  for (const m of transf) {
    const mes = m.fecha ? m.fecha.slice(0, 7) : "sin fecha";
    const x = meses.get(mes) ?? { transferido: 0, comision: 0 };
    x.transferido += m.monto;
    x.comision += m.comision;
    meses.set(mes, x);
  }
  const benef = new Map<string, { monto: number; comision: number; movimientos: number }>();
  for (const m of transf) {
    const b = (m.beneficiario ?? "SIN BENEFICIARIO").trim().toUpperCase();
    const x = benef.get(b) ?? { monto: 0, comision: 0, movimientos: 0 };
    x.monto += m.monto;
    x.comision += m.comision;
    x.movimientos++;
    benef.set(b, x);
  }

  return {
    transferencias,
    comision,
    recibido,
    ingresos,
    salidas,
    totalSalidas,
    ganancia,
    socios,
    porMes: [...meses.entries()].map(([mes, x]) => ({ mes, ...x })).sort((a, b) => a.mes.localeCompare(b.mes)),
    porBeneficiario: [...benef.entries()]
      .map(([beneficiario, x]) => ({ beneficiario, ...x }))
      .sort((a, b) => b.monto - a.monto),
  };
}
