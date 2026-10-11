/**
 * Cuenta con Rafa y socios: lee lo capturado (`cuenta_paralela`, `socios`,
 * `socios_retiros`, los gastos en EFECTIVO de Gastos) y lo pagado por los
 * contenedores (`finanzas:costeo`), y arma la pestaña TOTAL del sheet del
 * dueño con el motor de `finanzas/cuenta.ts`. Lecturas chicas (cientos de
 * renglones): se calcula al leer.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import {
  comisionDeTransferencia,
  resumenCuenta,
  type MovimientoCuenta,
  type Retiro,
  type ResumenCuenta,
  type Socio,
} from "../finanzas/cuenta";
import { leerCacheAppGuardado } from "./cache-app";
import { CLAVE_COSTEO, recalcularCosteo, type ResultadoCosteo } from "./costeo";

export interface DatosCuenta {
  movimientos: MovimientoCuenta[];
  socios: Socio[];
  retiros: Retiro[];
  resumen: ResumenCuenta;
  costeoEn: string | null;
  avisos: string[];
}

const n = (x: unknown) => (x == null || !Number.isFinite(Number(x)) ? 0 : Number(x));

export async function cargarCuenta(db: DB, accountId: string, admin: DB): Promise<DatosCuenta> {
  const avisos: string[] = [];
  const [movs, socios, retiros, gastos] = await Promise.all([
    traerTodo<any>(db, "cuenta_paralela", "id, fecha, tipo, monto, beneficiario, referencia, comision, notas", (q) =>
      q.eq("account_id", accountId),
    ),
    traerTodo<any>(db, "socios", "id, nombre, porcentaje, orden", (q) => q.eq("account_id", accountId)),
    traerTodo<any>(db, "socios_retiros", "id, socio_id, fecha, concepto, monto", (q) => q.eq("account_id", accountId)),
    traerTodo<any>(db, "gastos_empresariales", "id, monto, medio, omitido", (q) =>
      q.eq("account_id", accountId).eq("medio", "efectivo"),
    ),
  ]);

  let costeo = await leerCacheAppGuardado<ResultadoCosteo>(db, accountId, CLAVE_COSTEO);
  let datosCosteo = costeo.estado === "encontrado" ? costeo.valor.datos : null;
  // Un costeo guardado antes de los contenedores de fundas no trae `negocio`.
  if (!datosCosteo || datosCosteo.contenedores.some((c) => c.negocio == null)) {
    try {
      datosCosteo = await recalcularCosteo(admin, accountId);
    } catch (err) {
      avisos.push(`No se pudo recalcular el costeo: ${(err as Error).message}`);
    }
  }
  const contenedores = datosCosteo?.contenedores ?? [];
  if (!contenedores.length) avisos.push("Sin costeo de contenedores: las salidas a China van en cero.");
  const suma = (negocio: string, f: (c: (typeof contenedores)[number]) => number) =>
    contenedores.filter((c) => (c.negocio ?? (c.id.startsWith("P") ? "fundas" : "calzado")) === negocio).reduce((s, c) => s + f(c), 0);

  const movimientos: MovimientoCuenta[] = movs
    .map((m) => ({
      id: Number(m.id),
      fecha: m.fecha,
      tipo: m.tipo,
      monto: n(m.monto),
      beneficiario: m.beneficiario,
      referencia: m.referencia,
      comision: n(m.comision),
      notas: m.notas,
    }))
    .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.id - a.id);
  const listaSocios: Socio[] = socios
    .sort((a, b) => a.orden - b.orden)
    .map((s) => ({ id: Number(s.id), nombre: s.nombre, porcentaje: n(s.porcentaje) }));
  const listaRetiros: Retiro[] = retiros
    .map((r) => ({ id: Number(r.id), socioId: Number(r.socio_id), fecha: r.fecha, concepto: r.concepto, monto: n(r.monto) }))
    .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.id - a.id);

  const resumen = resumenCuenta({
    movimientos,
    contenedoresCalzado: suma("calzado", (c) => c.totalMxn),
    contenedoresFundas: suma("fundas", (c) => c.totalMxn),
    comisionAgenteCalzado: suma("calzado", (c) => c.comisionAgente ?? 0),
    comisionAgenteFundas: suma("fundas", (c) => c.comisionAgente ?? 0),
    gastosEfectivo: gastos.filter((g) => !g.omitido).reduce((s, g) => s + n(g.monto), 0),
    socios: listaSocios,
    retiros: listaRetiros,
  });
  return { movimientos, socios: listaSocios, retiros: listaRetiros, resumen, costeoEn: datosCosteo?.generadoEn ?? null, avisos };
}

const fechaValida = (x: unknown): string | null => {
  const s = String(x ?? "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("La fecha va como AAAA-MM-DD.");
  return s;
};
const monto = (x: unknown): number => {
  const v = Number(x);
  if (!Number.isFinite(v) || v === 0) throw new Error("El monto debe ser un número distinto de cero.");
  return Math.round(v * 100) / 100;
};
const texto = (x: unknown, max = 200): string | null => {
  const s = String(x ?? "").trim();
  return s ? s.slice(0, max) : null;
};

export async function agregarMovimiento(
  db: DB,
  accountId: string,
  m: { fecha?: string; tipo?: string; monto?: number; beneficiario?: string; referencia?: string; notas?: string },
): Promise<void> {
  const tipo = m.tipo === "ingreso" || m.tipo === "gasto" ? m.tipo : "transferencia";
  const valor = monto(m.monto);
  const { error } = await db.from("cuenta_paralela").insert({
    account_id: accountId,
    fecha: fechaValida(m.fecha),
    tipo,
    monto: valor,
    beneficiario: texto(m.beneficiario)?.toUpperCase() ?? null,
    referencia: texto(m.referencia)?.toUpperCase() ?? null,
    comision: tipo === "transferencia" ? comisionDeTransferencia(valor) : 0,
    notas: texto(m.notas),
  });
  if (error) throw new Error(`cuenta_paralela: ${error.message}`);
}

export async function borrarMovimiento(db: DB, accountId: string, id: number): Promise<void> {
  const { error } = await db.from("cuenta_paralela").delete().eq("account_id", accountId).eq("id", id);
  if (error) throw new Error(`cuenta_paralela: ${error.message}`);
}

export async function agregarRetiro(
  db: DB,
  accountId: string,
  r: { socioId?: number; fecha?: string; concepto?: string; monto?: number },
): Promise<void> {
  const concepto = texto(r.concepto);
  if (!concepto) throw new Error("Falta el concepto.");
  const { error } = await db.from("socios_retiros").insert({
    account_id: accountId,
    socio_id: Number(r.socioId),
    fecha: fechaValida(r.fecha),
    concepto: concepto.toUpperCase(),
    monto: monto(r.monto),
  });
  if (error) throw new Error(`socios_retiros: ${error.message}`);
}

export async function borrarRetiro(db: DB, accountId: string, id: number): Promise<void> {
  const { error } = await db.from("socios_retiros").delete().eq("account_id", accountId).eq("id", id);
  if (error) throw new Error(`socios_retiros: ${error.message}`);
}
