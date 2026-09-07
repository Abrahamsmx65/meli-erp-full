import { describe, expect, it } from "vitest";
import { agruparProductosDePedidos, claveProducto, claveProductoDeSku } from "./productos-nuevos";

describe("claveProductoDeSku", () => {
  it("quita talla y sufijo de sitio, y aplasta el color", () => {
    expect(claveProductoDeSku("GT110-NAVY-26-MX")).toBe("GT110|NAVY");
    expect(claveProductoDeSku("GT110-MILITARY GREEN-26")).toBe("GT110|MILITARYGREEN");
    expect(claveProductoDeSku("GT110-MILITARYGREEN")).toBe("GT110|MILITARYGREEN");
  });

  it("no se traga el guion del modelo", () => {
    expect(claveProductoDeSku("GT104-1-BLK-25")).toBe("GT104|1BLK");
    expect(claveProducto("GT104-1", "BLK")).toBe("GT104-1|BLK");
    // Los dos lados pasan por la misma regla, así que empatan igual.
    expect(claveProductoDeSku("GT104-1-BLK-25")).toBe(claveProductoDeSku("GT104-1-BLK"));
  });

  it("acepta la talla antes del color, como en Amazon", () => {
    expect(claveProductoDeSku("GT128-23-BLK-MX")).toBe("GT128|BLK");
    expect(claveProductoDeSku("GT128-BLK-23")).toBe("GT128|BLK");
  });

  it("traduce BLACK a BLK como el resto del ERP", () => {
    expect(claveProductoDeSku("GT221-BLACK-24")).toBe("GT221|BLK");
  });

  it("rechaza lo que no tiene forma de SKU", () => {
    expect(claveProductoDeSku("GT221")).toBeNull();
    expect(claveProductoDeSku("")).toBeNull();
  });
});

describe("agruparProductosDePedidos", () => {
  it("junta los renglones del mismo producto de varios pedidos", () => {
    const m = agruparProductosDePedidos(
      [
        { id: "a", pedido: "IN10079", estado: "en_transito", actualizado_en: null },
        { id: "b", pedido: "IN10136", estado: "creado", actualizado_en: null },
      ],
      [
        { pedido_id: "a", modelo: "GT221", color: "M Brown", cajas: 40, pares: 960 },
        { pedido_id: "b", modelo: "GT221", color: "MBROWN", cajas: 10, pares: 240 },
        { pedido_id: "b", modelo: "GT221", color: "Tan", cajas: 5, pares: 120 },
      ],
    );
    expect([...m.keys()]).toEqual(["GT221|MBROWN", "GT221|TAN"]);
    const mb = m.get("GT221|MBROWN")!;
    expect(mb.cajas).toBe(50);
    expect(mb.pares).toBe(1200);
    expect(mb.pedidos.map((p) => p.pedido)).toEqual(["IN10079", "IN10136"]);
  });
});
