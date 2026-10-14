/**
 * PEDIDOS PENDIENTES POR ENVIAR (dueño, 11-oct-2026: «quiero una sección que
 * se llame pedidos pendientes por enviar con el dinero que serían y los CBMs
 * aprox, y ya se salen de ahí cuando ya están en un contenedor»).
 *
 * Por cada pedido vivo, las cajas que TODAVÍA no están en ningún contenedor
 * (un packing list de la fábrica ya las metió, aunque el contenedor siga en
 * borrador). Un pedido que llegó a medias se queda solo con lo que falta.
 *
 *   Dinero = lo que vale lo pendiente en la moneda de la fábrica (USD y RMB
 *   nunca se suman). Cada renglón vale precio × pares (con su precio por
 *   talla si lo tiene) y se escala al IMPORTE de la proforma cuando existe:
 *   JINJIANG y MINGTAI cobran más las tallas grandes y su importe es el bueno.
 *   CBM = cajas pendientes × m³ de su caja: el que trae la proforma o, si
 *   no, las medidas de una caja del mismo modelo con los mismos pares en un
 *   packing list anterior. Lo que no tiene medida se cuenta aparte.
 *
 * Motor puro (`resumirPendientes`) + lectura de la base (`cargarPendientes`).
 */
import type { Moneda } from "../importar/proforma";
import { canonizar } from "../importar/sku";
import { porTandas, traerTodo, type DB } from "../datos/repos";
import { perfilDeProveedor } from "../pedidos-china/fabricas";

/** Un contenedor de 40' HQ carga ~68 m³ de cajas. */
export const CBM_CONTENEDOR = 68;

export interface PedidoBase {
  id: string;
  pedido: string;
  proveedor: string | null;
  moneda: Moneda | null;
  importe: number | null;
  estado: string;
  origen: string;
  fecha: string | null;
}

export interface LineaBase {
  id: string;
  pedidoId: string;
  modelo: string;
  color: string;
  talla: string;
  tallas: Record<string, number>;
  paresPorCaja: number;
  cajas: number;
  pares: number;
  precio: number | null;
  preciosTalla: Record<string, number> | null;
  cbmCaja: number | null;
}

export interface PendienteRenglon {
  modelo: string;
  color: string;
  talla: string;
  cajasPendientes: number;
  paresPendientes: number;
}

export interface PedidoPendiente {
  id: string;
  pedido: string;
  fabrica: string;
  moneda: Moneda | null;
  fecha: string | null;
  dias: number | null;
  origen: string;
  modelos: string[];
  cajas: number;
  cajasPendientes: number;
  paresPendientes: number;
  /** dinero de lo pendiente, en `moneda`; null si algún renglón no tiene precio */
  dineroPendiente: number | null;
  cbmPendiente: number;
  cajasSinMedida: number;
  renglones: PendienteRenglon[];
}

export interface TotalesPendientes {
  pedidos: number;
  cajas: number;
  pares: number;
  usd: number;
  rmb: number;
  /** dinero de pedidos sin moneda conocida o sin precio */
  sinMoneda: number;
  pedidosSinPrecio: number;
  cbm: number;
  cajasSinMedida: number;
  contenedores: number;
}

export interface ResumenPendientes {
  pedidos: PedidoPendiente[];
  porFabrica: { fabrica: string; moneda: Moneda | null; pedidos: number; cajas: number; pares: number; dinero: number | null; cbm: number; cajasSinMedida: number }[];
  totales: TotalesPendientes;
}

function valorDeLinea(l: LineaBase): number | null {
  if (!l.talla && l.preciosTalla) {
    let v = 0;
    for (const [t, n] of Object.entries(l.tallas)) {
      const p = l.preciosTalla[t] ?? l.precio;
      if (p == null) return null;
      v += p * n * l.cajas;
    }
    return v;
  }
  return l.precio == null ? null : l.precio * l.pares;
}

/** m³ de una caja de ese modelo con esos pares, de las medidas de packing lists. */
export type MedidasPorCaja = Map<string, number>;
export function claveMedida(modelo: string, paresPorCaja: number): string {
  return `${canonizar(modelo)}|${paresPorCaja}`;
}

