import { describe, expect, it } from "vitest";
import { sugerirRenglon, type RenglonParaSugerir } from "./packing-sugerencias";

const r = (x: Partial<RenglonParaSugerir> & { color: string }): RenglonParaSugerir => ({
  pedidoLineaId: x.pedidoLineaId ?? x.color,
  pedido: x.pedido ?? "IN10079",
  modelo: x.modelo ?? "GT219",
  color: x.color,
  talla: x.talla ?? null,
  libres: x.libres ?? 40,
  enEste: x.enEste ?? 0,
});

describe("sugerirRenglon: el color que la fábrica escribió distinto", () => {
  it("por eliminación: ya entraron dos colores y solo queda uno", () => {
    const s = sugerirRenglon(
      { modelo: "GT219", color: "MEDIUM BROWN", talla: null, cajas: 40, pedido: "IN10079" },
      [
        r({ color: "BLK", libres: 0, enEste: 40 }),
        r({ color: "CREAM", libres: 0, enEste: 40 }),
        r({ color: "M BROWN", libres: 40, enEste: 0 }),
      ],
    );
    expect(s.confianza).toBe("eliminacion");
    expect(s.renglon?.color).toBe("M BROWN");
    expect(s.porQue).toContain("ya entraron BLK y CREAM");
    expect(s.porQue).toContain("son las mismas 40 cajas");
  });

  it("solo cuenta el pedido que dijo el packing list si ese pedido tiene el modelo", () => {
    const s = sugerirRenglon(
      { modelo: "GT219", color: "MEDIUM BROWN", talla: null, cajas: 40, pedido: "IN10136" },
      [r({ color: "M BROWN", pedido: "IN10079" }), r({ color: "TAN", pedido: "IN10136" })],
    );
    expect(s.renglon?.pedido).toBe("IN10136");
    expect(s.renglon?.color).toBe("TAN");
  });

  it("con dos colores sin entrar no elimina: se parece por palabra", () => {
    const s = sugerirRenglon(
      { modelo: "GT219", color: "MEDIUM BROWN", talla: null, cajas: 40 },
      [r({ color: "LT BROWN" }), r({ color: "TAN" })],
    );
    expect(s.confianza).toBe("parecido");
    expect(s.renglon?.color).toBe("LT BROWN");
    expect(s.otras.map((x) => x.color)).toEqual(["TAN"]);
  });

  it("los sinónimos cuentan como la misma palabra (BLACK = BLK)", () => {
    const s = sugerirRenglon(
      { modelo: "GT219", color: "BLACK", talla: null, cajas: 40 },
      [r({ color: "BLK" }), r({ color: "TAN" })],
    );
    expect(s.confianza).toBe("parecido");
    expect(s.renglon?.color).toBe("BLK");
  });

  it("sin parecido ni eliminación, no adivina y deja elegir", () => {
    const s = sugerirRenglon(
      { modelo: "GT219", color: "TOFFEE", talla: null, cajas: 40 },
      [r({ color: "BLK" }), r({ color: "TAN" })],
    );
    expect(s.confianza).toBe("ninguna");
    expect(s.renglon).toBeNull();
    expect(s.otras).toHaveLength(2);
  });

  it("una caja unitalla prefiere el renglón de su talla y luego la corrida", () => {
    const s = sugerirRenglon(
      { modelo: "GT148", color: "BLACK", talla: "24", cajas: 10 },
      [r({ modelo: "GT148", color: "BLK", talla: null, pedidoLineaId: "corrida" }), r({ modelo: "GT148", color: "BLK", talla: "24", pedidoLineaId: "t24" })],
    );
    expect(s.renglon?.pedidoLineaId).toBe("t24");
  });

  it("sin cajas libres del modelo no hay nada que sugerir", () => {
    const s = sugerirRenglon({ modelo: "GT999", color: "BLK", talla: null, cajas: 1 }, [r({ color: "BLK" })]);
    expect(s.confianza).toBe("ninguna");
    expect(s.otras).toHaveLength(0);
  });
});
