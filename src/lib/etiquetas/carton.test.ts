import { describe, expect, it } from "vitest";
import { ordenarTallas } from "./carton";

describe("carton", () => {
  it("ordenarTallas: números naturales y lo demás al final", () => {
    expect(ordenarTallas(["24", "9", "21.5", "CORRIDA", "21"])).toEqual(["9", "21", "21.5", "24", "CORRIDA"]);
  });
});
