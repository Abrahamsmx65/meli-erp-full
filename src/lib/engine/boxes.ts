/**
 * Optimizador de cajas mixtas (corridas).
 *
 * El problema: una caja trae varios SKUs en cantidades fijas. Nunca vas a
 * poder darle a cada SKU exactamente lo que pidió — pedir 40 de A y 12 de B
 * cuando la caja trae 24 de A y 24 de B significa elegir el mal menor.
 *
 * Se resuelve minimizando un costo que castiga quedarse corto más fuerte que
 * pasarse (quedarte corto es venta perdida; pasarte es capital dormido), y
 * castiga extra el faltante de los SKUs que ya están en rojo.
 *
 * Método: arranque codicioso + búsqueda local (quitar y permutar cajas).
 * Para catálogos de este tamaño encuentra el óptimo o queda muy cerca, y
 * corre en milisegundos sin dependencias externas.
 */
import type { Caja, CajaElegida, PlanCajas } from "./types";

interface Entrada {
  /** piezas que cada SKU necesita recibir */
  necesidad: Map<string, number>;
  /** multiplicador de castigo por faltante (SKU crítico duele más) */
  prioridad: Map<string, number>;
  /**
   * Multiplicador de castigo por sobrante. Mandar de más a un SKU que ya
   * está en sobrestock cuesta bodega en MELI y capital dormido: tiene que
   * doler más que mandarle de más a uno que va justo.
   */
  castigoSobrante?: Map<string, number>;
  /**
   * Demanda diaria por SKU. Se usa para medir el error en DÍAS DE COBERTURA
   * en vez de en piezas: quedarse 100 piezas corto en algo que vende 50/día
   * son 2 días de quiebre, pero en algo que vende 2/día son 50. Sin esto el
   * optimizador maltrata sistemáticamente a los SKUs de baja rotación.
   */
  demandaDiaria?: Map<string, number>;
  cajas: Caja[];
  permiteUnidadesSueltas: boolean;
  /** piezas sueltas en bodega, por SKU */
  inventarioSuelto: Map<string, number>;
  pesoFaltante: number;
  pesoSobrante: number;
  /** tope de cajas por envío (0 o undefined = sin tope) */
  maxCajas?: number;
  /** tope de piezas por envío (0 o undefined = sin tope) */
  maxPiezas?: number;
}

/**
 * Costo de un SKU dado lo que se le manda vs. lo que pidió, expresado en
 * DÍAS de error (piezas ÷ venta diaria) y ponderado por urgencia.
 */
function costoSku(
  enviado: number,
  necesario: number,
  prio: number,
  castigo: number,
  demanda: number,
  pf: number,
  ps: number,
): number {
  // Piso: un SKU casi muerto no debe generar "días" infinitos de error.
  const d = Math.max(demanda, 0.5);
  if (enviado < necesario) return (pf * prio * (necesario - enviado)) / d;
  return (ps * castigo * (enviado - necesario)) / d;
}

