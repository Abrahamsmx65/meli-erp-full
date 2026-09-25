import { describe, expect, it } from "vitest";
import { primerDiaFaltante, siguienteDia } from "./reparar-ordenes";

describe("siguienteDia", () => {
  it("se queda en el día mientras el barrido siga registrando órdenes (lee 150 por vez)", () => {
    expect(siguienteDia("2026-06-18", 150, 300, "2026-06-01")).toEqual({ siguiente: "2026-06-18", completo: false });
  });
  it("sin órdenes nuevas el día está completo y pasa al anterior", () => {
    expect(siguienteDia("2026-06-18", 640, 640, "2026-06-01")).toEqual({ siguiente: "2026-06-17", completo: false });
  });
  it("al pasar el fondo termina", () => {
    expect(siguienteDia("2026-06-01", 600, 600, "2026-06-01")).toEqual({ siguiente: null, completo: true });
  });
});

describe("primerDiaFaltante", () => {
  it("es el día anterior a la primera orden registrada", () => {
    expect(primerDiaFaltante("2026-06-20", "2026-09-25")).toBe("2026-06-19");
    expect(primerDiaFaltante(null, "2026-09-25")).toBe("2026-09-24");
  });
});
