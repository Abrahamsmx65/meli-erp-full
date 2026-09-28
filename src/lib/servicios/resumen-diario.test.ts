import { describe, expect, it } from "vitest";
import { armarCorreoResumen, armarResumen, diaAnterior, fechaLarga, filasDeConsolidado, tiktokDelRango } from "./resumen-diario";
import { cargosDelRango, rangoRecortado } from "./corte-meli";
import type { Consolidado } from "./consolidado";

function consolidado(canales: Record<string, unknown>[]): Consolidado {
  return { periodo: "2026-09", desde: "2026-09-27", hasta: "2026-09-27", canales } as unknown as Consolidado;
}

const calzado = {
  canal: "meli_calzado", nombre: "Calzado · Mercado Libre", unidades: 1_000, unidadesConCosto: 1_000, ventaBruta: 300_000, neto: 200_000,
  coberturaNeto: 0.9, utilidadBruta: 80_000, publicidad: 10_000, utilidadNeta: 40_000,
};

describe("rango de un día", () => {
  it("recorta el periodo por los dos lados", () => {
    expect(rangoRecortado("2026-09", { desde: "2026-09-27", hasta: "2026-09-27" })).toEqual({ desde: "2026-09-27", hasta: "2026-09-27" });
    expect(rangoRecortado("2026-08", { hasta: "2026-08-25" })).toEqual({ desde: "2026-08-01", hasta: "2026-08-25" });
  });
  it("la facturación sin fecha es del mes: entra con `hasta`, no en un tramo que arranca después del 1", () => {
    const cargos = [{ fecha: "2026-09-27T10:00:00Z" }, { fecha: "2026-09-20" }, { fecha: null }];
    expect(cargosDelRango(cargos, { desde: "2026-09-27", hasta: "2026-09-27" }, "2026-09-27", "2026-09-27")).toHaveLength(1);
    expect(cargosDelRango(cargos, { hasta: "2026-09-25" }, "2026-09-01", "2026-09-25")).toHaveLength(2);
    expect(cargosDelRango(cargos, {}, "2026-09-01", "2026-09-30")).toHaveLength(3);
  });
});

describe("filasDeConsolidado", () => {
  it("el día: ganancia = neto − costo − publicidad, sin los gastos del mes; declara lo que falta de depósito", () => {
    const [f] = filasDeConsolidado(consolidado([calzado]), true);
    expect(f.ganancia).toBe(70_000);
    expect(f.notas[0]).toContain("90 %");
  });
  it("el mes: la utilidad del canal después de sus gastos", () => {
    expect(filasDeConsolidado(consolidado([calzado]), false)[0].ganancia).toBe(40_000);
  });
});

describe("tiktokDelRango", () => {
  const ordenes = [
    { orderId: "a", estado: "IN_TRANSIT", creadoEn: "2026-09-27T18:00:00Z", pagoEsperado: 400 },
    { orderId: "b", estado: "AWAITING_SHIPMENT", creadoEn: "2026-09-27T20:00:00Z", pagoEsperado: null },
    { orderId: "c", estado: "CANCELLED", creadoEn: "2026-09-27T20:00:00Z", pagoEsperado: 999 },
    // 04:00Z del 28 = 22:00 del 27 en México
    { orderId: "d", estado: "COMPLETED", creadoEn: "2026-09-28T04:00:00Z", netoRecibido: 200 },
  ];
  const renglones = [
    { orderId: "a", skuInterno: "GT134-BLK-24-MX", cantidad: 2, precio: 250, estado: null },
    { orderId: "b", skuInterno: "GT134-BLK-25-MX", cantidad: 1, precio: 250, estado: null },
    { orderId: "c", skuInterno: "GT134-BLK-25-MX", cantidad: 1, precio: 250, estado: null },
    { orderId: "d", skuInterno: "MY2304-PURPLE-23-MX", cantidad: 1, precio: 300, estado: null },
  ];
  it("pares y cobrado de lo en pie; ganancia solo de lo que TikTok ya calcula y tiene costo", () => {
    const t = tiktokDelRango(ordenes, renglones, new Map([["GT134", 100]]), { desde: "2026-09-27", hasta: "2026-09-27" });
    expect(t.unidades).toBe(4);
    expect(t.facturacion).toBe(1_050);
    // GT134: 400 − 2 × 100; el MY2304 no tiene costo y el pedido b no tiene dato.
    expect(t.ganancia).toBe(200);
    expect(t.notas.join(" ")).toContain("1 pares ($250) que TikTok aún no calcula");
    expect(t.notas.join(" ")).toContain("1 pares sin costo");
  });
});

describe("armarResumen y correo", () => {
  it("siempre las cuatro plataformas, en orden, con su total", () => {
    const r = armarResumen("2026-09-27", consolidado([calzado]), { unidades: 4, facturacion: 1_050, ganancia: 200, notas: [] }, null);
    expect(r.filas.map((f) => f.canal)).toEqual(["meli_calzado", "meli_fundas", "amazon", "tiktok"]);
    expect(r.filas[1].ganancia).toBeNull();
    expect(r.total).toEqual({ unidades: 1_004, facturacion: 301_050, ganancia: 70_200 });
    const correo = armarCorreoResumen(r);
    expect(correo.asunto).toContain("domingo 27 de septiembre");
    expect(correo.html).toContain("TikTok Shop");
    expect(correo.texto).toContain("Total: 1,004 u");
  });
  it("fechas", () => {
    expect(diaAnterior("2026-10-01")).toBe("2026-09-30");
    expect(fechaLarga("2026-09-28")).toBe("lunes 28 de septiembre");
  });
});
