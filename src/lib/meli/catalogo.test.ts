/**
 * Lectura del catálogo de MELI: de dónde sale el SKU de cada variante y qué
 * pasa con las que no se pueden guardar.
 *
 * El caso que motivó estas pruebas: publicaciones donde unas tallas sí traían
 * SKU y otras no aparecían en el sistema, sin ninguna señal de por qué.
 */
import { describe, expect, it } from "vitest";
import { dedupePorSku, extraerSku, nuevoDiagnostico, type FilaSku } from "./sync";

describe("de dónde sale el SKU de una variante", () => {
  it("lo toma de value_name", () => {
    expect(
      extraerSku({ attributes: [{ id: "SELLER_SKU", value_name: "GT187-SILVER-24-MX" }] }),
    ).toBe("GT187-SILVER-24-MX");
  });

  it("lo toma de values[].name cuando value_name viene vacío", () => {
    // Es la forma en que MELI devuelve el SKU capturado desde el editor
    // nuevo: value_name en null y el texto adentro de values.
    expect(
      extraerSku({
        attributes: [
          { id: "SELLER_SKU", value_name: null, values: [{ name: "GT187-SILVER-24-MX" }] },
        ],
      }),
    ).toBe("GT187-SILVER-24-MX");
  });

  it("prefiere value_name sobre values", () => {
    expect(
      extraerSku({
        attributes: [{ id: "SELLER_SKU", value_name: "BUENO", values: [{ name: "VIEJO" }] }],
      }),
    ).toBe("BUENO");
  });

  it("cae a seller_custom_field en publicaciones viejas", () => {
    expect(extraerSku({ seller_custom_field: "GT100-BLK-25" })).toBe("GT100-BLK-25");
  });

  it("ignora valores en blanco y otros atributos", () => {
    expect(
      extraerSku({
        attributes: [
          { id: "COLOR", value_name: "SILVER" },
          { id: "SELLER_SKU", value_name: "   ", values: [{ name: "  " }] },
        ],
      }),
    ).toBeNull();
    expect(extraerSku(undefined)).toBeNull();
    expect(extraerSku({})).toBeNull();
  });
});

/** Igual que las de MELI, pero solo con lo que el catálogo mira. */
function fila(sku: string, extra?: Partial<FilaSku>): FilaSku {
  return {
    sku,
    itemId: "MLM1",
    variationId: "1",
    inventoryId: null,
    titulo: "Sandalia",
    logistica: "fulfillment",
    estado: "active",
    precio: null,
    ...extra,
  };
}

describe("SKUs repetidos dentro de una publicación", () => {
  it("deja una sola fila y lo reporta", () => {
    const diag = nuevoDiagnostico();
    const filas = [
      fila("GT187-PINK-24-MX", { variationId: "10" }),
      fila("GT187-PINK-24-MX", { variationId: "11" }),
    ];

    const out = dedupePorSku(filas, diag);

    expect(out).toHaveLength(1);
    expect(diag.skusRepetidos).toHaveLength(1);
    expect(diag.skusRepetidos[0].sku).toBe("GT187-PINK-24-MX");
  });

  it("no reporta cuando el SKU se repite entre publicaciones distintas", () => {
    const diag = nuevoDiagnostico();
    const filas = [
      fila("GT187-PINK-24-MX", { itemId: "MLM1" }),
      fila("GT187-PINK-24-MX", { itemId: "MLM2" }),
    ];

    dedupePorSku(filas, diag);

    // Ese caso es normal (una publicación vieja y una nueva) y ya se resuelve
    // por puntaje; avisarlo sería ruido.
    expect(diag.skusRepetidos).toHaveLength(0);
  });

  it("se queda con la que tiene inventario de Full", () => {
    const filas = [
      fila("GT187-PINK-24-MX", { itemId: "MLM1", inventoryId: null }),
      fila("GT187-PINK-24-MX", { itemId: "MLM2", inventoryId: "INV9" }),
    ];

    expect(dedupePorSku(filas)[0].inventoryId).toBe("INV9");
  });

  it("sin diagnóstico se comporta igual que antes", () => {
    const filas = [fila("A-B-1"), fila("A-B-1")];
    expect(dedupePorSku(filas)).toHaveLength(1);
  });
});

describe("diagnóstico vacío", () => {
  it("arranca en ceros", () => {
    const d = nuevoDiagnostico();
    expect(d.variantesSinSku).toEqual([]);
    expect(d.skusRepetidos).toEqual([]);
    expect(d.lotesFallidos).toBe(0);
  });
});

describe("el SKU que vive en el user product", () => {
  it("lo lee de values[].name aunque no exista value_name", () => {
    // Forma exacta con la que MELI contesta /user-products: el atributo no
    // trae la llave value_name, solo values.
    expect(
      extraerSku({
        attributes: [
          { id: "COLOR", values: [{ id: "52049", name: "Negro" }] },
          { id: "SELLER_SKU", values: [{ id: null, name: "GT187-BLK-24-MX" }] },
        ],
      } as never),
    ).toBe("GT187-BLK-24-MX");
  });

  it("no confunde el SKU con otro atributo", () => {
    expect(
      extraerSku({
        attributes: [
          { id: "MODEL", values: [{ id: null, name: "GT187" }] },
          { id: "SIZE", values: [{ id: "11375850", name: "24 MX" }] },
        ],
      } as never),
    ).toBeNull();
  });
});
