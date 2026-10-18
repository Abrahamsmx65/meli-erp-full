import { describe, expect, it } from "vitest";
import { marcarEditados, mezclarConSheet, type ValoresNumeros } from "./numeros-sheet";

const base: ValoresNumeros = {
  envio_meli: 76,
  precio_relampago: 199.99,
  pv_normal: null,
  retencion: false,
  envio_amazon: 80,
  pvp_deal: null,
  tiktok_extra: 8,
  tiktok_comision: 0.24,
  tiktok_oferta: 1.11,
};

describe("Números: el último cambio manda", () => {
  it("un precio cambiado en el ERP no lo pisa el sheet si el sheet no cambió", () => {
    const erp = { ...base, precio_relampago: 189.99 };
    const editados = marcarEditados(erp, { valores: base, editados: [], sheet: { ...base } });
    expect(editados).toEqual(["precio_relampago"]);
    const r = mezclarConSheet(base, { valores: erp, editados, sheet: { ...base } });
    expect(r.valores.precio_relampago).toBe(189.99);
    expect(r.editados).toEqual(["precio_relampago"]);
    expect(r.respetados).toEqual(["precio_relampago"]);
    expect(r.valores.envio_meli).toBe(76);
  });

  it("si después lo cambia en el sheet, manda el sheet y se quita la marca", () => {
    const erp = { ...base, precio_relampago: 189.99 };
    const sheetNuevo = { ...base, precio_relampago: 209.99 };
    const r = mezclarConSheet(sheetNuevo, { valores: erp, editados: ["precio_relampago"], sheet: { ...base } });
    expect(r.valores.precio_relampago).toBe(209.99);
    expect(r.editados).toEqual([]);
  });

  it("sin lectura anterior del sheet, lo editado en el ERP manda", () => {
    const erp = { ...base, pv_normal: 249.99 };
    const r = mezclarConSheet(base, { valores: erp, editados: ["pv_normal"], sheet: null });
    expect(r.valores.pv_normal).toBe(249.99);
  });

  it("dejarlo igual que el sheet quita la marca; un modelo nuevo marca lo capturado", () => {
    const previo = { valores: { ...base, precio_relampago: 189.99 }, editados: ["precio_relampago"], sheet: { ...base } };
    expect(marcarEditados(base, previo)).toEqual([]);
    expect(marcarEditados(base, null)).toHaveLength(9);
  });

  it("números como texto de la base comparan igual", () => {
    const r = mezclarConSheet(base, { valores: { ...base, precio_relampago: "189.99" as any }, editados: ["precio_relampago"], sheet: { ...base, precio_relampago: "199.99" as any } });
    expect(r.valores.precio_relampago).toBe("189.99");
  });
});
