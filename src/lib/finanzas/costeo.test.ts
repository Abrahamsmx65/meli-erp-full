import { describe, expect, it } from "vitest";
import {
  costearContenedor,
  costosPorModelo,
  idContenedor,
  leerCbmPorPar,
  leerComisiones,
  leerCostingGetac,
  leerExcelCosteo,
  numeroCelda,
  type PagoContenedor,
} from "./costeo";

const ENC = ["Invoice", "Style", "Qtys", "Cost(RMB)", "Cost in USD", "Total Amount", "DHL USD", "Cost/Piece USD", ""];

// Calcado del bloque S252-2026 del Excel de costeo real (recortado).
const EXCEL = [
  ENC,
  ["S252-2026", "", "", "", "", "", "1616.99", "22.49", "CBM"],
  ["ETD : Aug 2", "GT117", "7152", "11.2", "1.664190193164933", "11902.29", "0.13", "1.79", ""],
  ["MRSU6229114", "GT121", "1824", "11.2", "1.664190193164933", "3035.48", "0.13", "1.79", ""],
  ["", "", "8976", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "1087.10", "15.12", "CBM"],
  ["IN10117", "GT134", "3525", "8.6", "1.2778603268945021", "4504.45", "0.15", "1.43", ""],
  ["", "", "3435", "9.1", "1.352154531946508", "4644.65", "0.15", "1.50", ""],
  ["", "", "6960", "", "", "", "", "", ""],
  ["", "", "15936", "", "", "23986.87", "", "37.61", "CBM"],
  ["", "", "", "", "", "", "", "US$4,930/HQ + US$100 destination fee", "5030"],
  [],
  ENC,
  ["S270-2026", "IN10118", "", "", "", "", "7430", "67.45", "CBM"],
  ["ETD :", "GT260", "1440", "", "10.7", "15408", "1.23", "11.93", ""],
  ["TIIU9082344", "GT261", "720", "", "11", "7920", "1.23", "12.23", ""],
];

describe("leerExcelCosteo", () => {
  const det = leerExcelCosteo(EXCEL);

  it("separa contenedores con su año e ISO", () => {
    expect(det.map((d) => [d.id, d.anio, d.iso])).toEqual([
      ["S252", 2026, "MRSU6229114"],
      ["S270", 2026, "TIIU9082344"],
    ]);
  });

  it("un renglón sin modelo es otro color del modelo de arriba", () => {
    const gt134 = det[0].lineas.filter((l) => l.modelo === "GT134");
    expect(gt134.map((l) => l.pares)).toEqual([3525, 3435]);
    expect(gt134[1].usdPar).toBeCloseTo(1.35215, 4);
  });

  it("reparte los CBM del grupo entre sus modelos por pares (el total no abre grupo)", () => {
    const [gt117, gt121, a, b] = det[0].lineas;
    expect(gt117.cbm! + gt121.cbm!).toBeCloseTo(22.49, 6);
    expect(gt117.cbm!).toBeCloseTo((22.49 * 7152) / 8976, 6);
    expect(a.cbm! + b.cbm!).toBeCloseTo(15.12, 6);
  });

  it("el renglón del contenedor también puede abrir grupo y pedido (S270)", () => {
    expect(det[1].lineas.map((l) => [l.modelo, l.pedido])).toEqual([
      ["GT260", "IN10118"],
      ["GT261", "IN10118"],
    ]);
    expect(det[1].lineas[0].cbm! + det[1].lineas[1].cbm!).toBeCloseTo(67.45, 6);
  });
});

describe("sheet de cuentas", () => {
  const filas = [
    ["CONTENEDOR", "ID CONTENEDOR", "PRODUCTO", "COSTO USD", "COSTO ENVIO ", "TIPO DE CAMBIO", "PESOS COSTO", "PESOS ENVIO", "CRUCE TOTAL", "TOTAL PESOS", "ESTATUS"],
    ["FCIU9736902", "S236", "MY2307", "", "", "", "", "", "321900", "321900", "ENTREGADO"],
    ["MRSU6229114", "S252", "GT117 GT121 GT134", "44623.07", "5030", "17.2572", "770069.61", "86339.95", "318200", "1174609.56", "ENTREGADO"],
    ["WHSU7038690", "S258", "GT125", "24282", "2710", "17.0225", "", "45883.01", "", "", "EN CAMINO"],
    ["", "S272"],
    ["MRSU6229114", "S252", "repetido abajo", "1", "1", "1", "1", "1", "1", "1", "ENTREGADO"],
  ];
  const pagos = leerCostingGetac(filas);

  it("lee cada contenedor una vez y salta los renglones reservados", () => {
    expect(pagos.map((p) => p.id)).toEqual(["S236", "S252", "S258"]);
    expect(pagos[1]).toMatchObject({ iso: "MRSU6229114", pesosCosto: 770069.61, aduana: 318200, entregado: true });
  });

  it("sin PESOS COSTO lo calcula con USD × tipo de cambio", () => {
    expect(pagos[2].pesosCosto).toBeCloseTo(24282 * 17.0225, 4);
    expect(pagos[2].entregado).toBe(false);
  });

  it("comisiones: el bloque de calzado (S###), no el de fundas", () => {
    const c = leerComisiones([
      ["PEDIDO", "PRODUCTO", "COSTO USD", "TIPO DE CAMBIO", "COMISION MXN", "", "PEDIDO", "PRODUCTO", "COSTO USD", "TIPO DE CAMBIO", "COMISION MXN"],
      ["P605", "FUNDAS", "56938.67", "17.4", "14867.55", "", "S239", "GT117", "56567.56", "17.327", "14702.19"],
    ]);
    expect([...c]).toEqual([["S239", 14702.19]]);
  });

  it("CBM por par de Números", () => {
    const m = leerCbmPorPar([
      ["CATEGORIA", "MODELO", "USD", "TDC", "CBM X PAR"],
      ["EVA", "GT134", "1.44", "17.5", "0.00217317708"],
      ["", "", "", "", ""],
    ]);
    expect(m.get("GT134")).toBeCloseTo(0.00217317708, 10);
  });
});

