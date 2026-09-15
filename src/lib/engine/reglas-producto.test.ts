import { describe, expect, it } from "vitest";
import { generarPlan, type EntradaPlan } from "./index";
import { calcularDemanda } from "./demand";
import { optimizarCajas } from "./boxes";
import { ajustarNecesidadPorCorrida } from "./corrida";
import { normalizarParametros } from "./params";
import { rangoFechas, sumarDias } from "./fechas";
import type { Caja, DiaStock, SnapshotStock, VentaDiaria } from "./types";

// Las tres reglas que el dueño pidió el 9-sep-2026 al revisar por qué el
// plan pedía tan pocas cajas de EnvioPack:
//  1. Producto NUEVO en crecimiento (GT190…): cualquier faltante fuerza su
//     caja, sin la tolerancia de rescate de 7 días, y la caja va firme.
//  2. Quedar en 32 días en vez de 30 no es sobre-surtir (holgura).
//  3. Producto SIN ESTRENO (nunca tuvo stock ni venta) con cajas en
//     cualquier bodega: mínimo 2 cajas por modelo + color.

const HOY = "2026-09-09";
const P = normalizarParametros({ diasHistoria: 90 });

function dia(p: Partial<DiaStock> & { fecha: string }): DiaStock {
  return { inicio: 0, fin: 0, unidades: 0, fraccionConStock: 0, origen: "snapshot", ...p };
}

describe("lanzamiento en la demanda", () => {
  it("detecta el primer día con dato cuando la prehistoria es desconocida", () => {
    const dias: DiaStock[] = [];
    for (let i = 0; i < 10; i++) dias.push(dia({ fecha: `2026-08-0${i + 1}`, origen: "desconocido" }));
    for (let i = 0; i < 5; i++) {
      dias.push(dia({ fecha: `2026-08-1${i + 1}`, inicio: 5, fin: 5, origen: "snapshot" }));
    }
    const d = calcularDemanda("X", dias, P);
    expect(d.lanzamiento).toBe("2026-08-11");
    expect(d.diasDesdeLanzamiento).toBe(5);
  });

  it("un SKU con datos desde el primer día de la ventana no es lanzamiento", () => {
    const dias = Array.from({ length: 6 }, (_, i) =>
      dia({ fecha: `2026-08-0${i + 1}`, inicio: 5, fin: 5, unidades: 1 }),
    );
    const d = calcularDemanda("X", dias, P);
    expect(d.lanzamiento).toBeNull();
    expect(d.diasDesdeLanzamiento).toBeNull();
  });

  it("sin ningún dato tampoco hay lanzamiento", () => {
    const dias = Array.from({ length: 6 }, (_, i) =>
      dia({ fecha: `2026-08-0${i + 1}`, origen: "desconocido" }),
    );
    expect(calcularDemanda("X", dias, P).lanzamiento).toBeNull();
  });
});

describe("regla de la corrida: exentos", () => {
  it("no recorta la talla de un producto nuevo aunque la corrida esté dispareja", () => {
    const caja: Caja = {
      codigo: "C",
      cajasDisponibles: 5,
      items: [
        { sku: "A", piezas: 6 },
        { sku: "B", piezas: 18 },
      ],
    };
    const necesidad = new Map([["A", 12]]);
    const datos = new Map([
      ["A", { posicion: 0, demandaDiaria: 0.4 }],
      ["B", { posicion: 200, demandaDiaria: 0.5 }], // 13× su venta: dispareja
    ]);
    const sinExentos = ajustarNecesidadPorCorrida({
      necesidad: new Map(necesidad),
      datos,
      cajas: [caja],
      horizonteDias: 30,
    });
    expect(sinExentos).toHaveLength(1);

    const conExentos = ajustarNecesidadPorCorrida({
      necesidad,
      datos,
      cajas: [caja],
      horizonteDias: 30,
      exentos: new Set(["A"]),
    });
    expect(conExentos).toHaveLength(0);
    expect(necesidad.get("A")).toBe(12);
  });
});

