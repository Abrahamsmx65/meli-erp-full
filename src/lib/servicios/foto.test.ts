import { describe, expect, it } from "vitest";
import { FRACCION_MINIMA, diaDeNegocio } from "./foto";

describe("foto diaria del stock", () => {
  it("el día es el del NEGOCIO (México, UTC-6), no el de UTC", () => {
    // 28 de agosto, 02:00 UTC = todavía 27 de agosto en México. Guardar la
    // foto como del 28 correría un día todo el historial de agotamientos.
    expect(diaDeNegocio(new Date("2026-08-28T02:00:00Z"))).toBe("2026-08-27");
    expect(diaDeNegocio(new Date("2026-08-28T13:00:00Z"))).toBe("2026-08-28");
  });

  it("una foto coja se marca incompleta y no pasa por buena", () => {
    // Los días reales: 20 ago guardó 491 SKUs de ~2,400, el 21 guardó 16 y
    // el 22 guardó 2. Se apuntaron como "el stock del día" y el motor los
    // creyó. Con este umbral se marcan como lo que son.
    const esperados = 2400;
    for (const fotografiados of [491, 16, 2]) {
      expect(fotografiados < esperados * FRACCION_MINIMA).toBe(true);
    }
    expect(2390 < esperados * FRACCION_MINIMA).toBe(false);
  });
});
