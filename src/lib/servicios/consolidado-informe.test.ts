import { describe, expect, it } from "vitest";
import { armarConsolidado, type BloqueCanal } from "./consolidado";
import { avisosParaMostrar, cascadaDelMes, clasificarAviso, clasificarAvisos, estadoDelCorte, loQuePaso, repartoDelPeso } from "./consolidado-informe";
import { pdfDelConsolidado } from "./consolidado-pdf";

function bloque(over: Partial<BloqueCanal> & Pick<BloqueCanal, "canal">): BloqueCanal {
  return {
    unidades: 100, ordenes: 90, ventaBruta: 10_000, neto: 6_300, fuenteNeto: "prueba", coberturaNeto: 1,
    descuentos: [], desglosePlataforma: { comision: 1_500, envio: 1_800, isr: 100, iva: 300, otros: 0, ajusteLiquidacion: 0 },
    devoluciones: 0, devolucionesIncluidasEnNeto: 0, costoRecuperado: 0, costoProducto: 2_500, unidadesConCosto: 100,
    adsPorModelo: 400, adsGenerales: 50, gastos: [{ concepto: "Full", monto: 250 }, { concepto: "Publicidad sin amarre", monto: 50 }],
    porModelo: [{ modelo: "GT114", categoria: "Corcho", unidades: 100, importe: 10_000, neto: 6_000, costo: 2_500, ads: 400 }],
    avisos: [], exacto: true, ...over,
  };
}

const cns = armarConsolidado({
  periodo: "2026-09", desde: "2026-09-01", hasta: "2026-09-30", generadoEn: "2026-10-09T00:00:00Z",
  bloques: [
    bloque({ canal: "meli_calzado", avisos: ["Las retenciones de ISR e IVA son impuesto adelantado que MELI entera al SAT; no son un gasto adicional y se acreditan en la declaración."] }),
    // Amazon: el neto ya trae 200 de reembolsos descontados (no cierra con los cargos).
    bloque({
      canal: "amazon", neto: 6_100, devolucionesIncluidasEnNeto: 200,
      porModelo: [
        { modelo: "GT114", categoria: "Corcho", unidades: 90, importe: 9_000, neto: 5_500, costo: 2_400, ads: 400 },
        { modelo: "380", categoria: null, unidades: 10, importe: 1_000, neto: 300, costo: null, ads: 0 },
      ],
      avisos: ["Amazon: 1% de las unidades vendidas son de modelos sin costo capturado; su ganancia no se calcula.", "Amazon: las devoluciones se restan completas; el costo de los pares devueltos NO se suma de vuelta porque Amazon no dice si regresaron vendibles."],
      exacto: false,
    }),
    bloque({ canal: "tiktok", avisos: ["TikTok: $1,000 del neto está POR LIQUIDAR (lo que TikTok dice que pagará); lo demás ya se liquidó."], exacto: false }),
  ],
});

describe("cascadaDelMes", () => {
  it("cierra al centavo de la venta a la utilidad, con los reembolsos ya descontados en su propio renglón", () => {
    const pasos = cascadaDelMes(cns);
    expect(pasos[0]).toMatchObject({ concepto: "Venta bruta", monto: 30_000 });
    const neto = pasos.find((p) => p.tipo === "subtotal")!;
    expect(neto.monto).toBe(18_700);
    const antesDelNeto = pasos.slice(0, pasos.indexOf(neto)).reduce((a, p) => a + p.monto, 0);
    expect(Math.round(antesDelNeto * 100)).toBe(Math.round(neto.monto * 100));
    expect(pasos.some((p) => p.concepto === "Reembolsos ya descontados del depósito" && p.monto === -200)).toBe(true);
    const final = pasos.at(-1)!;
    expect(final.monto).toBe(cns.total.utilidadNeta);
    const despues = pasos.slice(pasos.indexOf(neto) + 1, -1).reduce((a, p) => a + p.monto, neto.monto);
    expect(Math.round(despues * 100)).toBe(Math.round(final.monto * 100));
  });
});

describe("repartoDelPeso", () => {
  it("cada canal reparte su peso completo (plataforma + producto + publicidad + gastos + utilidad = 1)", () => {
    for (const r of repartoDelPeso(cns)) {
      expect(r.plataforma + r.costo + r.publicidad + r.gastos + r.utilidad).toBeCloseTo(1, 6);
    }
    expect(repartoDelPeso(cns).at(-1)!.canal).toBe("total");
  });
});

describe("avisos", () => {
  it("separa lo que pide acción, lo que llega solo y lo que solo explica", () => {
    expect(clasificarAviso("Las retenciones de ISR e IVA son impuesto adelantado…")).toBe("nota");
    expect(clasificarAviso("35,421 órdenes del mes aún no llegan al plazo de sus revisiones")).toBe("pendiente");
    expect(clasificarAviso("15 día(s) donde las órdenes y los renglones de venta no cuadran")).toBe("accion");
  });

  it("quita el nombre repetido del canal y junta el mismo texto de varios canales", () => {
    const a = clasificarAvisos([
      "Calzado · Mercado Libre: Las retenciones de ISR e IVA son impuesto adelantado.",
      "Fundas · Mercado Libre: Las retenciones de ISR e IVA son impuesto adelantado.",
      "Amazon: Amazon: la publicidad del periodo incluye $68,097.30 de IVA facturado por Amazon.",
    ]);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ origen: "Calzado MELI y Fundas MELI", tipo: "nota" });
    expect(a[1]).toMatchObject({ origen: "Amazon", texto: "La publicidad del periodo incluye $68,097.30 de IVA facturado por Amazon." });
  });

  it("el neto sin costo va por canal con su monto, en lugar del aviso suelto", () => {
    const v = avisosParaMostrar(cns);
    expect(v.sinCosto).toEqual([{ canal: "amazon", nombre: "Amazon", unidades: 10, neto: 300, modelos: ["380"] }]);
    expect(v.acciones.some((a) => /sin costo/.test(a.texto))).toBe(false);
    expect(estadoDelCorte(cns)).toMatchObject({ estado: "incompleto", acciones: 1, pendientes: 1 });
  });
});

describe("loQuePaso y el PDF", () => {
  it("cuenta el mes con palabras", () => {
    const f = loQuePaso(cns);
    expect(f[0]).toContain("300 unidades");
    expect(f.join(" ")).toContain("De cada $100 de venta");
  });

  it("arma el informe en PDF sin tronar", async () => {
    const bytes = await pdfDelConsolidado(cns, { preliminar: true });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