describe("optimizador: holgura, piso y cajas firmes", () => {
  const base = {
    permiteUnidadesSueltas: false,
    inventarioSuelto: new Map<string, number>(),
    pesoFaltante: 3,
    pesoSobrante: 1,
  };

  it("lo que cae dentro de la holgura del objetivo no cuesta como sobrante", () => {
    // A pide 10 y la caja trae 10 de A y 4 de B, que no pide nada y castiga
    // 4×: sin holgura la caja no conviene (32 de castigo contra 30 de
    // beneficio); con 4 piezas de holgura para B, sí.
    const caja: Caja = {
      codigo: "C",
      cajasDisponibles: 1,
      items: [
        { sku: "A", piezas: 10 },
        { sku: "B", piezas: 4 },
      ],
    };
    const comun = {
      ...base,
      necesidad: new Map([["A", 10]]),
      prioridad: new Map([["A", 1]]),
      castigoSobrante: new Map([["B", 4]]),
      demandaDiaria: new Map([
        ["A", 1],
        ["B", 0.5],
      ]),
      cajas: [caja],
      toleranciaRescateDias: 30,
    };
    expect(optimizarCajas(comun).totalCajas).toBe(0);
    expect(
      optimizarCajas({ ...comun, holguraSobrante: new Map([["B", 4]]) }).totalCajas,
    ).toBe(1);
  });

  it("el piso por caja viaja aunque nadie lo pida y la búsqueda local no lo quita", () => {
    const caja: Caja = {
      codigo: "Z",
      cajasDisponibles: 5,
      items: [
        { sku: "Z1", piezas: 12 },
        { sku: "Z2", piezas: 12 },
      ],
    };
    const r = optimizarCajas({
      ...base,
      necesidad: new Map(),
      prioridad: new Map(),
      castigoSobrante: new Map([
        ["Z1", 4],
        ["Z2", 4],
      ]),
      cajas: [caja],
      pisoPorCaja: new Map([["Z", 2]]),
    });
    expect(r.totalCajas).toBe(2);
    expect(r.cajas[0].cantidadOpcional ?? 0).toBe(0);
  });

  it("el piso respeta la disponibilidad y el tope de cajas", () => {
    const caja: Caja = { codigo: "Z", cajasDisponibles: 1, items: [{ sku: "Z1", piezas: 12 }] };
    const r = optimizarCajas({
      ...base,
      necesidad: new Map(),
      prioridad: new Map(),
      cajas: [caja],
      pisoPorCaja: new Map([["Z", 2]]),
    });
    expect(r.totalCajas).toBe(1);
    const topada = optimizarCajas({
      ...base,
      necesidad: new Map(),
      prioridad: new Map(),
      cajas: [{ ...caja, cajasDisponibles: 5 }],
      pisoPorCaja: new Map([["Z", 3]]),
      maxCajas: 2,
    });
    expect(topada.totalCajas).toBe(2);
  });

  it("la caja de rescate de un SKU firme no sube como opcional", () => {
    // A pide 2 piezas y la caja trae 6 de A y 18 de B (sobrestock):
    // muy diferencial (8% útil) → opcional, salvo que A sea de producto nuevo.
    const caja: Caja = {
      codigo: "C",
      cajasDisponibles: 1,
      items: [
        { sku: "A", piezas: 6 },
        { sku: "B", piezas: 18 },
      ],
    };
    const comun = {
      ...base,
      necesidad: new Map([["A", 2]]),
      prioridad: new Map([["A", 1.8]]),
      castigoSobrante: new Map([
        ["A", 0.4],
        ["B", 4],
      ]),
      demandaDiaria: new Map([
        ["A", 0.1],
        ["B", 0.1],
      ]),
      cajas: [caja],
      // Tolerancia cero global: el hueco de A siempre se rescata; lo que
      // cambia es si la caja sube opcional o firme.
      toleranciaRescateDias: 0,
    };
    const opcional = optimizarCajas(comun);
    expect(opcional.totalCajas).toBe(1);
    expect(opcional.cajas[0].cantidadOpcional).toBe(1);

    const firme = optimizarCajas({ ...comun, sinOpcional: new Set(["A"]) });
    expect(firme.totalCajas).toBe(1);
    expect(firme.cajas[0].cantidadOpcional ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integración con generarPlan: el caso GT190.
// ---------------------------------------------------------------------------

/** Un producto de dos tallas que se estrenó en Full hace `diasDesde` días. */
function productoLanzado(prefijo: string, diasDesde: number) {
  const inicio = sumarDias(HOY, -(diasDesde - 1));
  const fechas = rangoFechas(inicio, HOY);
  const snapshots: SnapshotStock[] = [];
  const ventas: VentaDiaria[] = [];
  // Queda con 3 pares y objetivo 4: le falta UN par. Es el caso real de
  // GT190-BLK-23 (posición 2, sugerido 1): la regla de la corrida no recorta
  // nada (el goteo de 7 días ya es 1) y el hueco de 1 par cae dentro de la
  // tolerancia de rescate de 7 días, así que un producto viejo espera.
  let nivel23 = 5;
  for (const f of fechas) {
    // La 23 vende 1 par cada 10 días; la 24 no vende.
    const vende = f === sumarDias(HOY, -8) || f === sumarDias(HOY, -4);
    if (vende) {
      nivel23 -= 1;
      ventas.push({ sku: `${prefijo}-23`, fecha: f, unidades: 1 });
    }
    snapshots.push({ sku: `${prefijo}-23`, fecha: f, disponible: nivel23 });
    snapshots.push({ sku: `${prefijo}-24`, fecha: f, disponible: 12 });
  }
  return {
    skus: [{ sku: `${prefijo}-23` }, { sku: `${prefijo}-24` }],
    stockActual: [
      { sku: `${prefijo}-23`, disponible: nivel23, enTransferencia: 0, noDisponible: 0, total: nivel23 },
      { sku: `${prefijo}-24`, disponible: 12, enTransferencia: 0, noDisponible: 0, total: 12 },
    ],
    snapshots,
    ventas,
    caja: {
      codigo: `CAJA-${prefijo}`,
      cajasDisponibles: 3,
      producto: prefijo,
      items: [
        { sku: `${prefijo}-23`, piezas: 6 },
        { sku: `${prefijo}-24`, piezas: 18 },
      ],
    } satisfies Caja,
  };
}

function entradaBase(): EntradaPlan {
  return {
    skus: [],
    stockActual: [],
    ventas: [],
    snapshots: [],
    operaciones: [],
    inventarioPropio: [],
    cajas: [],
    parametros: { diasHistoria: 90 },
    hoy: HOY,
  };
}

describe("generarPlan: producto NUEVO", () => {
  it("a un producto lanzado hace 3 semanas, un hueco chico le fuerza la caja, firme", () => {
    const g = productoLanzado("GT190-BLK", 21);
    const plan = generarPlan({
      ...entradaBase(),
      skus: g.skus,
      stockActual: g.stockActual,
      snapshots: g.snapshots,
      ventas: g.ventas,
      cajas: [g.caja],
    });
    const l23 = plan.lineas.find((l) => l.sku === "GT190-BLK-23")!;
    expect(l23.productoNuevo).toBe(true);
    expect(l23.sugerido).toBeGreaterThan(0);
    expect(l23.explicacion).toContain("Producto NUEVO");
    expect(plan.cajas.totalCajas).toBeGreaterThanOrEqual(1);
    expect(plan.cajas.cajas[0].cantidadOpcional ?? 0).toBe(0);
  });

  it("el mismo hueco en un producto viejo espera al siguiente envío (control)", () => {
    const g = productoLanzado("GT190-BLK", 21);
    const plan = generarPlan({
      ...entradaBase(),
      skus: g.skus,
      stockActual: g.stockActual,
      snapshots: g.snapshots,
      ventas: g.ventas,
      cajas: [g.caja],
      // Ya vendía antes de la ventana: no es nuevo.
      skusConVentaPrevia: new Set(["GT190-BLK-23"]),
    });
    const l23 = plan.lineas.find((l) => l.sku === "GT190-BLK-23")!;
    expect(l23.productoNuevo).toBeUndefined();
    expect(plan.cajas.totalCajas).toBe(0);
  });

  it("con la regla apagada (nuevoDias = 0) tampoco fuerza nada", () => {
    const g = productoLanzado("GT190-BLK", 21);
    const plan = generarPlan({
      ...entradaBase(),
      skus: g.skus,
      stockActual: g.stockActual,
      snapshots: g.snapshots,
      ventas: g.ventas,
      cajas: [g.caja],
      parametros: { diasHistoria: 90, nuevoDias: 0 },
    });
    expect(plan.cajas.totalCajas).toBe(0);
  });

  it("un producto lanzado hace más de `nuevoDias` ya no es nuevo", () => {
    const g = productoLanzado("GT190-BLK", 75);
    const plan = generarPlan({
      ...entradaBase(),
      skus: g.skus,
      stockActual: g.stockActual,
      snapshots: g.snapshots,
      ventas: g.ventas,
      cajas: [g.caja],
    });
    expect(plan.lineas.find((l) => l.sku === "GT190-BLK-23")!.productoNuevo).toBeUndefined();
  });
});

describe("generarPlan: producto SIN VENTA (posición mínima)", () => {
  const cajaZ: Caja = {
    codigo: "CAJA-Z",
    cajasDisponibles: 4,
    producto: "GT300-BLK",
    items: [
      { sku: "GT300-BLK-23", piezas: 12 },
      { sku: "GT300-BLK-24", piezas: 12 },
    ],
  };
  const skusZ = [{ sku: "GT300-BLK-23" }, { sku: "GT300-BLK-24" }];
  // En Full existe la publicación pero con cero: así llega de `stock_full`.
  const stockZ = skusZ.map((s) => ({
    sku: s.sku,
    disponible: 0,
    enTransferencia: 0,
    noDisponible: 0,
    total: 0,
  }));

  it("nunca tuvo stock ni venta y hay cajas: viajan 2 cajas del modelo + color", () => {
    const plan = generarPlan({ ...entradaBase(), skus: skusZ, stockActual: stockZ, cajas: [cajaZ] });
    expect(plan.cajas.totalCajas).toBe(2);
    expect(plan.cajas.cajas[0].codigo).toBe("CAJA-Z");
    for (const l of plan.lineas) {
      expect(l.sinEstreno).toBe(true);
      expect(l.explicacion).toContain("SIN VENTA");
    }
  });

  const enCamino = [
    { sku: "GT300-BLK-23", disponible: 0, enTransferencia: 12, noDisponible: 0, total: 12 },
    { sku: "GT300-BLK-24", disponible: 0, enTransferencia: 12, noDisponible: 0, total: 12 },
  ];

  it("con una caja ya viajando en un envío dado de alta viaja solo UNA más", () => {
    const plan = generarPlan({ ...entradaBase(), skus: skusZ, stockActual: enCamino, cajas: [cajaZ] });
    expect(plan.cajas.totalCajas).toBe(1);
    expect(plan.lineas[0].explicacion).toContain("ya trae 1");
  });

  it("la caja que la bodega apenas APARTÓ no descuenta: el envío lleva sus 2 cajas", () => {
    // Caso real GT160/GT206 del 9-sep-2026: cero en Full, una corrida
    // apartada por la bodega para el camión, y el dueño quiere 2 cajas.
    const plan = generarPlan({
      ...entradaBase(),
      skus: skusZ,
      stockActual: enCamino,
      cajas: [cajaZ],
      enCaminoBodega: new Map([
        ["GT300-BLK-23", 12],
        ["GT300-BLK-24", 12],
      ]),
    });
    expect(plan.cajas.totalCajas).toBe(2);
  });

  it("con dos cajas ya en Full sin vender, no manda más", () => {
    const parado = [
      { sku: "GT300-BLK-23", disponible: 24, enTransferencia: 0, noDisponible: 0, total: 24 },
      { sku: "GT300-BLK-24", disponible: 24, enTransferencia: 0, noDisponible: 0, total: 24 },
    ];
    const plan = generarPlan({ ...entradaBase(), skus: skusZ, stockActual: parado, cajas: [cajaZ] });
    expect(plan.cajas.totalCajas).toBe(0);
    expect(plan.lineas[0].sinEstreno).toBeUndefined();
  });

  it("si vendió alguna vez en la historia, no es estreno", () => {
    const plan = generarPlan({
      ...entradaBase(),
      skus: skusZ,
      stockActual: stockZ,
      cajas: [cajaZ],
      skusConVentaHistorica: new Set(["GT300-BLK-24"]),
    });
    expect(plan.cajas.totalCajas).toBe(0);
  });

  it("una talla excluida a mano saca al producto de la regla", () => {
    const plan = generarPlan({
      ...entradaBase(),
      skus: skusZ,
      stockActual: stockZ,
      cajas: [cajaZ],
      overrides: [{ sku: "GT300-BLK-23", excluir: true }],
    });
    expect(plan.cajas.totalCajas).toBe(0);
  });

  it("prefiere la caja de corrida y completa con la de talla única", () => {
    const corrida: Caja = { ...cajaZ, cajasDisponibles: 1 };
    const unica: Caja = {
      codigo: "CAJA-Z-24",
      cajasDisponibles: 3,
      producto: "GT300-BLK",
      items: [{ sku: "GT300-BLK-24", piezas: 24 }],
    };
    const plan = generarPlan({
      ...entradaBase(),
      skus: skusZ,
      stockActual: stockZ,
      cajas: [unica, corrida],
    });
    const porCodigo = new Map(plan.cajas.cajas.map((c) => [c.codigo, c.cantidad]));
    expect(porCodigo.get("CAJA-Z")).toBe(1);
    expect(porCodigo.get("CAJA-Z-24")).toBe(1);
  });

  it("con cajas en cero (cajasMinimasSinEstreno = 0) no se estrena nada", () => {
    const plan = generarPlan({
      ...entradaBase(),
      skus: skusZ,
      stockActual: stockZ,
      cajas: [cajaZ],
      parametros: { diasHistoria: 90, cajasMinimasSinEstreno: 0 },
    });
    expect(plan.cajas.totalCajas).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cobertura para no forzar caja (decisión del dueño, 15-sep-2026): cuando
// la caja va a forzar otras tallas, ya no se mira el horizonte de 30 días
// sino 15. Si a la talla le alcanza el stock, no se fuerza nada.
// ---------------------------------------------------------------------------

describe("cobertura para no forzar caja", () => {
  const caja: Caja = {
    codigo: "C",
    cajasDisponibles: 5,
    items: [
      { sku: "A", piezas: 6 },
      { sku: "B", piezas: 18 },
    ],
  };

  it("con 20 días de stock la talla no fuerza la caja que sobre-surte a sus hermanas", () => {
    const necesidad = new Map([["A", 16]]);
    const ajustes = ajustarNecesidadPorCorrida({
      necesidad,
      datos: new Map([
        ["A", { posicion: 20, demandaDiaria: 1 }],
        ["B", { posicion: 200, demandaDiaria: 0 }],
      ]),
      cajas: [caja],
      horizonteDias: 30,
      coberturaSinForzar: 15,
    });
    expect(ajustes).toHaveLength(1);
    expect(ajustes[0].regla).toBe("cobertura_suficiente");
    expect(necesidad.has("A")).toBe(false);
  });

  it("con 10 días de stock sí se fuerza, con la regla de siempre (goteo de 7 días)", () => {
    const necesidad = new Map([["A", 26]]);
    const ajustes = ajustarNecesidadPorCorrida({
      necesidad,
      datos: new Map([
        ["A", { posicion: 10, demandaDiaria: 1 }],
        ["B", { posicion: 200, demandaDiaria: 0 }],
      ]),
      cajas: [caja],
      horizonteDias: 30,
      coberturaSinForzar: 15,
    });
    expect(ajustes[0].regla).toBe("solo_7_dias");
    expect(necesidad.get("A")).toBe(7);
  });

  it("una caja que sí se aprovecha (la mitad o más tapa faltantes) no entra a la regla", () => {
    const necesidad = new Map([["A", 16]]);
    const ajustes = ajustarNecesidadPorCorrida({
      necesidad,
      datos: new Map([
        ["A", { posicion: 20, demandaDiaria: 1 }],
        ["B", { posicion: 200, demandaDiaria: 0 }],
      ]),
      cajas: [{ codigo: "D", cajasDisponibles: 5, items: [{ sku: "A", piezas: 12 }, { sku: "B", piezas: 6 }] }],
      horizonteDias: 30,
      coberturaSinForzar: 15,
    });
    expect(ajustes).toHaveLength(0);
    expect(necesidad.get("A")).toBe(16);
  });

  /** Talla A que vende 1 par al día con `stock` pares parados, y B sin venta con 200. */
  function planCon(stockA: number, extra: Partial<EntradaPlan> = {}) {
    const inicio = sumarDias(HOY, -89);
    const snapshots: SnapshotStock[] = [];
    const ventas: VentaDiaria[] = [];
    for (const f of rangoFechas(inicio, HOY)) {
      snapshots.push({ sku: "GT400-BLK-27", fecha: f, disponible: stockA });
      snapshots.push({ sku: "GT400-BLK-28", fecha: f, disponible: 200 });
      ventas.push({ sku: "GT400-BLK-27", fecha: f, unidades: 1 });
    }
    return generarPlan({
      ...entradaBase(),
      skus: [{ sku: "GT400-BLK-27" }, { sku: "GT400-BLK-28" }],
      stockActual: [
        { sku: "GT400-BLK-27", disponible: stockA, enTransferencia: 0, noDisponible: 0, total: stockA },
        { sku: "GT400-BLK-28", disponible: 200, enTransferencia: 0, noDisponible: 0, total: 200 },
      ],
      snapshots,
      ventas,
      cajas: [
        {
          codigo: "CAJA-GT400",
          cajasDisponibles: 5,
          producto: "GT400-BLK",
          items: [
            { sku: "GT400-BLK-27", piezas: 6 },
            { sku: "GT400-BLK-28", piezas: 18 },
          ],
        },
      ],
      // Ya vendía antes: no es producto nuevo.
      skusConVentaPrevia: new Set(["GT400-BLK-27"]),
      ...extra,
    });
  }

  it("generarPlan: con 20 días de stock no viaja la caja; con 10 sí", () => {
    const holgado = planCon(20);
    const l = holgado.lineas.find((x) => x.sku === "GT400-BLK-27")!;
    expect(l.ajusteCorrida).toBe("cobertura_suficiente");
    expect(l.sugerido).toBe(0);
    expect(l.explicacion).toContain("no se fuerza la caja");
    expect(holgado.cajas.totalCajas).toBe(0);

    const corto = planCon(10);
    expect(corto.cajas.totalCajas).toBeGreaterThanOrEqual(1);
  });

  it("generarPlan: con la regla apagada (0) vuelve a forzar como antes", () => {
    const plan = planCon(20, { parametros: { diasHistoria: 90, coberturaSinForzarDias: 0 } });
    expect(plan.cajas.totalCajas).toBeGreaterThanOrEqual(1);
  });
});
