import { describe, expect, it } from "vitest";
import {
  costearContenedor,
  costosPorModelo,
  idContenedor,
  leerExcelCosteo,
  numeroCelda,
  tipoCambioPonderado,
  type DatosContenedor,
  type DetalleContenedor,
} from "./costeo";
import { calcularNumeros, ENTRADA_VACIA } from "./numeros";

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

  it("separa contenedores con su año, ISO y flete total", () => {
    expect(det.map((d) => [d.id, d.anio, d.iso, d.fleteUsd])).toEqual([
      ["S252", 2026, "MRSU6229114", 5030],
      ["S270", 2026, "TIIU9082344", null],
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
  });
});

const datos = (d: Partial<DatosContenedor>): DatosContenedor => ({
  id: "S252",
  negocio: "calzado",
  comisionAgente: null,
  anio: 2026,
  iso: null,
  productos: "",
  costoUsd: 100,
  fleteUsd: 10,
  aduana: 300,
  entregado: true,
  pagosFabrica: [{ usd: 100, tipoCambio: 10 }],
  pagosFlete: [{ usd: 10, tipoCambio: 20 }],
  notas: null,
  ...d,
});

const det: DetalleContenedor = {
  id: "S252",
  anio: 2026,
  iso: null,
  fuente: "excel",
  lineas: [
    { modelo: "A", pedido: null, pares: 100, usdPar: 0.75, cbm: 1 },
    { modelo: "B", pedido: null, pares: 100, usdPar: 0.25, cbm: 3 },
  ],
};

describe("costearContenedor", () => {
  it("la comisión del agente NO entra al costo del par", () => {
    const sin = costearContenedor(datos({}), det);
    const con = costearContenedor(datos({ comisionAgente: 999 }), det);
    expect(con.modelos[0].porPar).toBe(sin.modelos[0].porPar);
    expect(con.totalMxn).toBe(sin.totalMxn);
    expect(con.comisionAgente).toBe(999);
  });

  it("fábrica por valor con el T.C. de sus pagos; flete y aduana por CBM; suma exacto", () => {
    const c = costearContenedor(datos({}), det);
    const [a, b] = c.modelos;
    expect(c.pesosCosto).toBe(1000);
    expect(c.pesosEnvio).toBe(200);
    expect(a.fabricaMxn).toBeCloseTo(750, 6);
    expect(b.fabricaMxn).toBeCloseTo(250, 6);
    expect(a.fleteMxn).toBeCloseTo(50, 6);
    expect(b.aduanaMxn).toBeCloseTo(225, 6);
    expect(a.totalMxn + b.totalMxn).toBeCloseTo(1000 + 200 + 300, 6);
    expect(a.porPar).toBeCloseTo((750 + 50 + 75) / 100, 6);
    expect(c.cuenta).toBe(true);
  });

  it("cada pago con su tipo de cambio: se pondera por USD", () => {
    expect(tipoCambioPonderado([{ usd: 60, tipoCambio: 17 }, { usd: 40, tipoCambio: 18 }])).toBeCloseTo(17.4, 10);
    const c = costearContenedor(datos({ pagosFabrica: [{ usd: 60, tipoCambio: 17 }, { usd: 40, tipoCambio: 18 }] }), det);
    expect(c.pesosCosto).toBeCloseTo(1740, 6);
  });

  it("pagado a medias: lo que falta va con el T.C. de lo pagado y se avisa", () => {
    const c = costearContenedor(datos({ pagosFabrica: [{ usd: 50, tipoCambio: 17 }] }), det);
    expect(c.pesosCosto).toBeCloseTo(1700, 6);
    expect(c.avisos.join(" ")).toMatch(/Pagado US\$50/);
  });

  it("sin pago de flete se usa el T.C. de la fábrica y se avisa", () => {
    const c = costearContenedor(datos({ pagosFlete: [] }), det);
    expect(c.pesosEnvio).toBe(100);
    expect(c.avisos.join(" ")).toMatch(/flete/);
  });

  it("sin factura capturada usa la suma del Excel; sin pagos no cuenta", () => {
    expect(costearContenedor(datos({ costoUsd: null }), det).costoUsd).toBeCloseTo(100, 6);
    expect(costearContenedor(datos({ pagosFabrica: [] }), det).motivo).toMatch(/pagos/);
  });

  it("no cuenta sin entregar, sin aduana ni sin detalle", () => {
    expect(costearContenedor(datos({ entregado: false }), det).motivo).toMatch(/entregado/);
    expect(costearContenedor(datos({ aduana: null }), det).motivo).toMatch(/aduana/);
    expect(costearContenedor(datos({}), null).motivo).toMatch(/qué traía/);
  });

  it("el reparto es A FUERZAS por los CBM del contenedor: sin ellos no se costea", () => {
    const sinCbm = { ...det, lineas: det.lineas.map((l, i) => ({ ...l, cbm: i === 0 ? null : l.cbm })) };
    const c = costearContenedor(datos({}), sinCbm);
    expect(c.cuenta).toBe(false);
    expect(c.motivo).toMatch(/CBM/);
    expect(c.modelos.every((m) => m.totalMxn === 0)).toBe(true);
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
  });

  it("existencias de más quedan como sin costear", () => {
    const [m] = costosPorModelo(lista, new Map([["GT1", 2500]]));
    expect(m.sinCubrir).toBe(500);
  });
});

