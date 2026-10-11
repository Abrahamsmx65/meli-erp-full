import { describe, expect, it } from "vitest";
import { cambio, contenedorDelEmbarque, elegirContenedor, esArchivoAjeno, esEmbarqueViejo, numeroDeEmbarque, puedeSerBl, referenciaDeNombre } from "./drive-packing";

describe("qué packing lists de Drive se importan", () => {
  it("un embarque ya cargado se reconoce por su NÚMERO aunque el texto cambie (S259 = S259-2026)", () => {
    const lista = [
      { id: "a", numero: "S259", estado: "en_transito", embarque: 259 },
      { id: "b", numero: "S260-2026", estado: "borrador", embarque: 260 },
    ];
    expect(contenedorDelEmbarque(lista, "S259-2026")?.id).toBe("a");
    expect(contenedorDelEmbarque(lista, "s260-2026")?.id).toBe("b");
    expect(contenedorDelEmbarque(lista, "S261-2026")).toBeNull();
    expect(contenedorDelEmbarque(lista, "MIEU3920536")).toBeNull();
  });

  it("las facturas y pedidos de la misma carpeta no son packing list", () => {
    expect(esArchivoAjeno("S261-2026 Invoice (HMMU6173610).xls")).toBe(true);
    expect(esArchivoAjeno("S261-2026 Packing List (IN10079-5) (HMMU6173610).xls")).toBe(false);
    expect(esArchivoAjeno("IN10079 (UGG) revised on May 19.xls")).toBe(false);
  });

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

  it("la referencia sale de la carpeta cuando el archivo no la trae (S271-2026)", () => {
    expect(referenciaDeNombre("S271-2026", "S271-2026 (HAMU5029953).xls")).toBe("S271-2026");
    expect(referenciaDeNombre(null, "S264-2026 Packing list - Ari (MIEU4234947).xls")).toBe("S264-2026");
    expect(referenciaDeNombre("Fundas", "packing.xls")).toBeNull();
  });

  it("el contenedor bautizado con el ISO se encuentra por el ISO y toma la referencia", () => {
    const lista = [{ id: "h", numero: "HAMU5029953", estado: "borrador", embarque: null, naviera: "HAMU5029953" }];
    expect(elegirContenedor(lista, "S271-2026", "HAMU5029953")).toEqual({ existente: lista[0], numero: "S271-2026", renombrar: "S271-2026" });
  });

  it("dos archivos con la misma referencia caen en el mismo contenedor (S261: mismo PL con dos ISO)", () => {
    const lista = [{ id: "s", numero: "S261-2026", estado: "borrador", embarque: 261, naviera: "HMMU6173810" }];
    expect(elegirContenedor(lista, "S261-2026", "HMMU6173610").existente?.id).toBe("s");
    expect(elegirContenedor([], "S272-2026", "ABCU1234567")).toEqual({ existente: null, numero: "S272-2026", renombrar: null });
  });

  it("de los PDF de la carpeta, la proforma y el pago no son BL", () => {
    expect(puedeSerBl("HBL R SASE4492496 (S263-2026).pdf")).toBe(true);
    expect(puedeSerBl("TELEX-HDMUSHAZLC703700 (S261-2026).pdf")).toBe(true);
    expect(puedeSerBl("PI JH2026925 (IN10118) revised on July 14.pdf")).toBe(false);
    expect(puedeSerBl("S260-2026 Packing List.xls")).toBe(false);
  });
});
