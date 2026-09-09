import { describe, expect, it } from "vitest";
import { huellaPublicaciones, tocaRevisar, type FotosGuardada } from "./productos-nuevos-fotos";

const producto = {
  meli: { publicaciones: [{ sku: "GT190-BLK-25", itemId: "MLM1", variationId: "9" }] },
  amazon: { skus: ["GT190-BLK-25"], asins: ["B0A"] },
};
const guardada = (extra: Partial<FotosGuardada>): FotosGuardada => ({
  clave: "GT190|BLK",
  meli: { fotos: 6, itemId: "MLM1", estado: "active" },
  amazon: { fotos: 7, asin: "B0A" },
  revisadoEn: "2026-09-09T00:00:00Z",
  huella: huellaPublicaciones(producto),
  ...extra,
});

describe("qué productos nuevos se vuelven a revisar", () => {
  it("con fotos completas y sin cambios, se sirve lo guardado", () => {
    expect(tocaRevisar(producto, guardada({}), true, false)).toBe(false);
  });
  it("nunca revisado, fallido (sin fecha) o con 'todo' se pregunta", () => {
    expect(tocaRevisar(producto, undefined, true, false)).toBe(true);
    expect(tocaRevisar(producto, guardada({ revisadoEn: null }), true, false)).toBe(true);
    expect(tocaRevisar(producto, guardada({}), true, true)).toBe(true);
  });
  it("le faltan fotos en MELI o en Amazon → se pregunta; Amazon solo si está conectado", () => {
    expect(tocaRevisar(producto, guardada({ meli: { fotos: 1, itemId: "MLM1", estado: "active" } }), true, false)).toBe(true);
    expect(tocaRevisar(producto, guardada({ amazon: { fotos: 0, asin: "B0A" } }), true, false)).toBe(true);
    expect(tocaRevisar(producto, guardada({ amazon: { fotos: 0, asin: "B0A" } }), false, false)).toBe(false);
  });
  it("cambió lo publicado (color nuevo, ASIN nuevo) → se pregunta", () => {
    const conAsinNuevo = { ...producto, amazon: { skus: producto.amazon.skus, asins: ["B0A", "B0B"] } };
    expect(tocaRevisar(conAsinNuevo, guardada({}), true, false)).toBe(true);
  });
});