describe("Números: las fórmulas del sheet del dueño", () => {
  it("G650 (renglón 2 del sheet)", () => {
    const r = calcularNumeros(
      { modelo: "G650", ...ENTRADA_VACIA, envioMeli: 44, precioRelampago: 298.99, envioAmazon: 72, pvNormal: 298.99 * 1.065 },
      112.244872,
    );
    expect(r.ganancia).toBeCloseTo(97.896628, 5);
    expect(r.porcentaje).toBeCloseTo(0.8721701603, 8);
    expect(r.pvNormal).toBeCloseTo(318.42435, 5);
    expect(r.gananciaNormal).toBeCloseTo(114.4158255, 5);
    expect(r.recibirAmazon).toBeCloseTo(210.1415, 4);
    expect(r.pvpAmazon).toBeCloseTo(371.4932398, 5);
    expect(r.pvpDeal).toBeCloseTo(416.0724286, 5);
    expect(r.tiktokLives).toBeCloseTo(287.0282895, 5);
    expect(r.tiktokOferta).toBeCloseTo(318.6014013, 5);
    expect(r.tiktokRelampago).toBeCloseTo(302.6713313, 5);
  });

  it("MY2304: con la retención del 10.5 %", () => {
    const r = calcularNumeros(
      { modelo: "MY2304", ...ENTRADA_VACIA, envioMeli: 40, precioRelampago: 140, pvNormal: 148.9, retencion: true },
      46.76952272,
    );
    expect(r.ganancia).toBeCloseTo(19.55806348, 5);
    expect(r.gananciaNormal).toBeCloseTo(26.31746004, 5);
  });

  it("variantes de TikTok (+6 / 0.2405205 / ×1.06) y deal fijo", () => {
    const r = calcularNumeros(
      {
        modelo: "X",
        ...ENTRADA_VACIA,
        envioMeli: 40,
        precioRelampago: 300,
        envioAmazon: 36,
        pvpDeal: 339.99,
        tiktokExtra: 6,
        tiktokComision: 0.2405205,
        tiktokOferta: 1.06,
      },
      70,
    );
    expect(r.pvpDeal).toBe(339.99);
    expect(r.tiktokLives).toBeCloseTo((r.recibirAmazon! + 6) / (1 - 0.2405205), 8);
    expect(r.tiktokOferta).toBeCloseTo(r.tiktokLives! * 1.06, 8);
  });

  it("con lo real: comisión, envío y retención que cobró MELI; Amazon y TikTok con lo que cobraron", () => {
    const e = { modelo: "GT134", ...ENTRADA_VACIA, envioMeli: 38, precioRelampago: 155.99, envioAmazon: 39 };
    const r = calcularNumeros(e, 35.25, {
      meli: { pares: 2229, paresDirecta: 155, comisionPct: 0.15, envioPar: 41, retencionPct: 0.01, netoPar: 98.33 },
      amazon: { unidades: 467, precioPar: 208.21, comisionPct: 0.1263, retencionPct: 0.0695, fbaPar: 35.43, otrosPar: 6.7, netoPar: 132 },
      tiktok: { pares: 991, precioPar: 113.37, pagoPar: 78.64, afiliadoPct: 0.0455 },
    });
    expect(r.usado.meli).toMatchObject({ fuente: "real", comisionPct: 0.15, envio: 41, retencionPct: 0.01, envioFuente: "ventas" });
    expect(r.gananciaRelampago).toBeCloseTo(155.99 * (1 - 0.15 - 0.01) - 41 - 35.25, 8);
    // Sin ventas a $155.99 ni cerca: manda la cuenta con las tasas.
    expect(r.recibidoMeli).toMatchObject({ fuente: "tasas", precio: 155.99 });
    expect(r.promedioMeli).toEqual({ porPar: 98.33, pares: 2229 });
    expect(r.ganancia).toBeCloseTo(r.gananciaRelampago!, 8);
    expect(r.pvpAmazon).toBeCloseTo((r.recibirAmazon! + 35.43 + 6.7) / (1 - 0.1263 - 0.0695), 8);
    const queda = 1 - (78.64 + 6) / 113.37;
    expect(r.tiktokLives).toBeCloseTo((r.recibirAmazon! + 6) / (1 - queda), 8);
  });

  it("con ventas al precio relámpago: ganancia y «Recibir» salen de lo depositado A ESE PRECIO, no del promedio", () => {
    const e = { modelo: "GT148", ...ENTRADA_VACIA, envioMeli: 41, precioRelampago: 199.99, envioAmazon: 54 };
    const r = calcularNumeros(e, 58.54, {
      meli: { pares: 1762, paresDirecta: 105, comisionPct: 0.15, envioPar: 41, retencionPct: 0.0078, netoPar: 139.8 },
      meliPorPrecio: [
        { precio: 200, pares: 413, netoPar: 126.87 },
        { precio: 250, pares: 251, netoPar: 163.93 },
      ],
    });
    expect(r.recibidoMeli).toMatchObject({ porPar: 126.87, pares: 413, fuente: "real", ganancia: 126.87 - 58.54 });
    expect(r.ganancia).toBeCloseTo(126.87 - 58.54, 8);
    expect(r.recibirAmazon).toBeCloseTo(126.87, 8);
    expect(r.promedioMeli?.porPar).toBe(139.8);
  });

  it("pocas ventas al precio relámpago: no se le cree", () => {
    const e = { modelo: "X", ...ENTRADA_VACIA, envioMeli: 41, precioRelampago: 199.99 };
    const r = calcularNumeros(e, 50, { meliPorPrecio: [{ precio: 200, pares: 3, netoPar: 150 }] });
    expect(r.recibidoMeli?.fuente).toBe("tasas");
  });

  it("pocas ventas: se queda la estimación del dueño", () => {
    const e = { modelo: "X", ...ENTRADA_VACIA, envioMeli: 38, precioRelampago: 200, envioAmazon: 39 };
    const r = calcularNumeros(e, 50, { meli: { pares: 3, paresDirecta: 3, comisionPct: 0.15, envioPar: 99, retencionPct: 0.09, netoPar: 1 } });
    expect(r.usado.meli.fuente).toBe("estimado");
    expect(r.recibidoMeli?.fuente).toBe("tasas");
    expect(r.ganancia).toBeCloseTo(200 - 30 - 38 - 50, 8);
  });

  it("muchas ventas pero casi ninguna directa: comisión real y envío estimado", () => {
    const e = { modelo: "G650", ...ENTRADA_VACIA, envioMeli: 44, precioRelampago: 298.99 };
    const r = calcularNumeros(e, 112, { meli: { pares: 91, paresDirecta: 3, comisionPct: 0.15, envioPar: 59, retencionPct: 0.0045, netoPar: 204 } });
    expect(r.usado.meli).toMatchObject({ fuente: "real", envio: 44 });
  });

  it("sin costo no inventa precios", () => {
    const r = calcularNumeros({ modelo: "X", ...ENTRADA_VACIA, precioRelampago: 200 }, null);
    expect(r.ganancia).toBeNull();
    expect(r.pvNormal).toBeCloseTo(210, 6);
  });
});

