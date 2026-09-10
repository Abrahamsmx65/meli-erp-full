import { describe, expect, it } from "vitest";
import { cambio, esEmbarqueViejo, numeroDeEmbarque } from "./drive-packing";

describe("qué packing lists de Drive se importan", () => {
  it("saca el número de embarque del nombre o de la referencia", () => {
    expect(numeroDeEmbarque("S259-2026 PACKING LIST.xlsx")).toBe(259);
    expect(numeroDeEmbarque("s 260 packing")).toBe(260);
    expect(numeroDeEmbarque("PACKING LIST S-261.xlsx")).toBe(261);
    expect(numeroDeEmbarque("MIEU3920536")).toBe(null);
    expect(numeroDeEmbarque("fundas agosto.xlsx")).toBe(null);
    expect(numeroDeEmbarque("IN10079-3")).toBe(null);
  });

  it("solo entran los embarques posteriores al último cargado; sin número se decide por el amarre", () => {
    expect(esEmbarqueViejo(258, 259)).toBe(true);
    expect(esEmbarqueViejo(259, 259)).toBe(false);
    expect(esEmbarqueViejo(260, 259)).toBe(false);
    expect(esEmbarqueViejo(null, 259)).toBe(false);
    expect(esEmbarqueViejo(100, null)).toBe(false);
  });

  it("un archivo cambió si su md5 o, sin md5, su fecha de listado cambió", () => {
    const a = { id: "1", nombre: "x.xlsx", mime: "", md5: null, modificadoEn: "2026-09-09T00:00:00.000Z", tamano: null };
    expect(cambio(a, undefined)).toBe(true);
    expect(cambio(a, { drive_file_id: "1", md5: null, modificado_en: "2026-09-09T05:00:00+00:00", estado: "importado" })).toBe(false);
    expect(cambio(a, { drive_file_id: "1", md5: null, modificado_en: "2026-09-08T00:00:00+00:00", estado: "importado" })).toBe(true);
    expect(cambio({ ...a, md5: "b" }, { drive_file_id: "1", md5: "a", modificado_en: null, estado: "importado" })).toBe(true);
  });
});
