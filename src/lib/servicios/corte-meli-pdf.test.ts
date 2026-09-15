import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { armarEstadoResultados } from "./corte-meli";
import { pdfDelCorte, pesosPdf } from "./corte-meli-pdf";

describe("pdfDelCorte", () => {
  it("genera un PDF carta con portada y detalle, con acentos y sin tronar", async () => {
    const e = armarEstadoResultados({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      cuenta: "GETAC",
      generadoEn: "2026-09-07T12:00:00.000Z",
      ventas: Array.from({ length: 31 }, (_, i) => ({
        sku: i % 2 ? "GT135-TABACO-25" : "MY2307-BLACK-26",
        fecha: `2026-08-${String(i + 1).padStart(2, "0")}`,
        unidades: 3,
        ordenes: 2,
        importe: 600,
        comision: 90,
        neto: 350.55,
      })),
      ordenes: Array.from({ length: 31 }, (_, i) => ({
        orderId: i + 1,
        fecha: `2026-08-${String(i + 1).padStart(2, "0")}`,
        total: 600,
        neto: 350.55,
        netoActual: null,
        reembolsado: i === 4 ? 200 : 0,
        estado: "paid",
        estadoPago: i === 4 ? "refunded" : "approved",
        revisiones: 2,
      })),
      modeloDeSku: new Map([
        ["GT135-TABACO-25", "GT135"],
        ["MY2307-BLACK-26", "MY2307"],
      ]),
      config: new Map([
        ["GT135", { categoria: "Corcho ñandú", costo: 60 }],
        ["MY2307", { categoria: null, costo: 40 }],
      ]),
      adsPorModelo: new Map([["GT135", 120]]),
      adsSinAmarre: 0,
      errorAds: null,
      gastos: [{ id: 1, fecha: "2026-08-10", concepto: "Almacenamiento Full · agosto", categoria: "full", monto: 1234.56 }],
      cargos: [],
      cargosLeidos: false,
    });
    const bytes = await pdfDelCorte(e);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(doc.getTitle()).toBe("Corte Agosto 2026 · Mercado Libre");
  });

  it("formatea pesos con dos decimales y signo", () => {
    expect(pesosPdf(1234567.891)).toBe("$1,234,567.89");
    expect(pesosPdf(-0.5)).toBe("-$0.50");
    expect(pesosPdf(0)).toBe("$0.00");
  });
});