describe("utilidades", () => {
  it("números y ids", () => {
    expect(numeroCelda("$1,234.50")).toBe(1234.5);
    expect(numeroCelda("ENTREGADO")).toBeNull();
    expect(idContenedor("S252-2026")).toEqual({ id: "S252", anio: 2026 });
    expect(idContenedor("IN10079")).toBeNull();
    expect(idContenedor("P605")).toEqual({ id: "P605", anio: null });
  });
});

describe("Números: el relámpago de aquí manda (8-nov-2026)", () => {
  it("sin ventas a ese precio, lleva lo real del precio vendido más cercano (GT190 a $499.99)", async () => {
    const { calcularNumeros, ENTRADA_VACIA } = await import("./numeros");
    const r = calcularNumeros({ ...ENTRADA_VACIA, modelo: "GT190", precioRelampago: 499.99, envioMeli: 95 }, 241.51, {
      meliPorPrecio: [{ precio: 530, pares: 40, netoPar: 356.44 }],
    });
    const queda = 1 - (356.44 + 95) / 530;
    expect(r.recibidoMeli).toMatchObject({ fuente: "desde_ventas", precio: 499.99, base: { precio: 530, porPar: 356.44, pares: 40 } });
    expect(r.recibidoMeli!.porPar).toBeCloseTo(499.99 * (1 - queda) - 95, 6);
    expect(r.ganancia).toBeCloseTo(r.recibidoMeli!.porPar - 241.51, 6);
    // El relámpago real de MELI se enseña solo como referencia.
    expect(r.relampagoMeli).toEqual({ precio: 530, porPar: 356.44, pares: 40 });
    // PV normal = 5 % arriba y Amazon / TikTok salen de lo que se recibe aquí.
    expect(r.pvNormal).toBeCloseTo(499.99 * 1.05, 6);
    expect(r.recibirAmazon).toBeCloseTo(r.recibidoMeli!.porPar, 6);
  });

  it("no compara precios de distinto tramo de envío ($299)", async () => {
    const { calcularNumeros, ENTRADA_VACIA } = await import("./numeros");
    const r = calcularNumeros({ ...ENTRADA_VACIA, modelo: "GT150", precioRelampago: 298.88, envioMeli: 44 }, 100, {
      meliPorPrecio: [
        { precio: 370, pares: 232, netoPar: 229.4 },
        { precio: 350, pares: 52, netoPar: 211.74 },
      ],
    });
    expect(r.recibidoMeli?.fuente).toBe("tasas");
    expect(r.relampagoMeli?.precio).toBe(350);
  });

  it("si se vendió al relámpago de aquí, manda ese depósito", async () => {
    const { calcularNumeros, ENTRADA_VACIA } = await import("./numeros");
    const r = calcularNumeros({ ...ENTRADA_VACIA, modelo: "GT148", precioRelampago: 199.99, envioMeli: 41 }, 50, {
      meliPorPrecio: [
        { precio: 211, pares: 951, netoPar: 128.85 },
        { precio: 200, pares: 408, netoPar: 126.99 },
      ],
    });
    expect(r.recibidoMeli).toMatchObject({ fuente: "real", porPar: 126.99 });
  });

  it("Amazon y TikTok sin ventas del modelo usan lo que cobran en toda la cuenta", async () => {
    const { calcularNumeros, tarifasGenerales, ENTRADA_VACIA, FIJO_TIKTOK } = await import("./numeros");
    const general = tarifasGenerales({
      A: {
        amazon: { unidades: 100, precioPar: 300, comisionPct: 0.15, retencionPct: 0.05, fbaPar: 60, otrosPar: 5, netoPar: 0 },
        tiktok: { pares: 100, precioPar: 200, pagoPar: 130, afiliadoPct: 0 },
      },
      B: {
        amazon: { unidades: 300, precioPar: 300, comisionPct: 0.13, retencionPct: 0.05, fbaPar: 40, otrosPar: 0, netoPar: 0 },
        tiktok: { pares: 300, precioPar: 100, pagoPar: 60, afiliadoPct: 0 },
        // poquitas ventas: no cuenta
      },
      C: { tiktok: { pares: 2, precioPar: 100, pagoPar: 10, afiliadoPct: 0 } },
    });
    expect(general.amazon!.pctTotal).toBeCloseTo((0.2 * 100 + 0.18 * 300) / 400, 9);
    expect(general.tiktok!.pctTotal).toBeCloseTo(1 - ((130 + FIJO_TIKTOK) * 100 + (60 + FIJO_TIKTOK) * 300) / (200 * 100 + 100 * 300), 9);
    const r = calcularNumeros({ ...ENTRADA_VACIA, modelo: "N", precioRelampago: 300, envioMeli: 40 }, 100, { general });
    expect(r.usado.amazon).toMatchObject({ fuente: "general", pctTotal: general.amazon!.pctTotal, porPar: general.amazon!.porPar });
    expect(r.usado.tiktok).toEqual({ fuente: "general", pctTotal: general.tiktok!.pctTotal, fijo: FIJO_TIKTOK });
    expect(r.tiktokLives).toBeCloseTo((r.recibirAmazon! + FIJO_TIKTOK) / (1 - general.tiktok!.pctTotal), 6);
    // El envío de FBA capturado para el modelo manda sobre la mediana de la cuenta.
    const conEnvio = calcularNumeros({ ...ENTRADA_VACIA, modelo: "N", precioRelampago: 300, envioMeli: 40, envioAmazon: 70 }, 100, { general });
    expect(conEnvio.usado.amazon.porPar).toBe(70);
  });
});

