import { describe, expect, it } from "vitest";
import {
  enCaminoDesdePendientes,
  envioDeBloque,
  skuMeliDeFila,
  type PendientesIndusther,
} from "./industher-pendientes";
import { indexarCatalogo } from "../etiquetas/resolver";

// Un envío como lo publica el bloque `pendingShipments` del API del almacén
// (mismo idioma que el inventario: warehouse, model, size, boxes, pairs).
const envioApi = {
  reference: "7001234",
  warehouse: { code: "IND", name: "Industher" },
  destination: "MELI Full",
  date: "2026-08-23",
  totalBoxes: 85,
  totalPairs: 2040,
  products: [
    { sku: "GT125 BLK 23", model: "GT125", color: "BLK", size: "23", container: "C1", boxes: 40, pairs: 960 },
    { sku: "GT125 BLK 24", model: "GT125", color: "BLK", size: "24", container: "C1", boxes: 45, pairs: 1080 },
  ],
};

describe("envíos pendientes del bloque pendingShipments", () => {
  it("normaliza referencia, destino, totales y productos", () => {
    const e = envioDeBloque(envioApi)!;
    expect(e.id).toBe("7001234");
    expect(e.esMeli).toBe(true);
    expect(e.destino).toBe("MELI Full");
    expect(e.fecha).toBe("2026-08-23");
    expect(e.cajas).toBe(85);
    expect(e.pares).toBe(2040);
    expect(e.filas).toHaveLength(2);
    expect(e.filas[0]).toEqual({
      sku: "GT125 BLK 23",
      modelo: "GT125",
      color: "BLK",
      talla: "23",
      cantidad: 960,
    });
  });

  it("un envío que no empieza con 7 u 8 no es de MELI", () => {
    const e = envioDeBloque({ ...envioApi, reference: "5000123" })!;
    expect(e.esMeli).toBe(false);
  });

  it("sin totales al nivel del envío, se suman los productos", () => {
    const { totalBoxes, totalPairs, ...resto } = envioApi;
    void totalBoxes;
    void totalPairs;
    const e = envioDeBloque(resto)!;
    expect(e.cajas).toBe(85);
    expect(e.pares).toBe(2040);
  });

  it("sin referencia no hay envío (no se inventa un ID)", () => {
    expect(envioDeBloque({ destination: "X", products: [] })).toBeNull();
  });
});

describe("amarre de los productos pendientes al SKU de MELI", () => {
  const indice = indexarCatalogo([{ sku: "GT125-BLK-23" }, { sku: "GT125-BLK-24" }]);

  it("el SKU de bodega (con espacios) amarra por modelo+color+talla", () => {
    const e = envioDeBloque(envioApi)!;
    expect(skuMeliDeFila(e.filas[0], indice)).toBe("GT125-BLK-23");
  });

  it("el en-camino a Full sale por SKU de MELI y respeta tachados y no-MELI", () => {
    const meli = envioDeBloque(envioApi)!;
    const amazon = envioDeBloque({ ...envioApi, reference: "5000123" })!;
    const tachado = { ...envioDeBloque({ ...envioApi, reference: "8000001" })!, omitido: true };

    const p: PendientesIndusther = { envios: [meli, amazon, tachado], error: null };
    const porSku = enCaminoDesdePendientes(p, indice);

    expect(porSku.get("GT125-BLK-23")).toBe(960);
    expect(porSku.get("GT125-BLK-24")).toBe(1080);
    // Solo el envío 7001234: ni el 5… (no es MELI) ni el 8… (tachado).
    expect([...porSku.values()].reduce((a, b) => a + b, 0)).toBe(2040);
  });
});
