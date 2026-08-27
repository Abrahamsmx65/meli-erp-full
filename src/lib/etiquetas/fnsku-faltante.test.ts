/**
 * Regresión del caso real: SKUs de Amazon que la pantalla de etiquetas daba
 * por inexistentes.
 *
 * `456-A06`, `657-A11-blk`, `748-S26ultra` y compañía SÍ están dados de alta
 * en Amazon (con su ASIN, canal AMAZON_NA), pero su listing está Inactive:
 * agotados en FBA. El reporte `GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA` solo
 * trae los listings vivos, así que su FNSKU no estaba en ninguna tabla — y el
 * mapa descartaba toda fila sin FNSKU, de modo que la pantalla contestaba
 * "no está ni en el catálogo de Mercado Libre ni en el de Amazon". Mentira
 * que mandaba a buscar el SKU al lugar equivocado.
 */
import { test, expect } from "vitest";
import {
  buscarAmazon,
  construirMapaAmazon,
  problemaAmazon,
  type FilaAmazon,
} from "./resolver";

/** Como está la base: el que tiene existencias en FBA trae FNSKU, el otro no. */
const INVENTARIO: FilaAmazon[] = [
  { seller_sku: "14009-iPad10-pink", fnsku: "X0049SEQS7" },
];

const CATALOGO: FilaAmazon[] = [
  { seller_sku: "14009-iPad10-pink", fnsku: null, titulo: "YAPANIZCEL Funda iPad 10" },
  { seller_sku: "456-A06", fnsku: null, titulo: null },
  { seller_sku: "657-A11-blk", fnsku: null, titulo: null },
  { seller_sku: "748-S26ultra", fnsku: null, titulo: null },
];

test("un SKU de Amazon sin FNSKU sigue estando en el mapa", () => {
  const mapa = construirMapaAmazon(INVENTARIO, CATALOGO);

  const dato = buscarAmazon(mapa, "456-A06");
  expect(dato).not.toBeNull();
  expect(dato?.sku).toBe("456-A06");
  expect(dato?.fnsku).toBeNull();

  // Se escribió en otra caja de letras, como en la pantalla.
  expect(buscarAmazon(mapa, "657-A11-BLK")?.sku).toBe("657-A11-blk");
  expect(buscarAmazon(mapa, "748-S26ULTRA")?.sku).toBe("748-S26ultra");
});

test("la fila del catálogo sin FNSKU no pisa la del inventario que sí lo trae", () => {
  const mapa = construirMapaAmazon(INVENTARIO, CATALOGO);
  const dato = buscarAmazon(mapa, "14009-IPAD10-PINK");
  expect(dato?.fnsku).toBe("X0049SEQS7");
  expect(dato?.titulo).toBe("YAPANIZCEL Funda iPad 10");
});

test("el catálogo con FNSKU rescata a un SKU que el inventario no alcanzó", () => {
  // Es lo que deja la consulta al API de inventario: el FNSKU se guarda en
  // `amazon_skus`, sin que el SKU aparezca nunca en `amazon_inventario`.
  const mapa = construirMapaAmazon(INVENTARIO, [
    ...CATALOGO,
    { seller_sku: "456-A06", fnsku: "X004ABCDEF", titulo: null },
  ]);
  expect(buscarAmazon(mapa, "456-A06")?.fnsku).toBe("X004ABCDEF");
});

test("el problema distingue los tres casos", () => {
  const mapa = construirMapaAmazon(INVENTARIO, CATALOGO);

  // Está en Amazon y se puede imprimir.
  expect(problemaAmazon(buscarAmazon(mapa, "14009-iPad10-pink"))).toBeNull();

  // Está en Amazon pero le falta el FNSKU: eso sí se va a buscar al API.
  expect(problemaAmazon(buscarAmazon(mapa, "456-A06"))).toContain("FNSKU");

  // No está en ningún lado.
  expect(problemaAmazon(buscarAmazon(mapa, "NO-EXISTE-99"))).toContain(
    "ni en el catálogo de Mercado Libre",
  );
});