describe("Números: el envío de MELI es el real (8-nov-2026)", () => {
  it("manda lo que MELI cobró en tus ventas del tramo del relámpago; luego ventas directas; luego el tuyo", async () => {
    const { calcularNumeros, ENTRADA_VACIA, tramoEnvio } = await import("./numeros");
    expect([tramoEnvio(298.99), tramoEnvio(299), tramoEnvio(498.99), tramoEnvio(499)]).toEqual([0, 1, 1, 2]);
    const meli = { pares: 50, paresDirecta: 20, comisionPct: 0.15, envioPar: 70, retencionPct: 0, netoPar: 300 };
    const base = { ...ENTRADA_VACIA, modelo: "GT190", envioMeli: 95 };
    const simulado = { 2: { costo: 88.5, variantes: 14 }, 1: { costo: 60, variantes: 5 }, 0: { costo: 41, variantes: 2 } };
    const a = calcularNumeros({ ...base, precioRelampago: 499.99 }, 240, { meli, envioMeliPorTramo: simulado });
    expect(a.usado.meli).toMatchObject({ envio: 88.5, envioFuente: "tramo" });
    // Bajar el relámpago a otro tramo cambia el envío solo.
    const b = calcularNumeros({ ...base, precioRelampago: 449.99 }, 240, { meli, envioMeliPorTramo: simulado });
    expect(b.usado.meli).toMatchObject({ envio: 60, envioFuente: "tramo" });
    const c = calcularNumeros({ ...base, precioRelampago: 249.99 }, 240, { meli, envioMeliPorTramo: simulado });
    expect(c.usado.meli).toMatchObject({ envio: 70, envioFuente: "ventas" });
    const d = calcularNumeros({ ...base, precioRelampago: 249.99 }, 240, {});
    expect(d.usado.meli).toMatchObject({ envio: 95, envioFuente: "tuyo" });
  });
});

