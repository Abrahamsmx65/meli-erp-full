import { describe, expect, it } from "vitest";
import { paquetesQueViajan } from "./despacho";

describe("paquetesQueViajan", () => {
  it("un pedido de un solo paquete no se toca aunque no se sepa qué lleva", () => {
    const p = [{ id: "A", lineIds: [] }];
    expect(paquetesQueViajan(p, ["1"])).toEqual(p);
  });

  it("deja fuera el paquete cuyos renglones están todos cancelados", () => {
    const p = [
      { id: "muerto", lineIds: ["cream"] },
      { id: "vivo", lineIds: ["blk", "brown"] },
    ];
    expect(paquetesQueViajan(p, ["blk", "brown"]).map((x) => x.id)).toEqual(["vivo"]);
  });

  it("un paquete del que TikTok no dice qué lleva sí viaja", () => {
    const p = [
      { id: "muerto", lineIds: ["cream"] },
      { id: "sinDatos", lineIds: [] },
    ];
    expect(paquetesQueViajan(p, ["blk"]).map((x) => x.id)).toEqual(["sinDatos"]);
  });

  it("si la regla dejara el pedido sin paquetes, se quedan todos", () => {
    const p = [
      { id: "a", lineIds: ["x"] },
      { id: "b", lineIds: ["y"] },
    ];
    expect(paquetesQueViajan(p, ["z"])).toEqual(p);
  });

  it("compara los ids como texto aunque lleguen como número", () => {
    const p = [
      { id: "a", lineIds: ["101"] },
      { id: "b", lineIds: ["202"] },
    ];
    expect(paquetesQueViajan(p, [202 as unknown as string]).map((x) => x.id)).toEqual(["b"]);
  });
});
