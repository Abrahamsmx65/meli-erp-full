import { describe, expect, it } from "vitest";
import { armarCorreoFaltantes } from "./tiktok-faltantes-correo";

const paquete = (numero: number, orderId: string, skus: [string, number][]) => ({
  numero,
  orderId,
  packageId: `pk-${orderId}`,
  destinatario: null,
  revuelto: false,
  pares: skus.map(([sku, pares]) => ({ sku, pares, fnsku: null })),
});

describe("correo de faltantes", () => {
  it("sin faltantes no hay correo", () => {
    expect(armarCorreoFaltantes([{ numero: 22, creadoEn: "2026-09-15T16:00:00Z", total: 52, faltantes: [] }])).toBeNull();
  });

  it("lista cada pedido sin escanear con su número de hoja y sus productos, por corte", () => {
    const c = armarCorreoFaltantes([
      { numero: 22, creadoEn: "2026-09-15T16:00:00Z", total: 52, faltantes: [] },
      {
        numero: 23,
        creadoEn: "2026-09-16T14:30:00Z",
        total: 200,
        faltantes: [
          paquete(7, "586088910393672707", [["GT074-RED-27-MX", 1]]),
          paquete(9, "586089032401848023", [["GT074-LILAC-25-MX", 2], ["GT114-BLK-23-MX", 1]]),
        ],
      },
    ])!;
    expect(c.asunto).toBe("TikTok: 2 pedidos sin escanear en el corte #23");
    expect(c.texto).toContain("586088910393672707  #7  GT074-RED-27-MX");
    expect(c.texto).toContain("586089032401848023  #9  GT074-LILAC-25-MX x2, GT114-BLK-23-MX");
    expect(c.texto).toContain("faltan 2 de 200");
    expect(c.html).toContain("586088910393672707");
    expect(c.html).not.toContain("Corte #22");
  });
});

describe("correo de pedidos grandes sin cancelación parcial", () => {
  it("sin pedidos no hay correo", async () => {
    const { armarCorreoParciales } = await import("./tiktok-faltantes-correo");
    expect(armarCorreoParciales([])).toBeNull();
  });

  it("dice qué renglón cancelar a mano y qué sí hay, por pedido", async () => {
    const { armarCorreoParciales } = await import("./tiktok-faltantes-correo");
    const c = armarCorreoParciales([
      {
        orderId: "586107197906126326",
        sinStock: [{ sku: "GT148-BLK-24-MX", pares: 2 }, { sku: "GT148-DK BROWN-25-MX", pares: 1 }],
        vivos: [{ sku: "GT148-CREAM-26-MX", pares: 1 }],
        error: "TikTok Shop 11050001: Cannot partially cancel this order",
      },
    ]);
    expect(c).not.toBeNull();
    expect(c!.asunto).toContain("1 pedido grande necesita cancelación a mano");
    expect(c!.html).toContain("586107197906126326");
    expect(c!.html).toContain("GT148-BLK-24-MX ×2");
    expect(c!.html).toContain("GT148-CREAM-26-MX");
    expect(c!.html).toContain("Seller Center");
    expect(c!.texto).toContain("sin stock: GT148-BLK-24-MX ×2, GT148-DK BROWN-25-MX");
  });
});
