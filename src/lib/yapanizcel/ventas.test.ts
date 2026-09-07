import { describe, expect, it } from "vitest";
import { estimarNeto } from "./ventas";

describe("estimarNeto", () => {
  it("usa el porcentaje observado y, sin él, importe − comisión", () => {
    expect(estimarNeto(1000, 140, 0.51)).toBe(510);
    expect(estimarNeto(1000, 140, null)).toBe(860);
    expect(estimarNeto(1000, 140, 0)).toBe(860);
    expect(estimarNeto(1000, 140, 1.4)).toBe(860);
    expect(estimarNeto(0, 0, 0.51)).toBe(0);
  });
});