describe("Números en vivo (8-nov-2026)", () => {
  it("MELI en vivo a ese precio manda (con el cargo fijo de abajo de $299) y el PV normal usa su propio precio", async () => {
    const { calcularNumeros, ENTRADA_VACIA } = await import("./numeros");
    const e = { ...ENTRADA_VACIA, modelo: "GT148", precioRelampago: 199.99, envioMeli: 41 };
    const vivo = {
      leidoEn: "",
      avisos: [],
      amazon: null,
      meli: [
        { precio: 199.99, comisionPct: 0.15, fijo: 25, envio: 30 },
        { precio: 209.99, comisionPct: 0.15, fijo: 25, envio: 31 },
      ],
    };
    const r = calcularNumeros(e, 50, {}, vivo);
    expect(r.recibidoMeli).toMatchObject({ fuente: "vivo" });
    expect(r.recibidoMeli!.porPar).toBeCloseTo(199.99 * 0.85 - 25 - 30, 6);
    expect(r.usado.meli).toMatchObject({ fuente: "vivo", fijo: 25, envio: 30, envioFuente: "vivo" });
    expect(r.gananciaNormal).toBeCloseTo(199.99 * 1.05 * 0.85 - 25 - 31 - 50, 6);
    // Lo depositado de verdad a ese precio le gana a lo en vivo.
    const conVentas = calcularNumeros(e, 50, { meliPorPrecio: [{ precio: 200, pares: 400, netoPar: 126.87 }] }, vivo);
    expect(conVentas.recibidoMeli).toMatchObject({ fuente: "real", porPar: 126.87 });
  });

  it("Amazon en vivo al PVP; si el PVP cae en otro tramo, se queda con lo de 30 días", async () => {
    const { calcularNumeros, ENTRADA_VACIA } = await import("./numeros");
    const e = { ...ENTRADA_VACIA, modelo: "X", precioRelampago: 300, envioMeli: 40, envioAmazon: 70 };
    const base = calcularNumeros(e, 100, {});
    const vivo = { leidoEn: "", avisos: [], meli: [], amazon: { precio: 420, comisionPct: 0.12, porPar: 65, sku: "X-BLK-25-MX" } };
    const r = calcularNumeros(e, 100, {}, vivo);
    expect(r.usado.amazon.fuente).toBe("vivo");
    expect(r.pvpAmazon).toBeCloseTo((base.recibirAmazon! + 65) / (1 - 0.12), 6);
    const otroTramo = calcularNumeros(e, 100, {}, { ...vivo, amazon: { ...vivo.amazon, precio: 250 } });
    expect(otroTramo.usado.amazon.fuente).toBe("estimado");
  });
});

