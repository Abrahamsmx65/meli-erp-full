import { describe, expect, it } from "vitest";
import {
  construirMutacion,
  construirMutacionAlta,
  normalizarRespuestaItem,
  skusAusentes,
  tieneDatos,
  validarValores,
} from "./fiscal";

/** Forma REAL capturada del API fiscal_information (GT203, ago 2026). */
function respuestaReal() {
  return {
    data: {
      getFiscalInformationsByItem: [
        {
          itemId: "MLM2775842349",
          variationId: "198112513109",
          type: "SINGLE",
          components: [
            {
              sku: "GT203-BLK-23-MX",
              quantity: 1,
              percentageShare: 100,
              fiscalInformation: {
                __typename: "FiscalInformationMLM",
                sat: "53111800",
                iva: "16",
                ieps: 0,
                measureUnit: "H87",
              },
            },
          ],
        },
        {
          itemId: "MLM2775842349",
          variationId: "198112513111",
          type: "SINGLE",
          components: [
            {
              sku: "GT203-GOLD-23-MX",
              quantity: 1,
              percentageShare: 100,
              // Variante SIN información fiscal cargada.
              fiscalInformation: null,
            },
          ],
        },
      ],
    },
  };
}

describe("normalizarRespuestaItem", () => {
  it("aplana la respuesta real a una fila por SKU", () => {
    const { filas, sinSku } = normalizarRespuestaItem("MLM2775842349", respuestaReal());

    expect(sinSku).toBe(0);
    expect(filas).toHaveLength(2);

    const conDatos = filas.find((f) => f.sku === "GT203-BLK-23-MX")!;
    expect(conDatos).toMatchObject({
      itemId: "MLM2775842349",
      variationId: "198112513109",
      sat: "53111800",
      iva: "16",
      ieps: 0,
      unidad: "H87",
    });
    expect(tieneDatos(conDatos)).toBe(true);

    const sinDatos = filas.find((f) => f.sku === "GT203-GOLD-23-MX")!;
    expect(sinDatos.sat).toBeNull();
    expect(tieneDatos(sinDatos)).toBe(false);
  });

  it("cuenta los componentes sin SKU en lugar de inventarles uno", () => {
    const { filas, sinSku } = normalizarRespuestaItem("MLM1", {
      data: {
        getFiscalInformationsByItem: [
          { itemId: "MLM1", variationId: null, components: [{ sku: null }] },
        ],
      },
    });
    expect(filas).toHaveLength(0);
    expect(sinSku).toBe(1);
  });

  it("convierte los errores GraphQL en excepción con el mensaje de MELI", () => {
    expect(() =>
      normalizarRespuestaItem("MLM1", {
        errors: [{ message: "Cannot query field X" }],
      }),
    ).toThrow(/Cannot query field X/);
  });
});

describe("skusAusentes", () => {
  it("marca como sin respuesta los SKUs del catálogo que MELI no mencionó", () => {
    const { filas } = normalizarRespuestaItem("MLM2775842349", respuestaReal());
    const delItem = ["GT203-BLK-23-MX", "GT203-GOLD-23-MX", "GT203-PINK-27-MX"];
    expect(skusAusentes(delItem, filas)).toEqual(["GT203-PINK-27-MX"]);
  });

  it("sin ausentes regresa vacío", () => {
    const { filas } = normalizarRespuestaItem("MLM2775842349", respuestaReal());
    expect(skusAusentes(["GT203-BLK-23-MX"], filas)).toEqual([]);
  });
});

describe("construirMutacion", () => {
  it("manda solo los campos capturados, en línea y sin tipos declarados", () => {
    const q = construirMutacion("SKU1", { sat: "53111800" });
    expect(q).toContain('where: { sku: "SKU1" }');
    expect(q).toContain('input: { sat: "53111800" }');
    // MELI rechazó los nombres de tipos adivinados; en línea no hacen falta.
    expect(q).not.toContain("$where");
    expect(q).not.toContain("Input!");
  });

  it("la unidad viaja con su descripción del catálogo del SAT", () => {
    const q = construirMutacion("SKU1", { sat: "53111800", iva: "16", ieps: 0, unidad: "H87" });
    expect(q).toContain(
      'input: { sat: "53111800", iva: "16", ieps: 0, measureUnit: "H87", measureUnitDescription: "UN" }',
    );
  });

  it("escapa el SKU aunque traiga comillas", () => {
    const q = construirMutacion('RARO"1', { sat: "53111800" });
    expect(q).toContain('where: { sku: "RARO\\"1" }');
  });

  it("rechaza una mutación vacía", () => {
    expect(() => construirMutacion("SKU1", {})).toThrow(/ningún valor/);
  });
});

describe("construirMutacionAlta", () => {
  it("da de alta con el SKU dentro del input y la descripción del título", () => {
    const q = construirMutacionAlta(
      "GT134-BLK / BLK-26-MX",
      { sat: "53111800", iva: "16", ieps: 0, unidad: "H87" },
      "Sandalias Chanclas Mujer Y Hombre Eva Suela Gruesa",
    );
    expect(q).toContain("createFiscalInformationMLM(input: {");
    expect(q).toContain('sku: "GT134-BLK / BLK-26-MX"');
    expect(q).toContain('description: "Sandalias Chanclas Mujer Y Hombre Eva Suela Gruesa"');
    expect(q).not.toContain("$input");
  });

  it("sin título simplemente no manda descripción", () => {
    const q = construirMutacionAlta("SKU1", { sat: "53111800" }, null);
    expect(q).not.toContain("description:");
  });
});

describe("validarValores", () => {
  it("acepta la captura típica de calzado", () => {
    expect(validarValores({ sat: "53111800", iva: "16", ieps: 0, unidad: "H87" })).toBeNull();
  });

  it("exige clave SAT de 8 dígitos", () => {
    expect(validarValores({ sat: "531118" })).toMatch(/8 dígitos/);
    expect(validarValores({})).toMatch(/8 dígitos/);
  });

  it("solo admite los IVA de México", () => {
    expect(validarValores({ sat: "53111800", iva: "15" })).toMatch(/IVA/);
  });

  it("acota el IEPS a un porcentaje", () => {
    expect(validarValores({ sat: "53111800", ieps: 200 })).toMatch(/IEPS/);
  });
});
