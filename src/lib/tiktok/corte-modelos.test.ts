import { describe, expect, it } from "vitest";
import { etiquetaDeModelos, mismoFiltro, modelosDelPedido, normalizarModelos, pedidosDeSoloModelos, pendientesPorModelo } from "./corte-modelos";

const renglones = new Map([
  ["a", [{ sku: "GT148-CREAM-24-MX", cantidad: 1 }]],
  ["b", [{ sku: "GT148-BLK-25-MX", cantidad: 2 }, { sku: "GT148-CREAM-23-MX", cantidad: 1 }]],
  ["c", [{ sku: "GT148-BLK-25-MX", cantidad: 1 }, { sku: "GT114-BEIGE-24-MX", cantidad: 1 }]],
  ["d", [{ sku: "GT114-BEIGE-24-MX", cantidad: 1 }]],
  ["e", [{ sku: "(sin SKU)", cantidad: 1 }]],
  ["f", [{ sku: "GT148-BLK-25-MX", cantidad: 1 }, { sku: "(sin SKU)", cantidad: 1 }]],
]);

describe("corte por modelo", () => {
  it("entra solo lo que es de UN modelo del filtro; los revueltos se quedan para el general", () => {
    expect([...pedidosDeSoloModelos(renglones, ["gt148"])]).toEqual(["a", "b"]);
    expect([...pedidosDeSoloModelos(renglones, ["GT148", "GT114"])]).toEqual(["a", "b", "d"]);
    // Sin filtro entran todos.
    expect(pedidosDeSoloModelos(renglones, []).size).toBe(6);
  });

  it("resume los pendientes por modelo para el selector", () => {
    const r = pendientesPorModelo(renglones);
    expect(r.modelos).toEqual([
      { modelo: "GT148", pedidos: 2, pares: 4 },
      { modelo: "GT114", pedidos: 1, pares: 1 },
    ]);
    expect(r.revueltos).toEqual({ pedidos: 2, pares: 4 });
    expect(r.sinSku).toBe(1);
  });

  it("saca los modelos de un pedido y normaliza el filtro", () => {
    expect(modelosDelPedido([{ sku: "GT135-DK BROWN-26", cantidad: 1 }, { sku: "gt135-blk-24-mx", cantidad: 1 }])).toEqual(["GT135"]);
    expect(normalizarModelos([" gt148 ", "GT114", "gt148", "", "mal valor!"])).toEqual(["GT114", "GT148"]);
    expect(normalizarModelos("GT148")).toEqual([]);
  });

  it("nombra el filtro y compara dos filtros", () => {
    expect(etiquetaDeModelos(["GT148"])).toBe("solo GT148");
    expect(etiquetaDeModelos(["GT148", "GT114"])).toBe("solo GT114 y GT148");
    expect(etiquetaDeModelos([])).toBeNull();
    expect(etiquetaDeModelos(null)).toBeNull();
    expect(mismoFiltro(["GT148"], ["gt148"])).toBe(true);
    expect(mismoFiltro(null, [])).toBe(true);
    expect(mismoFiltro(["GT148"], null)).toBe(false);
    expect(mismoFiltro(["GT148"], ["GT148", "GT114"])).toBe(false);
  });
});
