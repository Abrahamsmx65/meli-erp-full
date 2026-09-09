import { describe, expect, it } from "vitest";
import { conciliarVentas, fechaDeVentaMeli, leerReporteVentas, type VentaErp } from "./conciliar-ventas";

const ENC = ["# de venta", "Fecha de venta", "Estado", "Descripción del estado", "Modelo de venta", "Paquete de varios productos", "Pertenece a un kit", "Unidades", "Ingresos por productos (MXN)", "Cargo por venta e impuestos (MXN)", "Ingresos por envío (MXN)", "Costos de envío (MXN)", "Costo de envío por cambio de producto (MXN)", "Costo de envío basado en medidas y peso (MXN)", "Cargo por diferencias en medidas y peso (MXN)", "Descuentos y bonificaciones", "Anulaciones y reembolsos (MXN)", "Total (MXN)", "Orden de compra", "Venta por publicidad", "SKU"];
const fila = (valores: Record<number, string>) => ENC.map((_, i) => valores[i] ?? "");

const FILAS: string[][] = [
  ["En este reporte encontrarás la información…"],
  [],
  ENC,
  // Paquete de dos órdenes (verificado con 2000014806795251)
  fila({ 0: "2000014806795251", 1: "31 de agosto de 2026 23:59 hs.", 2: "Paquete de 2 productos", 4: "Venta directa", 8: "239.38", 9: "-57.56", 11: "-76", 17: "105.82" }),
  fila({ 0: "2000018220633018", 2: "Entregado", 5: "Sí", 7: "1", 20: "MY2307-PURPLE-24-MX" }),
  fila({ 0: "2000018220631834", 2: "Entregado", 5: "Sí", 7: "1", 20: "MY2307-BLUE-26-MX" }),
  // Orden suelta con su producto en la misma fila (reventa)
  fila({ 0: "2000018220538232", 1: "31 de agosto de 2026 23:39 hs.", 2: "Entregado", 4: "Reventa", 7: "1", 8: "213.14", 17: "213.14", 20: "GT135-TABACO BROWN-23-MX" }),
  // Orden suelta directa
  fila({ 0: "2000018220575874", 1: "31 de agosto de 2026 23:30 hs.", 2: "Entregado", 4: "Venta directa", 7: "1", 8: "124.99", 9: "-30.06", 11: "-38", 17: "56.93", 20: "GT142-NAVY-24-MX" }),
  // Cancelada
  fila({ 0: "2000018000000001", 1: "2 de agosto de 2026 10:00 hs.", 2: "Cancelada por el comprador", 4: "Venta directa", 8: "100", 17: "0" }),
];

const erp = (x: Partial<VentaErp> & { venta: string }): VentaErp => ({
  ordenes: 1, fecha: "2026-08-31", estados: "paid", tipo_venta: "directa", total: 0, comision: 0, envio: 0, isr: 0, iva: 0, otros: 0, sin_desglosar: 0, neto: 0, sin_neto: 0, reembolsado: 0, con_pago_real: 1, ...x,
});

describe("leerReporteVentas", () => {
  it("arma las ventas (paquete con sus órdenes, orden suelta con su SKU) y lee las fechas", () => {
    const v = leerReporteVentas(FILAS);
    expect(v).toHaveLength(4);
    expect(v[0]).toMatchObject({ venta: "2000014806795251", fecha: "2026-08-31", estado: "Paquete de 2 productos", ingresos: 239.38, cargo: -57.56, costoEnvio: -76, total: 105.82, ordenes: ["2000018220633018", "2000018220631834"], unidades: 2 });
    expect(v[0].skus).toEqual(["MY2307-PURPLE-24-MX", "MY2307-BLUE-26-MX"]);
    expect(v[1]).toMatchObject({ venta: "2000018220538232", modelo: "Reventa", total: 213.14, skus: ["GT135-TABACO BROWN-23-MX"], unidades: 1, ordenes: [] });
    expect(fechaDeVentaMeli("1 de septiembre de 2026 14:31 hs.")).toBe("2026-09-01");
    expect(fechaDeVentaMeli("x")).toBeNull();
  });
});

describe("conciliarVentas", () => {
  it("cuadra el paquete por la suma de sus órdenes, la reventa sin cargos, y enseña la distinta, la sin pago real y la que solo está en un lado", () => {
    const reporte = leerReporteVentas(FILAS);
    const informe = conciliarVentas(reporte, [
      erp({ venta: "2000014806795251", ordenes: 2, total: 239.38, comision: 35.9, isr: 5.16, iva: 16.5, envio: 76, neto: 105.82, con_pago_real: 2 }),
      erp({ venta: "2000018220538232", tipo_venta: "reventa", total: 213.14, comision: 44.85, envio: 41, neto: 213.14 }),
      // El ERP le leyó 1 peso más de neto: distinta.
      erp({ venta: "2000018220575874", total: 124.99, comision: 18.75, isr: 2.69, iva: 8.62, envio: 38, neto: 57.93 }),
      // Cancelada en el ERP: no cuenta como "solo en el ERP".
      erp({ venta: "2000018000000009", estados: "cancelled", total: 50, neto: 0 }),
      // Solo en el ERP, con venta.
      erp({ venta: "2000018000000010", fecha: "2026-08-15", total: 80, neto: 60 }),
    ]);
    expect(informe.rango).toEqual({ desde: "2026-08-02", hasta: "2026-08-31" });
    expect(informe).toMatchObject({ ventasReporte: 4, comparables: 3, cuadran: 2, distintas: 1, soloReporte: 1, soloErp: 1, canceladasReporte: 1, sinPagoReal: 0 });
    expect(informe.sumas).toMatchObject({ ingresos: 577.51, total: 577.51, cargosReporte: -87.62, cargosErp: -87.62, envioReporte: -114, envioErp: -114, netoReporte: 375.89, netoErp: 376.89 });
    expect(informe.ejemplos[0]).toMatchObject({ venta: "2000018000000010", motivo: "solo_erp", diferencia: -60 });
    expect(informe.ejemplos.find((d) => d.venta === "2000018220575874")).toMatchObject({ motivo: "neto", diferencia: -1 });
    // La cancelada del reporte no es diferencia que perseguir.
    expect(informe.ejemplos.some((d) => d.venta === "2000018000000001")).toBe(false);
    expect(informe.reporteCompleto).toMatchObject({ total: 375.89, reventa: 1 });
  });

  it("una venta cuyo ERP aún no tiene el pago real no se compara y se declara", () => {
    const reporte = leerReporteVentas(FILAS).slice(2, 3);
    const informe = conciliarVentas(reporte, [erp({ venta: "2000018220575874", total: 124.99, neto: 56.93, con_pago_real: 0 })]);
    expect(informe).toMatchObject({ comparables: 0, sinPagoReal: 1, cuadran: 0 });
    expect(informe.avisos[0]).toMatch(/pago real/);
  });
});
