import { describe, expect, it } from "vitest";
import { ordenarTallas, textosDeCarton } from "./carton";

describe("textosDeCarton", () => {
  it("una etiqueta por color para las cajas de corrida", () => {
    expect(textosDeCarton("IN10128", "GT125", [{ color: "BLK", tallas: [], corrida: true }])).toEqual([
      "IN10128-GT125-BLK",
    ]);
  });

  it("cajas de UNA talla: una etiqueta por talla, en orden natural (IN10172 de GT148)", () => {
    expect(
      textosDeCarton("IN10172", "GT148", [
        { color: "BLACK", tallas: ["25", "23", "24", "27", "26"], corrida: false },
        { color: "MBROWN-RED", tallas: ["23"], corrida: false },
      ]),
    ).toEqual([
      "IN10172-GT148-BLACK-23",
      "IN10172-GT148-BLACK-24",
      "IN10172-GT148-BLACK-25",
      "IN10172-GT148-BLACK-26",
      "IN10172-GT148-BLACK-27",
      "IN10172-GT148-MBROWN-RED-23",
    ]);
  });

  it("un color con corrida Y cajas unitalla lleva las dos", () => {
    expect(textosDeCarton("IN10151", "GT104-1", [{ color: "BLK", tallas: ["30"], corrida: true }])).toEqual([
      "IN10151-GT104-1-BLK",
      "IN10151-GT104-1-BLK-30",
    ]);
  });

  it("ordenarTallas: números naturales y lo demás al final", () => {
    expect(ordenarTallas(["24", "9", "21.5", "CORRIDA", "21"])).toEqual(["9", "21", "21.5", "24", "CORRIDA"]);
  });
});
