import { describe, expect, it } from "vitest";
import { numerarPaquetes, type PaqueteDespacho } from "./despacho";
import { avanceDeLote, detectarLotes, loteDeCodigo, loteDePaquete, textoDeLote } from "./lotes";

function uno(orderId: string, sku: string, fnsku = "X001AAA", pares = 1): PaqueteDespacho {
  return { orderId, packageId: `p${orderId}`, destinatario: null, pares: [{ sku, pares, fnsku }] };
}

const paquetes = numerarPaquetes(
  [
    ...Array.from({ length: 12 }, (_, i) => uno(`a${i}`, "GT148-BLK-24-MX")),
    uno("b1", "GT148-BLK-24-MX", "X001AAA", 2),
    ...Array.from({ length: 3 }, (_, i) => uno(`c${i}`, "GT148-BLK-25-MX", "X001BBB")),
    ...Array.from({ length: 10 }, (_, i) => uno(`d${i}`, "GT148-M BROWN-24-MX", "X001CCC")),
  ],
  "un-color",
);

describe("detectarLotes", () => {
  it("reconoce corridas de 10 o más paquetes iguales de un par; dos pares o pocos paquetes no forman lote", () => {
    const lotes = detectarLotes(paquetes);
    expect(lotes.map((l) => `${l.sku}:${l.cantidad}:#${l.desde}-#${l.hasta}`)).toEqual([
      "GT148-BLK-24-MX:12:#1-#12",
      "GT148-M BROWN-24-MX:10:#17-#26",
    ]);
    expect(lotes[0].codigos).toEqual(["X001AAA"]);
    expect(textoDeLote(lotes[0])).toBe("LOTE · GT148-BLK-24-MX · 12 paquetes · #1–#12");
  });

  it("un paquete cancelado corta la corrida", () => {
    const conCancelado = paquetes.map((p) => (p.numero === 6 ? { ...p, cancelado: true } : p));
    expect(detectarLotes(conCancelado).map((l) => l.sku)).toEqual(["GT148-M BROWN-24-MX"]);
    expect(detectarLotes(conCancelado, 5).map((l) => `${l.desde}-${l.hasta}`)).toEqual(["1-5", "7-12", "17-26"]);
  });

  it("encuentra el lote de un número y el que abre un código, saltando los lotes ya terminados", () => {
    const lotes = detectarLotes(paquetes);
    expect(loteDePaquete(lotes, 3)?.sku).toBe("GT148-BLK-24-MX");
    expect(loteDePaquete(lotes, 14)).toBeNull();
    const todos = new Set(lotes[0].numeros);
    expect(loteDeCodigo(lotes, "x001aaa", new Set())?.desde).toBe(1);
    expect(loteDeCodigo(lotes, "X001AAA", todos)).toBeNull();
    expect(loteDeCodigo(lotes, "X001BBB", new Set())).toBeNull();
    expect(avanceDeLote(lotes[0], new Set([1, 2, 3]))).toEqual({ hechos: 3, total: 12 });
  });
});
