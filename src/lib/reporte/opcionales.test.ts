import { describe, expect, it } from "vitest";
import { partirPorOpcionales } from "./opcionales";

describe("partirPorOpcionales", () => {
  it("divide un renglón mixto en envío normal y bloque opcional", () => {
    const caja = {
      codigo: "C1",
      cantidad: 5,
      paresPorCaja: 24,
      paresTotales: 120,
      cantidadOpcional: 2,
      aporta: [{ sku: "A", talla: "25", paresPorCaja: 12, paresTotales: 60 }],
    };
    const { normales, opcionales } = partirPorOpcionales([caja]);

    expect(normales).toHaveLength(1);
    expect(normales[0]).toMatchObject({ cantidad: 3, paresTotales: 72, cantidadOpcional: 0 });
    expect(normales[0].aporta[0].paresTotales).toBe(36);

    expect(opcionales).toHaveLength(1);
    expect(opcionales[0]).toMatchObject({ cantidad: 2, paresTotales: 48, cantidadOpcional: 2 });
    expect(opcionales[0].aporta[0].paresTotales).toBe(24);
  });

  it("una caja sin opcionales va completa al envío normal, y viceversa", () => {
    const base = { paresPorCaja: 12, aporta: [] as { paresPorCaja: number; paresTotales: number }[] };
    const { normales, opcionales } = partirPorOpcionales([
      { ...base, codigo: "N", cantidad: 4, paresTotales: 48, cantidadOpcional: 0 },
      { ...base, codigo: "O", cantidad: 3, paresTotales: 36, cantidadOpcional: 3 },
    ]);
    expect(normales.map((c: any) => c.codigo)).toEqual(["N"]);
    expect(opcionales.map((c: any) => c.codigo)).toEqual(["O"]);
  });
});
import { desglosarOpcionales, textoDeMas } from "./opcionales";

const caja = (
  codigo: string,
  cantidad: number,
  cantidadOpcional: number,
  aporta: { sku: string; talla: string; paresPorCaja: number }[],
) => ({
  codigo,
  cantidad,
  cantidadOpcional,
  paresPorCaja: aporta.reduce((a, x) => a + x.paresPorCaja, 0),
  aporta,
});

describe("desglose de cajas opcionales y sobrante por talla", () => {
  it("separa cajas y pares obligatorios de los opcionales", () => {
    const d = desglosarOpcionales(
      [
        caja("A", 5, 0, [{ sku: "GT1-BLK-24", talla: "24", paresPorCaja: 24 }]),
        caja("B", 3, 2, [{ sku: "GT1-BLK-25", talla: "25", paresPorCaja: 24 }]),
      ],
      [
        { sku: "GT1-BLK-24", sugerido: 120 },
        { sku: "GT1-BLK-25", sugerido: 72 },
      ],
    );
    expect(d.cajasObligatorias).toBe(6);
    expect(d.cajasOpcionales).toBe(2);
    expect(d.paresObligatorios).toBe(6 * 24);
    expect(d.paresOpcionales).toBe(2 * 24);
  });

  it("el sobrante global sale de enviado − sugerido, por talla", () => {
    // Caja mixta: la 24 va justa y la 25 sobra completa (nadie la pidió).
    const d = desglosarOpcionales(
      [
        caja("MIX", 2, 0, [
          { sku: "GT1-BLK-24", talla: "24", paresPorCaja: 12 },
          { sku: "GT1-BLK-25", talla: "25", paresPorCaja: 12 },
        ]),
      ],
      [{ sku: "GT1-BLK-24", sugerido: 24 }],
    );
    expect(d.totalDeMas).toBe(24);
    expect(d.deMasPorTalla).toEqual([{ talla: "25", pares: 24 }]);
  });

  it("atribuye a cada caja opcional su sobrante sin contar dos veces", () => {
    // Sobran 30 pares de la 26 en el plan; dos cajas opcionales la traen
    // (24 pares cada tanda opcional): la primera toma 24 y la segunda solo 6.
    const cajas = [
      caja("OP1", 1, 1, [{ sku: "GT1-BLK-26", talla: "26", paresPorCaja: 24 }]),
      caja("OP2", 1, 1, [{ sku: "GT1-BLK-26", talla: "26", paresPorCaja: 24 }]),
    ];
    const d = desglosarOpcionales(cajas, [{ sku: "GT1-BLK-26", sugerido: 18 }]);
    expect(d.totalDeMas).toBe(30);
    expect(d.deMasPorCaja.get("OP1")).toEqual([{ talla: "26", pares: 24 }]);
    expect(d.deMasPorCaja.get("OP2")).toEqual([{ talla: "26", pares: 6 }]);
    expect(d.deMasEnOpcionales).toBe(30);
  });

  it("una caja opcional útil (tapa faltante real) casi no reporta sobrante", () => {
    const d = desglosarOpcionales(
      [caja("OP", 1, 1, [{ sku: "GT1-BLK-27", talla: "27", paresPorCaja: 24 }])],
      [{ sku: "GT1-BLK-27", sugerido: 22 }],
    );
    expect(d.deMasPorCaja.get("OP")).toEqual([{ talla: "27", pares: 2 }]);
  });

  it("el texto corto lista tallas con signo de más", () => {
    expect(
      textoDeMas([
        { talla: "26", pares: 120 },
        { talla: "27", pares: 48 },
      ]),
    ).toBe("T26 +120 · T27 +48");
  });
});