export function resumirPendientes(
  pedidos: PedidoBase[],
  lineas: LineaBase[],
  asignadas: Map<string, number>,
  medidas: MedidasPorCaja,
  ahora = Date.now(),
): ResumenPendientes {
  const porPedido = new Map<string, LineaBase[]>();
  for (const l of lineas) {
    const g = porPedido.get(l.pedidoId);
    if (g) g.push(l);
    else porPedido.set(l.pedidoId, [l]);
  }

  const salida: PedidoPendiente[] = [];
  for (const p of pedidos) {
    if (p.estado === "recibido" || p.estado === "cancelado") continue;
    const ls = porPedido.get(p.id) ?? [];
    let cajas = 0;
    let cajasPend = 0;
    let paresPend = 0;
    let valorTotal = 0;
    let valorPend = 0;
    let sinPrecio = false;
    let cbm = 0;
    let sinMedida = 0;
    const renglones: PendienteRenglon[] = [];
    for (const l of ls) {
      cajas += l.cajas;
      const pend = Math.max(0, l.cajas - (asignadas.get(l.id) ?? 0));
      const v = valorDeLinea(l);
      if (v == null) sinPrecio = true;
      else valorTotal += v;
      if (!pend) continue;
      const fr = l.cajas > 0 ? pend / l.cajas : 0;
      cajasPend += pend;
      const pares = Math.round(l.pares * fr);
      paresPend += pares;
      if (v != null) valorPend += v * fr;
      const m3 = l.cbmCaja && l.cbmCaja > 0 ? l.cbmCaja : medidas.get(claveMedida(l.modelo, l.paresPorCaja));
      if (m3) cbm += m3 * pend;
      else sinMedida += pend;
      renglones.push({ modelo: l.modelo, color: l.color, talla: l.talla, cajasPendientes: pend, paresPendientes: pares });
    }
    if (!cajasPend) continue;
    // Escalar al importe de la proforma cuando todo tiene precio.
    const factor = !sinPrecio && p.importe && valorTotal > 0 ? p.importe / valorTotal : 1;
    const fecha = p.fecha;
    salida.push({
      id: p.id,
      pedido: p.pedido,
      fabrica: perfilDeProveedor(p.proveedor)?.nombre ?? p.proveedor ?? "Sin fábrica",
      moneda: p.moneda,
      fecha,
      dias: fecha ? Math.max(0, Math.floor((ahora - Date.parse(fecha)) / 86_400_000)) : null,
      origen: p.origen,
      modelos: [...new Set(ls.map((l) => l.modelo))].sort(),
      cajas,
      cajasPendientes: cajasPend,
      paresPendientes: paresPend,
      dineroPendiente: sinPrecio ? null : Math.round(valorPend * factor * 100) / 100,
      cbmPendiente: Math.round(cbm * 1000) / 1000,
      cajasSinMedida: sinMedida,
      renglones,
    });
  }
  salida.sort((a, b) => a.fabrica.localeCompare(b.fabrica) || b.pedido.localeCompare(a.pedido, "en", { numeric: true }));

  const fabricas = new Map<string, ResumenPendientes["porFabrica"][number]>();
  const t: TotalesPendientes = { pedidos: 0, cajas: 0, pares: 0, usd: 0, rmb: 0, sinMoneda: 0, pedidosSinPrecio: 0, cbm: 0, cajasSinMedida: 0, contenedores: 0 };
  for (const p of salida) {
    t.pedidos++;
    t.cajas += p.cajasPendientes;
    t.pares += p.paresPendientes;
    t.cbm += p.cbmPendiente;
    t.cajasSinMedida += p.cajasSinMedida;
    if (p.dineroPendiente == null) t.pedidosSinPrecio++;
    else if (p.moneda === "USD") t.usd += p.dineroPendiente;
    else if (p.moneda === "RMB") t.rmb += p.dineroPendiente;
    else t.sinMoneda += p.dineroPendiente;

    const k = `${p.fabrica}|${p.moneda ?? ""}`;
    const f = fabricas.get(k) ?? { fabrica: p.fabrica, moneda: p.moneda, pedidos: 0, cajas: 0, pares: 0, dinero: 0, cbm: 0, cajasSinMedida: 0 };
    f.pedidos++;
    f.cajas += p.cajasPendientes;
    f.pares += p.paresPendientes;
    f.dinero = f.dinero == null || p.dineroPendiente == null ? null : f.dinero + p.dineroPendiente;
    f.cbm += p.cbmPendiente;
    f.cajasSinMedida += p.cajasSinMedida;
    fabricas.set(k, f);
  }
  t.usd = Math.round(t.usd * 100) / 100;
  t.rmb = Math.round(t.rmb * 100) / 100;
  t.cbm = Math.round(t.cbm * 100) / 100;
  t.contenedores = Math.round((t.cbm / CBM_CONTENEDOR) * 10) / 10;

  return {
    pedidos: salida,
    porFabrica: [...fabricas.values()].sort((a, b) => b.cbm - a.cbm),
    totales: t,
  };
}

