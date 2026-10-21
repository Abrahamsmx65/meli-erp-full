import { describe, expect, it } from "vitest";
import { bajarADecena, bloques, calcularPlan, subirADecena, ventaDiariaDeHistoria, ventana, type ParametrosPlan } from "./plan";

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

  it("se parte en última semana, la anterior y el resto", () => {
    expect(bloques("2026-08-03", "2026-09-01")).toEqual([
      { desde: "2026-08-26", hasta: "2026-09-01" },
      { desde: "2026-08-19", hasta: "2026-08-25" },
      { desde: "2026-08-03", hasta: "2026-08-18" },
    ]);
    expect(bloques("2026-08-23", "2026-09-01")).toEqual([
      { desde: "2026-08-26", hasta: "2026-09-01" },
      { desde: "2026-08-23", hasta: "2026-08-25" },
    ]);
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
    // Stock solo 1 día (el más viejo), vendió 5 ese día. Sin tope diría 150 al mes.
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
    // Solo el bloque del resto (16 días) tiene stock: piso 16/3 = 6 días →
    // 5/6 = 0.83 al día → 25 → 30. Los otros dos bloques no cuentan como cero.
    expect(plan.lineas[0].diasConStock).toBe(6);
    expect(plan.lineas[0].mandar).toBe(30);
    expect(plan.lineas[0].tendencia).toBeNull();
  });

  it("inclina hacia lo reciente cuando el nivel cambió (caso 601-iPad10)", () => {
    const ds = dias(30);
    // 16 días a 35, luego 14 días a 65. Promedio plano: 49. Reciente: 65.
    const ventas = ds.map((fecha, i) => ({ sku: "A", fecha, unidades: i < 16 ? 35 : 65 }));
    const plan = calcularPlan({
      skus: ["A"],
      ventas,
      snapshots: [],
      stock: [],
      bodega: [{ skuMeli: "A", unidades: 5000 }],
      enCamino: [],
      parametros: P,
      hasta: HOY,
    });
    const l = plan.lineas[0];
    // 0.5×65 + 0.3×65 + 0.2×35 = 59
    expect(l.ventaDiaria).toBeCloseTo(59, 5);
    expect(l.tendencia).toBeCloseTo(0, 5);
    expect(l.mandar).toBe(1770);
  });

  it("reporta la tendencia de la última semana contra la anterior, acotada", () => {
    const ds = dias(30);
    const ventas = ds.map((fecha, i) => ({ sku: "A", fecha, unidades: i >= 23 ? 20 : 10 }));
    const plan = calcularPlan({ skus: ["A"], ventas, snapshots: [], stock: [], bodega: [], enCamino: [], parametros: P, hasta: HOY });
    // +100% real, acotado a +50%.
    expect(plan.lineas[0].tendencia).toBeCloseTo(0.5, 5);
    const bajando = ds.map((fecha, i) => ({ sku: "A", fecha, unidades: i >= 23 ? 5 : 10 }));
    const plan2 = calcularPlan({ skus: ["A"], ventas: bajando, snapshots: [], stock: [], bodega: [], enCamino: [], parametros: P, hasta: HOY });
    // −50% real, acotado a −30%.
    expect(plan2.lineas[0].tendencia).toBeCloseTo(-0.3, 5);
  });

  it("por omisión la ventana termina AYER, no hoy", () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const plan = calcularPlan({ skus: [], ventas: [], snapshots: [], stock: [], bodega: [], enCamino: [], parametros: P });
    expect(plan.hasta < hoy).toBe(true);
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

describe("renglones equivalentes desde bloques agregados", () => {
  it("un bloque de U unidades en D días con venta da la misma venta diaria que los días reales", () => {
    const ds = dias(30);
    const reales = ds.map((fecha, i) => ({ sku: "A", fecha, unidades: i >= 23 ? 20 : i >= 16 ? 10 : 5 }));
    // Como lo entrega agregados.ts: por bloque, D renglones de U/D.
    const equivalentes = [
      ...Array.from({ length: 7 }, (_, k) => ({ sku: "A", fecha: ds[29 - k], unidades: 140 / 7 })),
      ...Array.from({ length: 7 }, (_, k) => ({ sku: "A", fecha: ds[22 - k], unidades: 70 / 7 })),
      ...Array.from({ length: 16 }, (_, k) => ({ sku: "A", fecha: ds[15 - k], unidades: 80 / 16 })),
    ];
    const base = { skus: ["A"], snapshots: [], stock: [], bodega: [], enCamino: [], parametros: P, hasta: HOY };
    const a = calcularPlan({ ...base, ventas: reales }).lineas[0];
    const b = calcularPlan({ ...base, ventas: equivalentes }).lineas[0];
    expect(b.ventaDiaria).toBeCloseTo(a.ventaDiaria, 6);
    expect(b.vendidas).toBeCloseTo(a.vendidas, 6);
    expect(b.tendencia).toBeCloseTo(a.tendencia!, 6);
  });
});

describe("agotado con historia y estreno (21-oct-2026)", () => {
  const base = { ventas: [], snapshots: [], enCamino: [], parametros: P, hasta: HOY };

  it("un SKU sin venta ni stock en la ventana se repone con su venta de los 180 días anteriores", () => {
    // 567-i11-purple: 58 vendidas hasta julio, 0 en Full, 10 en bodega. Sin
    // historia pedía 0 para siempre.
    const plan = calcularPlan({
      ...base,
      skus: ["567-i11-purple"],
      stock: [{ sku: "567-i11-purple", disponible: 0, enTransferencia: 0 }],
      bodega: [{ skuMeli: "567-i11-purple", unidades: 40 }],
      historia: [{ sku: "567-i11-purple", unidades: 58, dias: 180, fotos: 180, conStock: 100 }],
    });
    const l = plan.lineas[0];
    expect(l.ventaDeHistoria).toBe(true);
    expect(l.ventaDiaria).toBeCloseTo(0.58, 2);
    // 0.58 × 30 días = 17.4 → 20.
    expect(l.mandar).toBe(20);
    expect(l.motivo).toBe("historia");

    // Con solo 10 en bodega sale lo que alcanza, y se dice.
    const topado = calcularPlan({
      ...base,
      skus: ["567-i11-purple"],
      stock: [],
      bodega: [{ skuMeli: "567-i11-purple", unidades: 10 }],
      historia: [{ sku: "567-i11-purple", unidades: 58, dias: 180, fotos: 180, conStock: 100 }],
    });
    expect(topado.lineas[0].mandar).toBe(10);
    expect(topado.lineas[0].motivo).toBe("topado_por_bodega");
    expect(topado.lineas[0].ventaDeHistoria).toBe(true);
  });

  it("la historia no se usa si el SKU sí vendió o sí tiene algo en Full o en camino", () => {
    const plan = calcularPlan({
      ...base,
      skus: ["A", "B"],
      ventas: [{ sku: "A", fecha: HOY, unidades: 1 }],
      stock: [{ sku: "B", disponible: 5, enTransferencia: 0 }],
      bodega: [{ skuMeli: "A", unidades: 100 }, { skuMeli: "B", unidades: 100 }],
      historia: [{ sku: "A", unidades: 900, dias: 180, fotos: 0, conStock: 0 }, { sku: "B", unidades: 900, dias: 180, fotos: 0, conStock: 0 }],
    });
    for (const l of plan.lineas) expect(l.ventaDeHistoria).toBeUndefined();
  });

  it("un SKU que nunca ha vendido, sin nada en Full y con una decena en bodega, recibe UNA decena de prueba", () => {
    // 567-i11-transparent: publicado en junio, 0 ventas en la vida, 49 en bodega.
    const plan = calcularPlan({
      ...base,
      skus: ["567-i11-transparent"],
      stock: [],
      bodega: [{ skuMeli: "567-i11-transparent", unidades: 49 }],
      historia: [],
    });
    const l = plan.lineas[0];
    expect(l.mandar).toBe(10);
    expect(l.falta).toBe(10);
    expect(l.motivo).toBe("estreno");
    expect(plan.unidades).toBe(10);
  });

  it("el estreno no se repite: con la decena en camino o en Full ya no es estreno", () => {
    const plan = calcularPlan({
      ...base,
      skus: ["X", "Y"],
      stock: [{ sku: "Y", disponible: 10, enTransferencia: 0 }],
      bodega: [{ skuMeli: "X", unidades: 49 }, { skuMeli: "Y", unidades: 49 }],
      enCamino: [{ skuMeli: "X", unidades: 10 }],
      historia: [],
    });
    for (const l of plan.lineas) {
      expect(l.mandar).toBe(0);
      expect(l.motivo).toBe("sin_faltante");
    }
  });

  it("sin una decena en bodega, cerrado en MELI o sin historia cargada, no hay estreno", () => {
    const plan = calcularPlan({
      ...base,
      skus: ["POCO", "CERRADO"],
      stock: [],
      bodega: [{ skuMeli: "POCO", unidades: 7 }, { skuMeli: "CERRADO", unidades: 50 }],
      historia: [],
      cerrados: ["CERRADO"],
    });
    const por = new Map(plan.lineas.map((l) => [l.sku, l]));
    expect(por.get("POCO")?.mandar).toBe(0);
    expect(por.get("POCO")?.motivo).toBe("menos_de_una_decena");
    expect(por.get("CERRADO")?.mandar).toBe(0);
    expect(por.get("CERRADO")?.motivo).toBe("sin_faltante");

    const sinHistoria = calcularPlan({ ...base, skus: ["NUEVO"], stock: [], bodega: [{ skuMeli: "NUEVO", unidades: 50 }] });
    expect(sinHistoria.lineas[0].mandar).toBe(0);
    expect(sinHistoria.lineas[0].motivo).toBe("sin_faltante");
  });

  it("la venta diaria de la historia va por días con stock, con calendario si faltan fotos y con piso", () => {
    expect(ventaDiariaDeHistoria({ sku: "a", unidades: 58, dias: 180, fotos: 180, conStock: 100 })).toBeCloseTo(0.58, 2);
    expect(ventaDiariaDeHistoria({ sku: "a", unidades: 36, dias: 180, fotos: 10, conStock: 5 })).toBeCloseTo(0.2, 2);
    // 2 días con stock no disparan la cuenta: piso de 180 ÷ 3 = 60 días.
    expect(ventaDiariaDeHistoria({ sku: "a", unidades: 60, dias: 180, fotos: 180, conStock: 2 })).toBe(1);
    expect(ventaDiariaDeHistoria({ sku: "a", unidades: 0, dias: 180, fotos: 180, conStock: 100 })).toBe(0);
  });
});
