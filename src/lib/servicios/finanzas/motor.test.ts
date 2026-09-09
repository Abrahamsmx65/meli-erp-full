import { describe, expect, it } from "vitest";
import { aCentavos, armarFinanzas, armarTotales } from "./motor";
import type { DiaOrdenesAgregado } from "../corte-meli";

/** Un día del RPC con solo lo que el motor lee; lo demás en cero. */
const dia = (fecha: string, x: Partial<DiaOrdenesAgregado>): DiaOrdenesAgregado => ({
  fecha,
  ordenes: 0,
  neto: 0,
  cancelOrdenes: 0,
  cancelImporte: 0,
  devOrdenes: 0,
  devMonto: 0,
  total: 0,
  revisadas: 0,
  pendientes: 0,
  ...x,
});

const rango = { desde: "2026-09-01", hasta: "2026-09-30" };
const generadoEn = "2026-09-09T00:00:00.000Z";

describe("motor de dinero — capturas reales de Mercado Pago", () => {
  it("venta DIRECTA: 98.34 − 8.90 de retenciones − 25 de envío − 14.75 de comisión = 49.69", () => {
    const f = armarFinanzas({
      rango,
      generadoEn,
      ventas: [{ fecha: "2026-09-08", importe: 98.34 }],
      dias: [
        dia("2026-09-08", {
          ordenes: 1,
          neto: 49.69,
          comisionMp: 14.75,
          envio: 25,
          isr: 2.12,
          iva: 6.78,
          cargosLeidos: 1,
          netosLeidos: 1,
        }),
      ],
    });
    expect(f.totales).toEqual({
      bruto: 9834,
      comision: 1475,
      envio: 2500,
      retenciones: 890,
      otros: 0,
      sinIdentificar: 0, // todo explicado: no queda nada por identificar
      neto: 4969,
    });
    expect(f.cobertura.parteCargos).toBe(1);
  });

  it("REVENTA: 59.06 sin cargos → recibe 59.06, y se cuenta aparte", () => {
    const f = armarFinanzas({
      rango,
      generadoEn,
      ventas: [{ fecha: "2026-09-08", importe: 59.06 }],
      dias: [dia("2026-09-08", { ordenes: 1, neto: 59.06, sinDescOrdenes: 1, sinDescTotal: 59.06, cargosLeidos: 1, netosLeidos: 1 })],
    });
    expect(f.totales.neto).toBe(5906);
    expect(f.totales.sinIdentificar).toBe(0);
    expect(f.reventa).toEqual({ ordenes: 1, importe: 5906 });
  });

  it("la cascada SIEMPRE cuadra: bruto − cargos − sin identificar = neto, al centavo", () => {
    // Un caso como el de producción hoy: comisión leída, envío y retenciones NO.
    const f = armarFinanzas({
      rango,
      generadoEn,
      ventas: [{ fecha: "2026-09-08", importe: 208 }],
      dias: [dia("2026-09-08", { ordenes: 1, neto: 118.98, comisionMp: 31.2, cargosLeidos: 1, netosLeidos: 1 })],
    });
    const sumaCargos = f.cascada
      .filter((p) => !p.esResultado && p.clave !== "bruto")
      .reduce((a, p) => a + p.monto, 0);
    expect(f.totales.bruto + sumaCargos).toBe(f.totales.neto);
    // Y los $57.82 que Mercado Pago no desglosó quedan DECLARADOS, no escondidos.
    expect(f.totales.sinIdentificar).toBe(5782);
  });

  it("una orden cuyo pago no se ha leído no infla el neto: cae en «sin identificar» y se declara", () => {
    const f = armarFinanzas({
      rango,
      generadoEn,
      ventas: [{ fecha: "2026-09-08", importe: 300 }],
      // Dos órdenes: solo una con pago leído.
      dias: [dia("2026-09-08", { ordenes: 2, neto: 80, comisionMp: 15, cargosLeidos: 1, netosLeidos: 1 })],
    });
    expect(f.cobertura).toMatchObject({ ordenes: 2, conCargos: 1, parteCargos: 0.5 });
    expect(f.totales.sinIdentificar).toBe(30000 - 1500 - 8000);
    expect(f.cascada.find((p) => p.clave === "sinIdentificar")!.nota).toContain("1 órdenes cuyo pago aún no se lee");
  });

  it("no pierde centavos: tres décimas de centavo no se vuelven cero ni suman de más", () => {
    // El defecto que la auditoría reprodujo repartiendo $0.01: aquí el dinero
    // entra en centavos enteros y las sumas son exactas.
    expect(aCentavos(0.1) + aCentavos(0.2)).toBe(30);
    expect(aCentavos(1.005)).toBe(101); // redondeo al centavo, no truncado
    const t = armarTotales(
      [dia("2026-09-01", { neto: 0.01 }), dia("2026-09-02", { neto: 0.01 }), dia("2026-09-03", { neto: 0.01 })],
      [{ fecha: "2026-09-01", importe: 0.03 }],
    );
    expect(t.neto).toBe(3);
    expect(t.sinIdentificar).toBe(0);
  });

  it("solo cuenta los días dentro del rango", () => {
    const f = armarFinanzas({
      rango: { desde: "2026-09-01", hasta: "2026-09-02" },
      generadoEn,
      ventas: [
        { fecha: "2026-08-31", importe: 1000 },
        { fecha: "2026-09-01", importe: 100 },
        { fecha: "2026-09-03", importe: 1000 },
      ],
      dias: [dia("2026-08-31", { neto: 900 }), dia("2026-09-01", { neto: 90 }), dia("2026-09-03", { neto: 900 })],
    });
    expect(f.totales.bruto).toBe(10000);
    expect(f.totales.neto).toBe(9000);
  });
});
