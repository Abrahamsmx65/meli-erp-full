import { describe, expect, it } from "vitest";
import { buscarVariante, indexarCatalogo, sinRenombrados } from "./resolver";

// GT331-BLK-25-MX se renombró en MELI a GT331-BLACK-25-MX (17-nov-2026):
// el renglón viejo quedó apagado y sin código Full.
const catalogo = [
  { sku: "GT331-BLK-25-MX", inventory_id: null, activo: false, item_id: "MLM1", variation_id: "9", color: "BLK", talla: "25" },
  { sku: "GT331-BLACK-25-MX", inventory_id: "EISQ67715", activo: true, item_id: "MLM1", variation_id: "9", color: "BLACK", talla: "25" },
  { sku: "GT999-RED-25-MX", inventory_id: null, activo: false, item_id: "MLM2", variation_id: "1", color: "RED", talla: "25" },
];

describe("SKUs renombrados en MELI", () => {
  it("quita el nombre viejo apagado cuando su variante tiene uno activo", () => {
    const r = sinRenombrados(catalogo).map((f) => f.sku);
    expect(r).toEqual(["GT331-BLACK-25-MX", "GT999-RED-25-MX"]);
  });

  it("la etiqueta del pedido (color BLK) toma el código Full del nombre nuevo", () => {
    const ix = indexarCatalogo(catalogo);
    const { encontrado } = buscarVariante(ix, "GT331", "BLK", "25");
    expect(encontrado?.inventory_id).toBe("EISQ67715");
  });
});