export function optimizarCajas(e: Entrada): PlanCajas {
  const { pesoFaltante: pf, pesoSobrante: ps } = e;

  // Universo de SKUs: los que piden algo + los que alguna caja arrastra.
  const universo = new Set<string>(e.necesidad.keys());
  for (const c of e.cajas) for (const it of c.items) universo.add(it.sku);

  const nec = (s: string) => e.necesidad.get(s) ?? 0;
  const prio = (s: string) => e.prioridad.get(s) ?? 1;
  const castigo = (s: string) => e.castigoSobrante?.get(s) ?? 1;
  const dem = (s: string) => e.demandaDiaria?.get(s) ?? 1;

  const cajas = e.cajas.filter((c) => c.cajasDisponibles > 0 && c.items.length > 0);
  const piezasDe = new Map(
    cajas.map((c) => [c.codigo, c.items.reduce((a, it) => a + it.piezas, 0)]),
  );

  const enviado = new Map<string, number>();
  for (const s of universo) enviado.set(s, 0);

  const q = new Map<string, number>();          // código -> cajas elegidas
  for (const c of cajas) q.set(c.codigo, 0);

  let cajasUsadas = 0;
  let piezasUsadas = 0;
  const maxCajas = e.maxCajas && e.maxCajas > 0 ? e.maxCajas : Infinity;
  const maxPiezas = e.maxPiezas && e.maxPiezas > 0 ? e.maxPiezas : Infinity;

  const costoTotal = (): number => {
    let t = 0;
    for (const s of universo) {
      t += costoSku(enviado.get(s) ?? 0, nec(s), prio(s), castigo(s), dem(s), pf, ps);
    }
    return t;
  };

  /** Cambio de costo si sumo (signo=+1) o resto (signo=-1) una caja. */
  const delta = (c: Caja, signo: 1 | -1): number => {
    let d = 0;
    for (const it of c.items) {
      const actual = enviado.get(it.sku) ?? 0;
      const nuevo = Math.max(0, actual + signo * it.piezas);
      d +=
        costoSku(nuevo, nec(it.sku), prio(it.sku), castigo(it.sku), dem(it.sku), pf, ps) -
        costoSku(actual, nec(it.sku), prio(it.sku), castigo(it.sku), dem(it.sku), pf, ps);
    }
    return d;
  };

  /** ¿Cabe una caja más de este tipo? (disponibilidad + capacidad del envío) */
  const cabe = (c: Caja): boolean =>
    (q.get(c.codigo) ?? 0) < c.cajasDisponibles &&
    cajasUsadas + 1 <= maxCajas &&
    piezasUsadas + (piezasDe.get(c.codigo) ?? 0) <= maxPiezas;

  const aplicar = (c: Caja, signo: 1 | -1): void => {
    for (const it of c.items) {
      const actual = enviado.get(it.sku) ?? 0;
      enviado.set(it.sku, Math.max(0, actual + signo * it.piezas));
    }
    q.set(c.codigo, (q.get(c.codigo) ?? 0) + signo);
    cajasUsadas += signo;
    piezasUsadas += signo * (piezasDe.get(c.codigo) ?? 0);
  };

  const topeIteraciones = Math.min(
    20_000,
    cajas.reduce((a, c) => a + c.cajasDisponibles, 0) + 50,
  );

  // ---- Fase 1: codicioso -------------------------------------------------
  for (let i = 0; i < topeIteraciones; i++) {
    let mejor: Caja | null = null;
    let mejorDelta = -1e-9;
    for (const c of cajas) {
      if (!cabe(c)) continue;
      const d = delta(c, 1);
      if (d < mejorDelta) {
        mejorDelta = d;
        mejor = c;
      }
    }
    if (!mejor) break;
    aplicar(mejor, 1);
  }

  // ---- Fase 2: búsqueda local (quitar / permutar) ------------------------
  //
  // El costo de una permutación se calcula SOLO sobre los SKUs que tocan las
  // dos cajas involucradas. Evaluar el costo completo por cada par sería
  // cuadrático en tipos de caja por el tamaño del catálogo, y con cientos de
  // corridas y más de mil SKUs eso son cientos de millones de operaciones
  // por barrida.
  const deltaPermuta = (quitar: Caja, poner: Caja): number => {
    const cambios = new Map<string, number>();
    for (const it of quitar.items) {
      cambios.set(it.sku, (cambios.get(it.sku) ?? 0) - it.piezas);
    }
    for (const it of poner.items) {
      cambios.set(it.sku, (cambios.get(it.sku) ?? 0) + it.piezas);
    }

    let d = 0;
    for (const [sku, cambio] of cambios) {
      if (cambio === 0) continue;
      const actual = enviado.get(sku) ?? 0;
      const nuevo = Math.max(0, actual + cambio);
      d +=
        costoSku(nuevo, nec(sku), prio(sku), castigo(sku), dem(sku), pf, ps) -
        costoSku(actual, nec(sku), prio(sku), castigo(sku), dem(sku), pf, ps);
    }
    return d;
  };

  // Índice SKU -> cajas que lo contienen. Sin tope de capacidad, permutar dos
  // cajas que no comparten ningún SKU equivale a quitar una y poner otra por
  // separado, cosa que las otras fases ya cubren: no vale la pena mirarlas.
  const cajasPorSku = new Map<string, Caja[]>();
  for (const c of cajas) {
    for (const it of c.items) {
      const l = cajasPorSku.get(it.sku);
      if (l) l.push(c);
      else cajasPorSku.set(it.sku, [c]);
    }
  }
  const hayTope = maxCajas !== Infinity || maxPiezas !== Infinity;

  const candidatas = (a: Caja): Caja[] => {
    if (hayTope) return cajas;
    const vistas = new Set<string>();
    const out: Caja[] = [];
    for (const it of a.items) {
      for (const c of cajasPorSku.get(it.sku) ?? []) {
        if (c.codigo === a.codigo || vistas.has(c.codigo)) continue;
        vistas.add(c.codigo);
        out.push(c);
      }
    }
    return out;
  };

  let mejoro = true;
  let vueltas = 0;
  while (mejoro && vueltas++ < 60) {
    mejoro = false;

    // Quitar una caja que ya no aporta.
    for (const c of cajas) {
      if ((q.get(c.codigo) ?? 0) <= 0) continue;
      if (delta(c, -1) < -1e-9) {
        aplicar(c, -1);
        mejoro = true;
      }
    }

    // Permutar: cambiar una caja de tipo A por una de tipo B.
    for (const a of cajas) {
      if ((q.get(a.codigo) ?? 0) <= 0) continue;
      for (const b of candidatas(a)) {
        if ((q.get(b.codigo) ?? 0) >= b.cajasDisponibles) continue;
        // Con tope de piezas, la permuta puede no caber aunque el conteo sí.
        if (hayTope) {
          const dif = (piezasDe.get(b.codigo) ?? 0) - (piezasDe.get(a.codigo) ?? 0);
          if (piezasUsadas + dif > maxPiezas) continue;
        }
        if (deltaPermuta(a, b) < -1e-9) {
          aplicar(a, -1);
          aplicar(b, 1);
          mejoro = true;
          if ((q.get(a.codigo) ?? 0) <= 0) break;
        }
      }
    }
  }

  // ---- Fase 2.5: rescate de tallas faltantes ------------------------------
  // Regla del negocio: NUNCA se deja de mandar una talla que falta solo
  // porque las demás tallas de su caja van a sobrar. Si el optimizador dejó
  // faltantes que alguna caja disponible sí trae, esas cajas se fuerzan; y
  // cuando casi toda la caja es sobrante ("muy diferencial"), la caja entra
  // marcada como OPCIONAL para que el usuario decida si la sube.
  const opcionales = new Map<string, number>();
  const sinRemedio = new Set<string>();
  for (let vuelta = 0; vuelta < topeIteraciones; vuelta++) {
    // El SKU pedido con el faltante más grande, medido en días de venta.
    let skuFalta: string | null = null;
    let peorDias = 0.25; // faltantes de menos de ~un cuarto de día se toleran
    for (const s of e.necesidad.keys()) {
      if (sinRemedio.has(s)) continue;
      const falta = nec(s) - (enviado.get(s) ?? 0);
      if (falta <= 0) continue;
      const diasFalta = falta / Math.max(dem(s), 0.5);
      if (diasFalta > peorDias) {
        peorDias = diasFalta;
        skuFalta = s;
      }
    }
    if (!skuFalta) break;

    // La caja que lo trae con la MAYOR fracción de piezas útiles (que tapan
    // faltantes reales de cualquier SKU) y la menor de sobrante.
    let mejor: Caja | null = null;
    let mejorPuntaje = -Infinity;
    for (const c of cajasPorSku.get(skuFalta) ?? []) {
      if (!cabe(c)) continue;
      let utiles = 0;
      let piezas = 0;
      for (const it of c.items) {
        piezas += it.piezas;
        const falta = Math.max(0, nec(it.sku) - (enviado.get(it.sku) ?? 0));
        utiles += Math.min(falta, it.piezas);
      }
      const puntaje = piezas > 0 ? utiles / piezas : 0;
      if (puntaje > mejorPuntaje) {
        mejorPuntaje = puntaje;
        mejor = c;
      }
    }
    if (!mejor) {
      // Ninguna caja disponible trae esta talla (o ya no cabe): de verdad
      // no se puede, y se sigue con el siguiente faltante.
      sinRemedio.add(skuFalta);
      continue;
    }

    aplicar(mejor, 1);
    // "Muy diferencial": menos del 35% de la caja tapa faltantes reales.
    if (mejorPuntaje < 0.35) {
      opcionales.set(mejor.codigo, (opcionales.get(mejor.codigo) ?? 0) + 1);
    }
  }

  // ---- Fase 3: piezas sueltas para cerrar el hueco -----------------------
  const sueltas: { sku: string; piezas: number }[] = [];
  if (e.permiteUnidadesSueltas) {
    for (const s of universo) {
      const falta = nec(s) - (enviado.get(s) ?? 0);
      if (falta <= 0) continue;
      const disponible = e.inventarioSuelto.get(s) ?? 0;
      const espacio = maxPiezas - piezasUsadas;
      const mandar = Math.min(falta, disponible, espacio);
      if (mandar > 0) {
        sueltas.push({ sku: s, piezas: mandar });
        enviado.set(s, (enviado.get(s) ?? 0) + mandar);
        piezasUsadas += mandar;
      }
    }
    sueltas.sort((a, b) => b.piezas - a.piezas);
  }

  // ---- Resultado ---------------------------------------------------------
  const elegidas: CajaElegida[] = cajas
    .filter((c) => (q.get(c.codigo) ?? 0) > 0)
    .map((c) => {
      const cantidad = q.get(c.codigo) ?? 0;
      const piezasPorCaja = c.items.reduce((a, it) => a + it.piezas, 0);
      return {
        codigo: c.codigo,
        nombre: c.nombre ?? null,
        cantidad,
        piezasPorCaja,
        aporta: c.items.map((it) => ({ sku: it.sku, piezas: it.piezas * cantidad })),
        cantidadOpcional: opcionales.get(c.codigo) ?? 0,
      };
    })
    .sort((a, b) => b.cantidad * b.piezasPorCaja - a.cantidad * a.piezasPorCaja);

  const faltantePorSku = new Map<string, number>();
  const sobrantePorSku = new Map<string, number>();
  for (const s of universo) {
    const env = enviado.get(s) ?? 0;
    const n = nec(s);
    if (env < n) faltantePorSku.set(s, n - env);
    else if (env > n) sobrantePorSku.set(s, env - n);
  }

  const totalCajas = elegidas.reduce((a, c) => a + c.cantidad, 0);
  const totalPiezas =
    elegidas.reduce((a, c) => a + c.cantidad * c.piezasPorCaja, 0) +
    sueltas.reduce((a, s) => a + s.piezas, 0);

  return {
    cajas: elegidas,
    sueltas,
    enviadoPorSku: enviado,
    faltantePorSku,
    sobrantePorSku,
    costo: costoTotal(),
    totalCajas,
    totalPiezas,
  };
}
