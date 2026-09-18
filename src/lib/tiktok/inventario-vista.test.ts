import { describe, expect, it } from "vitest";
import { filtrarInventario, ordenarPorSku, totalesDeInventario } from "./inventario-vista";

const R = (sku: string, saldo = 1, apartado = 0, ventas30 = 0, titulo: string | null = null) => ({
  sku, titulo, saldo, apartado, disponible: Math.max(0, saldo - apartado), ventas30,
});

describe("ordenarPorSku", () => {
  it("alfabético con números naturales: modelo, color y talla en orden humano", () => {
    const orden = ordenarPorSku([R("GT134-BLK-9-MX"), R("GT134-BLK-24-MX"), R("GT102-GREY-25-MX"), R("gt134-BLK-10-MX"), R("MY2304-PURPLE-23")]);
    expect(orden.map((r) => r.sku)).toEqual(["GT102-GREY-25-MX", "GT134-BLK-9-MX", "gt134-BLK-10-MX", "GT134-BLK-24-MX", "MY2304-PURPLE-23"]);
  });
  it("no toca la lista original", () => {
    const lista = [R("B"), R("A")];
    ordenarPorSku(lista);
    expect(lista.map((r) => r.sku)).toEqual(["B", "A"]);
  });
});

describe("filtrarInventario", () => {
  const lista = [R("GT134-BLK-24-MX", 1, 0, 0, "Bota niño"), R("GT134-NAVY-RED-24-MX"), R("GT102-GREY-25-MX", 1, 0, 0, "Tenis")];
  it("sin búsqueda devuelve todo", () => {
    expect(filtrarInventario(lista, "  ")).toHaveLength(3);
  });
  it("busca por pedazos sin importar guiones ni mayúsculas", () => {
    expect(filtrarInventario(lista, "gt134 24").map((r) => r.sku)).toEqual(["GT134-BLK-24-MX", "GT134-NAVY-RED-24-MX"]);
    expect(filtrarInventario(lista, "navy-red").map((r) => r.sku)).toEqual(["GT134-NAVY-RED-24-MX"]);
    expect(filtrarInventario(lista, "GT134-BLK-24").map((r) => r.sku)).toEqual(["GT134-BLK-24-MX"]);
  });
  it("el título también cuenta, sin acentos", () => {
    expect(filtrarInventario(lista, "nino").map((r) => r.sku)).toEqual(["GT134-BLK-24-MX"]);
  });
  it("todos los pedazos tienen que estar", () => {
    expect(filtrarInventario(lista, "gt134 grey")).toHaveLength(0);
  });
});

describe("totalesDeInventario", () => {
  it("suma lo que se enseña", () => {
    expect(totalesDeInventario([R("A", 5, 2, 3), R("B", -1, 0, 1)])).toEqual({ skus: 2, saldo: 4, apartado: 2, disponible: 3, ventas30: 4 });
  });
  it("vacío en cero", () => {
    expect(totalesDeInventario([]).skus).toBe(0);
  });
});
