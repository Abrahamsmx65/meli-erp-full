import { describe, expect, it } from "vitest";
import { armarResumenModelos, modeloDeSku, nombreEstadoTikTok } from "./resumen-modelos";

describe("armarResumenModelos", () => {
  it("junta por modelo el catálogo de TikTok, el kardex, las bodegas y las ventas de MELI", () => {
    const r = armarResumenModelos({
      tiktok: [
        { sku: "GT142-CREAM-24-MX", productId: "111", estado: "ACTIVATE", titulo: "Sandalia GT142" },
        { sku: "GT142-CREAM-25-MX", productId: "111", estado: "ACTIVATE" },
        { sku: "GT142-BLK-24-MX", productId: "222", estado: "DRAFT" },
        { sku: "GT100-MINT-24-MX", productId: "333", estado: "SELLER_DEACTIVATED" },
      ],
      kardex: [
        { sku: "GT142-CREAM-24-MX", saldo: 10, apartado: 3 },
        { sku: "GT142-CREAM-25-MX", saldo: 5, apartado: 0 },
      ],
      existencias: [
        { almacen: "EnvioPack", modelo: "GT142", pares: 480 },
        { almacen: "Industher", modelo: "gt142 ", pares: 120 },
        { almacen: "Naucalpan", modelo: "GT999", pares: 12 },
      ],
      ventasMeli: [
        { sku: "GT142-CREAM-24-MX", unidades: 100, ordenes: 90, unidades30: 10 },
        { sku: "GT142-BLK-26-MX", unidades: 50, ordenes: 50, unidades30: 0 },
        { sku: "GT777-BLK-26-MX", unidades: 999, ordenes: 999, unidades30: 9 },
      ],
      categorias: new Map([["GT142", "EVA"]]),
      fotos: new Map([["GT142", "https://foto/gt142.jpg"]]),
    });

    expect(r.almacenes).toEqual(["Industher", "EnvioPack", "Naucalpan"]);
    expect(r.renglones.map((x) => x.modelo)).toEqual(["GT100", "GT142", "GT999"]);

    const gt142 = r.renglones[1];
    expect(gt142.productos).toEqual([
      { productId: "111", estado: "ACTIVATE", skus: 2 },
      { productId: "222", estado: "DRAFT", skus: 1 },
    ]);
    expect(gt142.saldoTikTok).toBe(15);
    expect(gt142.apartadoTikTok).toBe(3);
    expect(gt142.disponibleTikTok).toBe(12);
    expect(gt142.porBodega).toEqual({ EnvioPack: 480, Industher: 120 });
    expect(gt142.totalBodegas).toBe(600);
    expect(gt142.ventasMeli).toBe(150);
    expect(gt142.ordenesMeli).toBe(140);
    expect(gt142.ventasMeli30).toBe(10);
    expect(gt142.categoria).toBe("EVA");
    expect(gt142.foto).toBe("https://foto/gt142.jpg");
    expect(gt142.titulo).toBe("Sandalia GT142");

    // Un modelo que solo vendió en MELI (GT777) no abre renglón.
    expect(r.renglones.find((x) => x.modelo === "GT777")).toBeUndefined();
    // Sin kardex, el disponible es cero y no negativo.
    expect(r.renglones[0].disponibleTikTok).toBe(0);
  });

  it("saca el modelo del SKU y nombra los estados", () => {
    expect(modeloDeSku("GT135-DK BROWN-26")).toBe("GT135");
    expect(modeloDeSku("my2304-purple-23-mx")).toBe("MY2304");
    expect(nombreEstadoTikTok("ACTIVATE")).toBe("Activo");
    expect(nombreEstadoTikTok("RARO")).toBe("RARO");
    expect(nombreEstadoTikTok(null)).toBe("");
  });
});
