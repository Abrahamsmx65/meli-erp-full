import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cajasDelBl, cotejarConBl, leerBl } from "./bl";
import { textoDePdf } from "./texto-pdf";

describe("leerBl", () => {
  it("la línea del contenedor con CARTON aparte (HMM, S260-2026: 611)", () => {
    const l = leerBl("HMMU4106958/26H0249165/611/CARTON/7135KGS/68.24CBM/40HQ … TOTAL SIX HUNDRED ELEVEN(611) CARTON ONLY");
    expect(l).toEqual({ total: 611, porContenedor: { HMMU4106958: 611 } });
    expect(cajasDelBl(l, "HMMU4106958")).toBe(611);
  });

  it("la línea con CTNS pegado (YQN, S263-2026: 606) y el total con espacio antes del paréntesis", () => {
    const l = leerBl("UETU5682034/WHA2362237/606CTNS/11404KGS/65.52CBM/40HQ\nTOTAL FIVE HUNDRED THIRTY (530) CTNS ONLY");
    expect(l.porContenedor).toEqual({ UETU5682034: 606 });
    expect(l.total).toBe(530);
    // La línea del contenedor manda sobre el total.
    expect(cajasDelBl(l, "UETU5682034")).toBe(606);
  });

  it("sin línea del contenedor vale el total; con OTRO contenedor nombrado, no", () => {
    expect(cajasDelBl(leerBl("542CARTONS SHOES TOTAL FIVE HUNDRED FORTY TWO(542) CARTONS ONLY"), "HMMU6173610")).toBe(542);
    expect(cajasDelBl(leerBl("HMMU6173810/26H0249065/542/CARTONS/5261KGS TOTAL FIVE HUNDRED FORTY TWO(542) CARTONS ONLY"), "HMMU6173610")).toBeNull();
  });

  it("un PDF que no es BL no da número", () => {
    expect(leerBl("PROFORMA INVOICE JH2026925 TOTAL USD 12,000")).toEqual({ total: null, porContenedor: {} });
  });

  it("del PDF real: S260-2026 dice 611 y S263-2026 dice 606", async () => {
    const s260 = leerBl(await textoDePdf(readFileSync(join(process.cwd(), "fixtures", "bl-S260-HMMU4106958.pdf"))));
    expect(cajasDelBl(s260, "HMMU4106958")).toBe(611);
    const s263 = leerBl(await textoDePdf(readFileSync(join(process.cwd(), "fixtures", "bl-S263-UETU5682034.pdf"))));
    expect(cajasDelBl(s263, "UETU5682034")).toBe(606);
  });
});

describe("cotejarConBl", () => {
  it("faltan, sobran, cuadra y sin BL", () => {
    expect(cotejarConBl(399, 611)).toEqual({ estado: "faltan", diferencia: -212 });
    expect(cotejarConBl(1060, 530)).toEqual({ estado: "sobran", diferencia: 530 });
    expect(cotejarConBl(611, 611)).toEqual({ estado: "cuadra", diferencia: 0 });
    expect(cotejarConBl(611, null).estado).toBe("sin_bl");
  });
});
