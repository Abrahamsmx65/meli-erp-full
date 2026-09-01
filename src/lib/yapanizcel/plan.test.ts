import { describe, expect, it } from "vitest";
import { bajarADecena, calcularPlan, subirADecena, ventana, type ParametrosPlan } from "./plan";

const P: ParametrosPlan = { diasVenta: 30, diasObjetivo: 30, multiploEnvio: 10, minimoEnvio: 10 };
const HOY = "2026-09-01";

function dias(n: number, hasta = HOY): string[] {
  const out: string[] = [];
  const fin = new Date(`${hasta}T00:00:00.000Z`);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(fin);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

describe("decenas cerradas", () => {
  it("sube a la decena de arriba", () => {
    expect(subirADecena(1, 10)).toBe(10);
    expect(subirADecena(10, 10)).toBe(10);
    expect(subirADecena(32, 10)).toBe(40);
    expect(subirADecena(0, 10)).toBe(0);
  });

  it("baja a la decena de abajo", () => {
    expect(bajarADecena(37, 10)).toBe(30);
    expect(bajarADecena(9, 10)).toBe(0);
  });

  it("con múltiplo 1 no redondea a decenas", () => {
    expect(subirADecena(32.2, 1)).toBe(33);
  });
});

describe("ventana", () => {
  it("cubre exactamente N días terminando en `hasta`", () => {
    expect(ventana("2026-09-01", 30)).toEqual({ desde: "2026-08-03", hasta: "2026-09-01" });
  });
});

describe("calcularPlan", () => {
  it("repone 30 días de venta en decenas cerradas", () => {
    // 60 vendidas en 30 días = 2 al día → objetivo 60. Hay 15 en Full → faltan 45 → 50.
    const ventas = dias(30).map((fecha) => ({ sku: "499-IP15PM", fecha, unidades: 2 }));
    const plan = calcularPlan({
      skus: ["499-IP15PM"],
      ventas,
      snapshots: [],
      stock: [{ sku: "499-IP15PM", disponible: 15, enTransferencia: 0 }],
      bodega: [{ skuMeli: "499-IP15PM", unidades: 500 }],
      enCamino: [],
      parametros: P,
      hasta: HOY,
    });
    const l = plan.lineas[0];
    expect(l.ventaDiaria).toBe(2);
    expect(l.objetivo).toBe(60);
    expect(l.falta).toBe(45);
    expect(l.mandar).toBe(50);
    expect(l.motivo).toBe("ok");
    expect(plan.unidades).toBe(50);
  });

  it("lo que viene en camino y en transferencia cuenta", () => {
    const ventas = dias(30).map((fecha) => ({ sku: "A", fecha, unidades: 2 }));
    const plan = calcularPlan({
      skus: ["A"],
      ventas,
      snapshots: [],
      stock: [{ sku: "A", disponible: 10, enTransferencia: 20 }],
      bodega: [{ skuMeli: "A", unidades: 500 }],
      enCamino: [{ skuMeli: "A", unidades: 30 }],
      parametros: P,
      hasta: HOY,
    });
    // posición 60 = objetivo 60: no falta nada.
    expect(plan.lineas[0].posicion).toBe(60);
    expect(plan.lineas[0].mandar).toBe(0);
    expect(plan.lineas[0].motivo).toBe("sin_faltante");
  });

  it("se topa por lo que hay en bodega, en decena cerrada", () => {
    const ventas = dias(30).map((fecha) => ({ sku: "A", fecha, unidades: 2 }));
    const plan = calcularPlan({
      skus: ["A"],
      ventas,
      snapshots: [],
      stock: [],
      bodega: [{ skuMeli: "A", unidades: 37 }],
      enCamino: [],
      parametros: P,
      hasta: HOY,
    });
    // faltan 60, hay 37 → salen 30 (no 37: no es decena).
    expect(plan.lineas[0].mandar).toBe(30);
    expect(plan.lineas[0].motivo).toBe("topado_por_bodega");
    expect(plan.faltanteSinCubrir).toBe(30);
  });

  it("con menos de una decena en bodega no se manda nada", () => {
    const ventas = dias(30).map((fecha) => ({ sku: "A", fecha, unidades: 1 }));
    const plan = calcularPlan({
      skus: ["A"],
      ventas,
      snapshots: [],
      stock: [],
      bodega: [{ skuMeli: "A", unidades: 7 }],
      enCamino: [],
      parametros: P,
      hasta: HOY,
    });
    expect(plan.lineas[0].mandar).toBe(0);
    expect(plan.lineas[0].motivo).toBe("menos_de_una_decena");
  });

  it("sin inventario en bodega no se manda nada y se dice", () => {
    const ventas = dias(30).map((fecha) => ({ sku: "A", fecha, unidades: 1 }));
    const plan = calcularPlan({
      skus: ["A"],
      ventas,
      snapshots: [],
      stock: [],
      bodega: [],
      enCamino: [],
      parametros: P,
      hasta: HOY,
    });
    expect(plan.lineas[0].motivo).toBe("sin_inventario");
  });

  it("varios SKUs de bodega amarrados al mismo de MELI se suman", () => {
    const ventas = dias(30).map((fecha) => ({ sku: "A", fecha, unidades: 2 }));
    const plan = calcularPlan({
      skus: ["A"],
      ventas,
      snapshots: [],
      stock: [],
      bodega: [
        { skuMeli: "A", unidades: 25 },
        { skuMeli: "A", unidades: 25 },
      ],
      enCamino: [],
      parametros: P,
      hasta: HOY,
    });
    expect(plan.lineas[0].enBodega).toBe(50);
    expect(plan.lineas[0].mandar).toBe(50);
  });

  it("corrige por los días que estuvo agotado cuando hay fotos", () => {
    // Vendió 10 en los 10 días que tuvo stock; los otros 20 estuvo en cero.
    const ds = dias(30);
    const ventas = ds.slice(0, 10).map((fecha) => ({ sku: "A", fecha, unidades: 1 }));
    const snapshots = ds.map((fecha, i) => ({ sku: "A", fecha, disponible: i < 10 ? 5 : 0 }));
    const plan = calcularPlan({
      skus: ["A"],
      ventas,
      snapshots,
      stock: [],
      bodega: [{ skuMeli: "A", unidades: 500 }],
      enCamino: [],
      parametros: P,
      hasta: HOY,
    });
    const l = plan.lineas[0];
    expect(l.porCalendario).toBe(false);
    expect(l.diasConStock).toBe(10);
    expect(l.ventaDiaria).toBe(1);
    // 30 días × 1 = 30, no 10.
    expect(l.mandar).toBe(30);
  });

  it("sin fotos suficientes usa el calendario y lo dice", () => {
    const ds = dias(30);
    const ventas = ds.slice(0, 10).map((fecha) => ({ sku: "A", fecha, unidades: 1 }));
    // Solo 3 fotos: no alcanza para creerle.
    const snapshots = ds.slice(0, 3).map((fecha) => ({ sku: "A", fecha, disponible: 0 }));
    const plan = calcularPlan({
      skus: ["A"],
      ventas,
      snapshots,
      stock: [],
      bodega: [{ skuMeli: "A", unidades: 500 }],
      enCamino: [],
      parametros: P,
      hasta: HOY,
    });
    const l = plan.lineas[0];
    expect(l.porCalendario).toBe(true);
    expect(l.diasConStock).toBe(30);
    expect(l.mandar).toBe(10);
  });

  it("la corrección por agotamiento tiene tope", () => {
    const ds = dias(30);
    // Stock solo 1 día, vendió 5 ese día. Sin tope diría 150 al mes.
    const ventas = [{ sku: "A", fecha: ds[0], unidades: 5 }];
    const snapshots = ds.map((fecha, i) => ({ sku: "A", fecha, disponible: i === 0 ? 5 : 0 }));
    const plan = calcularPlan({
      skus: ["A"],
      ventas,
      snapshots,
      stock: [],
      bodega: [{ skuMeli: "A", unidades: 500 }],
      enCamino: [],
      parametros: P,
      hasta: HOY,
    });
    // piso = 30/3 = 10 días → 0.5 al día → 15 → 20.
    expect(plan.lineas[0].diasConStock).toBe(10);
    expect(plan.lineas[0].mandar).toBe(20);
  });

  it("ignora ventas fuera de la ventana", () => {
    const ventas = [
      ...dias(30).map((fecha) => ({ sku: "A", fecha, unidades: 1 })),
      { sku: "A", fecha: "2026-07-01", unidades: 999 },
    ];
    const plan = calcularPlan({
      skus: ["A"],
      ventas,
      snapshots: [],
      stock: [],
      bodega: [{ skuMeli: "A", unidades: 500 }],
      enCamino: [],
      parametros: P,
      hasta: HOY,
    });
    expect(plan.lineas[0].vendidas).toBe(30);
  });

  it("ordena lo que más se manda arriba y luego por urgencia", () => {
    const ventas = [
      ...dias(30).map((fecha) => ({ sku: "LENTO", fecha, unidades: 1 })),
      ...dias(30).map((fecha) => ({ sku: "RAPIDO", fecha, unidades: 5 })),
    ];
    const plan = calcularPlan({
      skus: ["LENTO", "RAPIDO"],
      ventas,
      snapshots: [],
      stock: [],
      bodega: [
        { skuMeli: "LENTO", unidades: 500 },
        { skuMeli: "RAPIDO", unidades: 500 },
      ],
      enCamino: [],
      parametros: P,
      hasta: HOY,
    });
    expect(plan.lineas[0].sku).toBe("RAPIDO");
    expect(plan.skus).toBe(2);
  });
});
