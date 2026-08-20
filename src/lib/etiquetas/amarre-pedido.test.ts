/**
 * Regresión del amarre de variantes de pedido → catálogo de MELI y Amazon,
 * con los casos reales que fallaban: el color de proforma con anotación
 * ("BLK  (NEGRO)") y el SKU de Amazon con la talla antes del color.
 */
import { test, expect } from "vitest";
import { buscarAmazon, buscarVariante, claveOrdenada, indexarCatalogo, sinAnotacion } from "./resolver";
import type { DatoAmazon } from "./resolver";

const CATALOGO = [
  { sku: "GT128-BLK-23-MX", inventory_id: "AGOK46547" },
  { sku: "GT128-BROWN-23-MX", inventory_id: "XHBZ44993" },
  { sku: "GT144-BLK-23-MX", inventory_id: "ZOFN46114" },
  { sku: "GT125-BLK/BROWN-25-MX", inventory_id: "KNCG12580" },
];

test("el color con anotación (NEGRO) amarra igual", () => {
  const ix = indexarCatalogo(CATALOGO);
  const conAnotacion = buscarVariante(ix, "GT128", "BLK  (NEGRO)", "23");
  expect(conAnotacion.encontrado?.inventory_id).toBe("AGOK46547");

  const simple = buscarVariante(ix, "GT144", "BLK", "23");
  expect(simple.encontrado?.inventory_id).toBe("ZOFN46114");

  const conDiagonal = buscarVariante(ix, "GT125", "BLK/BROWN", "25");
  expect(conDiagonal.encontrado?.inventory_id).toBe("KNCG12580");

  const noExiste = buscarVariante(ix, "GT128", "VERDE", "23");
  expect(noExiste.encontrado).toBeNull();
  expect(noExiste.construido).toBe("GT128-VERDE-23");
});

test("el SKU de Amazon con la talla antes del color amarra por clave ordenada", () => {
  const mapa = new Map<string, DatoAmazon>();
  const dato = { fnsku: "X004HFF75N", sku: "GT128-23-BLK-MX", titulo: null };
  mapa.set(claveOrdenada("GT128-23-BLK-MX"), dato);
  expect(buscarAmazon(mapa, "GT128-BLK-23-MX")?.fnsku).toBe("X004HFF75N");
});

test("sinAnotacion limpia el paréntesis y respeta lo demás", () => {
  expect(sinAnotacion("BLK  (NEGRO)")).toBe("BLK");
  expect(sinAnotacion("BLK/BROWN")).toBe("BLK/BROWN");
  expect(sinAnotacion("(X)")).toBe("(X)");
});
