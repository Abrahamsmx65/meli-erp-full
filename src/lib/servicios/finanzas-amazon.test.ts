import { describe, expect, it } from "vitest";
import { armarFinanzasAmazon } from "./finanzas-amazon";

const fila = (sku: string, lista: string, x: Partial<{ unidades: number; principal: number; impuesto_cobrado: number; comision: number; fba: number; retenido: number; promociones: number; otras_tarifas: number; otros_cargos: number; neto: number; eventos: number }>) => ({
  seller_sku: sku,
  lista,
  eventos: x.eventos ?? 1,
  unidades: x.unidades ?? 0,
  principal: x.principal ?? 0,
  impuesto_cobrado: x.impuesto_cobrado ?? 0,
  otros_cargos: x.otros_cargos ?? 0,
  comision: x.comision ?? 0,
  fba: x.fba ?? 0,
  otras_tarifas: x.otras_tarifas ?? 0,
  retenido: x.retenido ?? 0,
  promociones: x.promociones ?? 0,
  neto: x.neto ?? 0,
});

const grupoCerrado = { grupo_id: "g1", inicio: "2026-08-13T05:53:42Z", fin: "2026-08-26T14:16:37Z", estado: "Closed", total_original: 975028.92, suma_eventos: 975028.92, eventos: 9000, sin_clasificar: 0, completo: true, cuadra: true };

describe("armarFinanzasAmazon", () => {
  it("la cascada del pedido real 702-3552234-5242623 cuadra al centavo y se agrupa por modelo con costo", () => {
    const f = armarFinanzasAmazon(
      { desde: "2026-08-01", hasta: "2026-08-31" },
      [fila("GT128-24-BLK-MX", "ShipmentEventList", { unidades: 1, principal: 206.03, impuesto_cobrado: 32.97, comision: -35.86, fba: -36, retenido: -16.49, neto: 150.65 })],
      [{ lista: "ProductAdsPaymentEventList", eventos: 2, monto: -116, base: -100, impuesto: -16, sin_clasificar: 0 }],
      [grupoCerrado],
      new Map([["GT128", { categoria: "Tenis", costo: 60 }]]),
    );
    expect(f.ventas).toMatchObject({ unidades: 1, bruto: 239, comision: -35.86, fba: -36, retenido: -16.49, neto: 150.65 });
    expect(f.publicidad).toEqual({ eventos: 2, monto: -116, base: -100, impuesto: -16 });
    expect(f.netoProductos).toBe(150.65);
    expect(f.netoDepositado).toBe(34.65);
    expect(f.porModelo[0]).toMatchObject({ modelo: "GT128", categoria: "Tenis", unidades: 1, bruto: 239, costo: 60, ganancia: 90.65 });
    expect(f.ganancia).toBe(-25.35); // 150.65 − 60 − 116
    expect(f.cobertura.completa).toBe(true);
    expect(f.exacto).toBe(true);
    expect(f.avisos).toEqual([]);
  });

  it("los reembolsos van aparte y le restan al modelo; sin costo la ganancia es null y se declara", () => {
    const f = armarFinanzasAmazon(
      { desde: "2026-08-01", hasta: "2026-08-31" },
      [
        fila("GT135-DK-25-MX", "ShipmentEventList", { unidades: 2, principal: 400, impuesto_cobrado: 64, comision: -70, neto: 394 }),
        fila("GT135-DK-25-MX", "RefundEventList", { unidades: 1, principal: -200, impuesto_cobrado: -32, comision: 35, neto: -197 }),
      ],
      [],
      [grupoCerrado],
      new Map(),
    );
    expect(f.ventas.neto).toBe(394);
    expect(f.reembolsos).toMatchObject({ unidades: 1, neto: -197 });
    expect(f.netoProductos).toBe(197);
    expect(f.porModelo[0]).toMatchObject({ modelo: "GT135", reembolsos: -197, unidadesReembolsadas: 1, costo: null, ganancia: null });
    expect(f.ganancia).toBeNull();
    expect(f.exacto).toBe(false);
    expect(f.avisos.some((a) => a.includes("sin costo"))).toBe(true);
  });

  it("una liquidación abierta, una a medio leer o una que no cuadra hacen el periodo parcial y lo dicen", () => {
    const f = armarFinanzasAmazon(
      { desde: "2026-09-01", hasta: "2026-09-30" },
      [fila("GT128-24-BLK-MX", "ShipmentEventList", { unidades: 1, principal: 100, neto: 100 })],
      [{ lista: "MisteriosaEventList", eventos: 1, monto: null, base: null, impuesto: null, sin_clasificar: 1 }],
      [
        { ...grupoCerrado, grupo_id: "c", cuadra: false, suma_eventos: 900000 },
        { ...grupoCerrado, grupo_id: "m", completo: false, cuadra: null },
        { ...grupoCerrado, grupo_id: "a", estado: "Open", fin: null, total_original: null, completo: false, cuadra: null },
      ],
      new Map([["GT128", { categoria: null, costo: 1 }]]),
    );
    expect(f.cobertura).toMatchObject({ cerrados: 2, abiertos: 1, incompletos: 1, descuadrados: 1, completa: false });
    expect(f.exacto).toBe(false);
    expect(f.avisos.join(" ")).toMatch(/en curso/);
    expect(f.avisos.join(" ")).toMatch(/a medio leer/);
    expect(f.avisos.join(" ")).toMatch(/descuadra por/);
    expect(f.avisos.join(" ")).toMatch(/no sabe leer/);
  });
});
