/**
 * Regresión del amarre de variantes de pedido → catálogo de MELI y Amazon,
 * con los casos reales que fallaban: el color de proforma con anotación
 * ("BLK  (NEGRO)") y el SKU de Amazon con la talla antes del color.
 */
import { test, expect } from "vitest";
import { buscarAmazon, buscarVariante, claveOrdenada, indexarAmazon, indexarCatalogo, sinAnotacion } from "./resolver";
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

/**
 * Productos que SOLO están en Amazon (sin publicación en MELI): su FNSKU
 * tiene que salir aunque el SKU de Amazon traiga el sufijo capturado
 * distinto (-ME, -MEX) o el color pegado. Casos reales del inventario FBA.
 */
test("un SKU solo-de-Amazon amarra con -ME, -MEX y el color pegado", () => {
  const mapa = indexarAmazon([
    { sku: "GT190-BLK-23-ME", fnsku: "X00190A", titulo: null },
    { sku: "GT144-BLK-26-MEX", fnsku: "X00144A", titulo: null },
    { sku: "GT108-MILITARY GREEN-25-MX", fnsku: "X00108A", titulo: null },
    { sku: "GT210-BLK-25-MX", fnsku: "X00210A", titulo: null },
    { sku: "GT117-25-BROWN-MX", fnsku: "X00117A", titulo: null },
  ]);
  expect(buscarAmazon(mapa, "GT190-BLK-23")?.fnsku).toBe("X00190A");
  expect(buscarAmazon(mapa, "GT190-BLK-23-MX")?.fnsku).toBe("X00190A");
  expect(buscarAmazon(mapa, "GT144-BLK-26-MX")?.fnsku).toBe("X00144A");
  expect(buscarAmazon(mapa, "GT108-MILITARYGREEN-25")?.fnsku).toBe("X00108A");
  expect(buscarAmazon(mapa, "GT210-BLK-25")?.sku).toBe("GT210-BLK-25-MX");
  expect(buscarAmazon(mapa, "GT117-BROWN-25-MX")?.fnsku).toBe("X00117A");
  expect(buscarAmazon(mapa, "GT999-BLK-25")).toBeNull();
});

test("el título viene del catálogo aunque el FNSKU venga del inventario", () => {
  const mapa = indexarAmazon([
    // Orden de mapaAmazon: catálogo (sin FNSKU), inventario (sin título), vendidos.
    { sku: "GT210-BLK-25-MX", fnsku: null, titulo: "Bota GT210 negra" },
    { sku: "GT210-BLK-25-MX", fnsku: "X00210A", titulo: null },
    { sku: "GT211-BLK-25-MX", fnsku: "X00211A", titulo: null },
  ]);
  expect(buscarAmazon(mapa, "GT210-BLK-25")).toEqual({
    fnsku: "X00210A",
    sku: "GT210-BLK-25-MX",
    titulo: "Bota GT210 negra",
  });
  // Un SKU sin FNSKU en ninguna tabla no entra: sin código no hay etiqueta.
  expect(buscarAmazon(mapa, "GT211-BLK-25")?.titulo).toBeNull();
  expect(buscarAmazon(mapa, "GT212-BLK-25")).toBeNull();
});
