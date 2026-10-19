import { describe, expect, it } from "vitest";
import { cuerpoParaAceptar, decidirOferta, ordenarOfertas } from "./ofertas-aporte";

const smart = { id: "P-1", type: "SMART", name: "Co-fondeada", status: "started" };
const item = (x: Record<string, unknown> = {}) => ({ id: "MLM1", status: "candidate", offer_id: "OF-1", price: 250, original_price: 300, meli_percentage: 10, ...x });

describe("ofertas con aporte de MELI", () => {
  it("precio + aporte ≥ PV normal: se acepta", () => {
    const r = decidirOferta(item(), smart, "GT148", { pvNormal: 279.99, envio: 70 });
    expect(r.aporte).toBe(30);
    expect(r.efectivo).toBe(280);
    expect(r.decision).toBe("aceptar");
    expect(cuerpoParaAceptar(r)).toEqual({ promotion_id: "P-1", promotion_type: "SMART", offer_id: "OF-1" });
  });

  it("abajo del PV normal: no cumple", () => {
    const r = decidirOferta(item({ price: 230 }), smart, "GT148", { pvNormal: 279.99, envio: 70 });
    expect(r.decision).toBe("no_cumple");
    expect(r.motivo).toContain("PV normal");
  });

  it("si el aporte cruza los $299 se resta el envío y solo se acepta si aun así cumple", () => {
    // 280 + 30 = 310 cruza; − 70 de envío = 240 < 279.99
    const no = decidirOferta(item({ price: 280 }), smart, "GT148", { pvNormal: 279.99, envio: 70 });
    expect(no.envioExtra).toBe(70);
    expect(no.decision).toBe("no_cumple");
    // con 15 de envío: 295 ≥ 279.99
    const si = decidirOferta(item({ price: 280 }), smart, "GT148", { pvNormal: 279.99, envio: 15 });
    expect(si.decision).toBe("aceptar");
  });

  it("con PV normal en $299 o más el envío no se resta otra vez", () => {
    const r = decidirOferta(item({ price: 290, original_price: 400 }), smart, "GT150", { pvNormal: 329.99, envio: 70 });
    expect(r.envioExtra).toBe(0);
    expect(r.efectivo).toBe(330);
    expect(r.decision).toBe("aceptar");
  });

  it("el aporte sale del % de la promoción si el renglón no lo trae (campaña)", () => {
    const camp = { id: "C-1", type: "MARKETPLACE_CAMPAIGN", name: "Hot Sale calzado", benefits: { meli_percent: 5, seller_percent: 10 } };
    const r = decidirOferta(item({ meli_percentage: null, offer_id: null, price: 255, original_price: 300 }), camp, "GT148", { pvNormal: 269.99, envio: 70 });
    expect(r.aporte).toBe(15);
    expect(r.decision).toBe("aceptar");
    expect(cuerpoParaAceptar(r)).toEqual({ promotion_id: "C-1", promotion_type: "MARKETPLACE_CAMPAIGN" });
  });

  it("sin datos o sin precio en Números no se acepta nada", () => {
    expect(decidirOferta(item({ meli_percentage: null }), smart, "GT148", { pvNormal: 200, envio: 0 }).decision).toBe("sin_datos");
    expect(decidirOferta(item({ offer_id: null }), smart, "GT148", { pvNormal: 200, envio: 0 }).decision).toBe("sin_datos");
    expect(decidirOferta(item(), smart, null, null).decision).toBe("sin_datos");
    expect(decidirOferta(item(), smart, "GT148", { pvNormal: null, envio: 0 }).decision).toBe("sin_precio");
  });

  it("con aporte 0 % (Acelera tus ventas de Full, 19-oct-2026) va a «sin aporte»", () => {
    const full = { id: "P-MLM17023038", type: "UNHEALTHY_STOCK", name: "Acelera tus ventas de Full" };
    const r = decidirOferta(
      item({ price: 199.6, original_price: 499, meli_percentage: 0, seller_percentage: 60, offer_id: "CANDIDATE-MLM1-1" }),
      full,
      "GT148",
      { pvNormal: 189.99, envio: 0 },
    );
    expect(r.decision).toBe("sin_aporte");
    expect(r.motivo).toContain("60 %");
  });

  it("relámpago, Buen Fin y lo ya inscrito no se tocan aquí", () => {
    expect(decidirOferta(item(), { id: "L", type: "LIGHTNING" }, "GT148", { pvNormal: 1, envio: 0 }).decision).toBe("no_es_de_aqui");
    expect(decidirOferta(item(), { id: "B", type: "MARKETPLACE_CAMPAIGN", name: "Buen Fin 26" }, "GT148", { pvNormal: 1, envio: 0 }).decision).toBe("no_es_de_aqui");
    expect(decidirOferta(item({ status: "started" }), smart, "GT148", { pvNormal: 1, envio: 0 }).decision).toBe("aceptada");
  });

  it("las que se aceptan van primero", () => {
    const a = decidirOferta(item({ price: 100 }), smart, "GT1", { pvNormal: 279.99, envio: 0 });
    const b = decidirOferta(item(), smart, "GT2", { pvNormal: 279.99, envio: 0 });
    expect(ordenarOfertas([a, b]).map((r) => r.decision)).toEqual(["aceptar", "no_cumple"]);
  });
});