const pago = (p: Partial<PagoContenedor>): PagoContenedor => ({
  id: "S252",
  iso: null,
  productos: "",
  costoUsd: null,
  envioUsd: null,
  tipoCambio: null,
  pesosCosto: 1000,
  pesosEnvio: 200,
  aduana: 300,
  estatus: "ENTREGADO",
  entregado: true,
  ...p,
});

describe("costearContenedor", () => {
  const det = {
    id: "S252",
    anio: 2026,
    iso: null,
    fuente: "excel" as const,
    lineas: [
      { modelo: "A", pedido: null, pares: 100, usdPar: 3, cbm: 1 },
      { modelo: "B", pedido: null, pares: 100, usdPar: 1, cbm: 3 },
    ],
  };

  it("fábrica y comisión por valor; flete y aduana por CBM; suma exacto lo pagado", () => {
    const c = costearContenedor(pago({}), det, new Map(), 40);
    const [a, b] = c.modelos;
    expect(a.fabricaMxn).toBeCloseTo(750, 6);
    expect(b.fabricaMxn).toBeCloseTo(250, 6);
    expect(a.fleteMxn).toBeCloseTo(50, 6);
    expect(b.aduanaMxn).toBeCloseTo(225, 6);
    expect(a.comisionMxn).toBeCloseTo(30, 6);
    expect(a.totalMxn + b.totalMxn).toBeCloseTo(1000 + 200 + 300 + 40, 6);
    expect(a.porPar).toBeCloseTo((750 + 50 + 75 + 30) / 100, 6);
    expect(c.cuenta).toBe(true);
  });

  it("no cuenta sin estar ENTREGADO ni sin aduana", () => {
    expect(costearContenedor(pago({ entregado: false, estatus: "EN CAMINO" }), det, new Map(), 0).motivo).toMatch(/ENTREGADO/);
    expect(costearContenedor(pago({ aduana: null }), det, new Map(), 0).motivo).toMatch(/aduana/);
  });

  it("sin detalle no se puede repartir y se declara", () => {
    const c = costearContenedor(pago({}), null, new Map(), 0);
    expect(c.cuenta).toBe(false);
    expect(c.motivo).toMatch(/qué traía/);
  });

  it("sin CBM usa los de Números; sin ellos, por pares", () => {
    const sinCbm = { ...det, lineas: det.lineas.map((l) => ({ ...l, cbm: null })) };
    const c1 = costearContenedor(pago({}), sinCbm, new Map([["A", 0.01], ["B", 0.03]]), 0);
    expect(c1.metodoCbm).toBe("numeros");
    expect(c1.modelos[1].fleteMxn).toBeCloseTo(150, 6);
    const c2 = costearContenedor(pago({}), sinCbm, new Map([["A", 0.01]]), 0);
    expect(c2.metodoCbm).toBe("pares");
    expect(c2.modelos[1].fleteMxn).toBeCloseTo(100, 6);
  });
});

describe("costosPorModelo", () => {
  const cont = (id: string, porPar: number, pares: number, cuenta = true) =>
    ({ id, anio: 2026, cuenta, modelos: [{ modelo: "GT1", pares, porPar }] }) as any;
  const lista = [cont("S250", 50, 1000), cont("S256", 60, 1000), cont("S258", 70, 1000, false)];

  it("el último es el contenedor más nuevo que YA cuenta", () => {
    const [m] = costosPorModelo(lista, null);
    expect(m.ultimo).toMatchObject({ id: "S256", porPar: 60 });
    expect(m.real).toBe(60);
  });

  it("el real valúa las existencias con los contenedores más nuevos (PEPS)", () => {
    const [m] = costosPorModelo(lista, new Map([["GT1", 1500]]));
    expect(m.tomas).toEqual([
      { id: "S256", pares: 1000, porPar: 60 },
      { id: "S250", pares: 500, porPar: 50 },
    ]);
    expect(m.real).toBeCloseTo((1000 * 60 + 500 * 50) / 1500, 6);
    expect(m.sinCubrir).toBe(0);
  });

  it("existencias de más quedan como sin costear", () => {
    const [m] = costosPorModelo(lista, new Map([["GT1", 2500]]));
    expect(m.sinCubrir).toBe(500);
  });
});

describe("utilidades", () => {
  it("números y ids", () => {
    expect(numeroCelda("$1,234.50")).toBe(1234.5);
    expect(numeroCelda("ENTREGADO")).toBeNull();
    expect(idContenedor("S252-2026")).toEqual({ id: "S252", anio: 2026 });
    expect(idContenedor("IN10079")).toBeNull();
  });
});