describe("GT190 contra la orden real 2000019378989864 (8-nov-2026)", () => {
  it("a $539.79 en vivo (15 %) con el envío real del tramo da los $370.32 que depositó MELI", async () => {
    const { calcularNumeros, ENTRADA_VACIA } = await import("./numeros");
    const reales = {
      meli: { pares: 29, paresDirecta: 0, comisionPct: null, envioPar: null, retencionPct: 0, netoPar: 380 },
      envioMeliPorTramo: { 2: { costo: 88.5, variantes: 14 } },
    };
    // El simulador decía $139.50 (costo de LISTA): no manda si hay ventas en el tramo.
    const vivo = { leidoEn: "", avisos: [], amazon: null, meli: [{ precio: 539.79, comisionPct: 0.15, fijo: 0, envio: 139.5 }] };
    const r = calcularNumeros({ ...ENTRADA_VACIA, modelo: "GT190", precioRelampago: 539.79, envioMeli: 95 }, 241.51, reales, vivo);
    expect(r.usado.meli).toMatchObject({ envio: 88.5, envioFuente: "tramo" });
    expect(r.recibidoMeli!.porPar).toBeCloseTo(370.32, 2);
  });
});

describe("Amazon: lo que Amazon cobró al modelo manda sobre el estimado en vivo (8-nov-2026)", () => {
  it("GT190: 8 ventas a $614.59 con 5 % de comisión, 6.9 % de retención y $81.80 de FBA", async () => {
    const { calcularNumeros, ENTRADA_VACIA } = await import("./numeros");
    const reales = {
      amazon: { unidades: 8, precioPar: 614.59, comisionPct: 0.05, retencionPct: 0.069, fbaPar: 81.8, otrosPar: 0, netoPar: 459.67 },
    };
    const vivo = { leidoEn: "", avisos: [], meli: [], amazon: { precio: 444.54, comisionPct: 0.13, porPar: 70.5, sku: "GT190-BLK-25-MX" } };
    const r = calcularNumeros({ ...ENTRADA_VACIA, modelo: "GT190", precioRelampago: 499.99, envioMeli: 95 }, 241.51, reales, vivo);
    expect(r.usado.amazon).toMatchObject({ fuente: "real", porPar: 81.8 });
    expect(r.usado.amazon.pctTotal).toBeCloseTo(0.119, 9);
    expect(r.pvpAmazon).toBeCloseTo((r.recibirAmazon! + 81.8) / (1 - 0.119), 6);
  });
});