export async function cargarPendientes(db: DB, accountId: string): Promise<ResumenPendientes> {
  const pedidosRaw = await traerTodo<{
    id: string;
    pedido: string;
    proveedor: string | null;
    moneda: Moneda | null;
    importe: number | null;
    estado: string;
    origen: string | null;
    fecha_pi: string | null;
    creado_en: string;
  }>(db, "pedidos", "id, pedido, proveedor, moneda, importe, estado, origen, fecha_pi, creado_en", (q) =>
    q.eq("account_id", accountId).not("estado", "in", "(recibido,cancelado)"),
  );
  const pedidos: PedidoBase[] = pedidosRaw.map((p) => ({
    id: p.id,
    pedido: p.pedido,
    proveedor: p.proveedor,
    moneda: p.moneda,
    importe: p.importe == null ? null : Number(p.importe),
    estado: p.estado,
    origen: p.origen ?? "proforma",
    fecha: p.fecha_pi ?? p.creado_en,
  }));

  const lineasRaw = await porTandas(
    pedidos.map((p) => p.id),
    200,
    (ids) =>
      traerTodo<{
        id: string;
        pedido_id: string;
        modelo: string;
        color: string;
        talla: string | null;
        tallas: Record<string, number>;
        pares_por_caja: number;
        cajas: number;
        pares: number;
        precio_unitario: number | null;
        precios_talla: Record<string, number> | null;
        cbm_caja: number | null;
      }>(
        db,
        "pedido_lineas",
        "id, pedido_id, modelo, color, talla, tallas, pares_por_caja, cajas, pares, precio_unitario, precios_talla, cbm_caja",
        (q) => q.in("pedido_id", ids),
      ),
  );
  const lineas: LineaBase[] = lineasRaw.map((l) => ({
    id: l.id,
    pedidoId: l.pedido_id,
    modelo: l.modelo,
    color: l.color,
    talla: l.talla ?? "",
    tallas: l.tallas ?? {},
    paresPorCaja: Number(l.pares_por_caja) || 0,
    cajas: Number(l.cajas) || 0,
    pares: Number(l.pares) || 0,
    precio: l.precio_unitario == null ? null : Number(l.precio_unitario),
    preciosTalla: l.precios_talla,
    cbmCaja: l.cbm_caja == null ? null : Number(l.cbm_caja),
  }));

  const asignadasRaw = await porTandas(
    lineas.map((l) => l.id),
    200,
    (ids) =>
      traerTodo<{ id: string; pedido_linea_id: string; cajas: number }>(db, "contenedor_lineas", "id, pedido_linea_id, cajas", (q) =>
        q.in("pedido_linea_id", ids),
      ),
  );
  const asignadas = new Map<string, number>();
  for (const a of asignadasRaw) asignadas.set(a.pedido_linea_id, (asignadas.get(a.pedido_linea_id) ?? 0) + (Number(a.cajas) || 0));

  // Medidas de caja por modelo + pares, de TODOS los packing lists.
  const conMedida = await traerTodo<{ id: string; pedido_linea_id: string; largo_cm: number; ancho_cm: number; alto_cm: number }>(
    db,
    "contenedor_lineas",
    "id, pedido_linea_id, largo_cm, ancho_cm, alto_cm",
    (q) => q.not("largo_cm", "is", null).not("ancho_cm", "is", null).not("alto_cm", "is", null),
  );
  const lineasConMedida = await porTandas(
    [...new Set(conMedida.map((m) => m.pedido_linea_id))],
    200,
    (ids) =>
      traerTodo<{ id: string; modelo: string; pares_por_caja: number }>(db, "pedido_lineas", "id, modelo, pares_por_caja", (q) =>
        q.in("id", ids),
      ),
  );
  const lineaDe = new Map(lineasConMedida.map((l) => [l.id, l]));
  const medidas: MedidasPorCaja = new Map();
  for (const m of conMedida) {
    const l = lineaDe.get(m.pedido_linea_id);
    if (!l) continue;
    const m3 = (Number(m.largo_cm) * Number(m.ancho_cm) * Number(m.alto_cm)) / 1e6;
    if (m3 > 0) medidas.set(claveMedida(l.modelo, Number(l.pares_por_caja)), m3);
  }

  return resumirPendientes(pedidos, lineas, asignadas, medidas);
}
