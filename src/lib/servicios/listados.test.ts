/**
 * Listados: detección de diferencias de atributos entre publicaciones
 * hermanas y armado del PUT que las unifica.
 *
 * El caso que motivó la pantalla: un agrupador (las botas GT militares) cuyas
 * publicaciones quedaron con CUATRO redacciones distintas de "Materiales"
 * ("Piel real", "Piel (cuero) y textil"…), y el picker de MELI las mostraba
 * como si fueran productos diferentes.
 */
import { describe, expect, it } from "vitest";
import {
  aplanarItem,
  armarPlanUnificacion,
  calcularDiferencias,
  valorDeAtributo,
  type ItemCrudo,
} from "./listados";

describe("valorDeAtributo", () => {
  it("prefiere value_name", () => {
    expect(valorDeAtributo({ id: "MATERIAL", value_name: "Piel real" })).toBe("Piel real");
  });

  it("junta los multivalor de values[] con coma", () => {
    expect(
      valorDeAtributo({
        id: "MATERIALS",
        value_name: null,
        values: [{ name: "Piel" }, { name: "Textil" }],
      }),
    ).toBe("Piel, Textil");
  });

  it("devuelve null cuando no hay nada", () => {
    expect(valorDeAtributo({ id: "MATERIAL", value_name: null, values: [] })).toBeNull();
  });
});

// Dos publicaciones hermanas (café y negro) con material distinto a nivel
// publicación, y una de ellas además con material distinto entre variantes.
function grupoDesparejo(): ItemCrudo[] {
  return [
    {
      id: "MLM100",
      title: "Bota café",
      status: "active",
      attributes: [
        { id: "MATERIAL", name: "Material", value_id: "1", value_name: "Piel real" },
        { id: "BRAND", name: "Marca", value_name: "GETAC" },
      ],
      variations: [
        {
          id: 1,
          attribute_combinations: [{ id: "SIZE", name: "Talla", value_name: "25" }],
          attributes: [
            { id: "SELLER_SKU", value_name: "GT135-TAN-25" },
            { id: "MATERIAL", name: "Material", value_name: "Piel real" },
          ],
        },
        {
          id: 2,
          attribute_combinations: [{ id: "SIZE", name: "Talla", value_name: "26" }],
          attributes: [
            { id: "SELLER_SKU", value_name: "GT135-TAN-26" },
            { id: "MATERIAL", name: "Material", value_name: "Piel (cuero) y textil" },
          ],
        },
      ],
    },
    {
      id: "MLM200",
      title: "Bota negra",
      status: "active",
      attributes: [
        { id: "MATERIAL", name: "Material", value_id: "2", value_name: "Piel (cuero) y textil" },
        { id: "BRAND", name: "Marca", value_name: "GETAC" },
      ],
      variations: [
        {
          id: 3,
          attribute_combinations: [{ id: "SIZE", name: "Talla", value_name: "25" }],
          attributes: [
            { id: "SELLER_SKU", value_name: "GT135-BLK-25" },
            { id: "MATERIAL", name: "Material", value_name: "Piel (cuero) y textil" },
          ],
        },
      ],
    },
  ];
}

describe("calcularDiferencias", () => {
  it("detecta el material desparejo a nivel publicación y a nivel variante", () => {
    const items = grupoDesparejo().map((i) => aplanarItem(i));
    const difs = calcularDiferencias(items);

    const porPublicacion = difs.find(
      (d) => d.atributoId === "MATERIAL" && d.nivel === "publicacion",
    );
    expect(porPublicacion).toBeDefined();
    expect(porPublicacion!.esMaterial).toBe(true);
    expect(porPublicacion!.esperada).toBe(false);
    expect(porPublicacion!.valores.map((v) => v.valor).sort()).toEqual([
      "Piel (cuero) y textil",
      "Piel real",
    ]);

    const porVariante = difs.find((d) => d.atributoId === "MATERIAL" && d.nivel === "variante");
    expect(porVariante).toBeDefined();
    // 2 variantes con "Piel (cuero) y textil" y 1 con "Piel real": el
    // mayoritario va primero, que es el que la pantalla propone.
    expect(porVariante!.valores[0]).toMatchObject({ valor: "Piel (cuero) y textil", veces: 2 });
  });

  it("la marca igual en todas NO aparece como diferencia", () => {
    const items = grupoDesparejo().map((i) => aplanarItem(i));
    const difs = calcularDiferencias(items);
    expect(difs.find((d) => d.atributoId === "BRAND")).toBeUndefined();
  });

  it("la talla difiere pero queda marcada como esperada, y el material va primero", () => {
    const items = grupoDesparejo().map((i) => aplanarItem(i));
    const difs = calcularDiferencias(items);
    const talla = difs.find((d) => d.atributoId === "SIZE");
    expect(talla?.esperada).toBe(true);
    expect(difs[0].esMaterial).toBe(true);
  });

  it("el SKU jamás se compara", () => {
    const items = grupoDesparejo().map((i) => aplanarItem(i));
    const difs = calcularDiferencias(items);
    expect(difs.find((d) => d.atributoId === "SELLER_SKU")).toBeUndefined();
  });

  it("que a una publicación le FALTE el atributo también es diferencia", () => {
    const [a, b] = grupoDesparejo();
    b.attributes = b.attributes!.filter((x) => x.id !== "MATERIAL");
    const difs = calcularDiferencias([a, b].map((i) => aplanarItem(i)));
    const d = difs.find((x) => x.atributoId === "MATERIAL" && x.nivel === "publicacion");
    expect(d?.valores.map((v) => v.valor)).toContain("(sin dato)");
  });
});

describe("armarPlanUnificacion", () => {
  it("cuando el atributo vive en las variantes, manda TODAS (MELI borra las omitidas) y solo cambia la desviada", () => {
    const item = grupoDesparejo()[0]; // variante 1 bien, variante 2 desviada
    const plan = armarPlanUnificacion(item, "MATERIAL", "Piel real");

    expect(plan.niveles).toEqual(["variantes"]);
    const vs = (plan.cuerpo as { variations: Record<string, unknown>[] }).variations;
    expect(vs).toHaveLength(2);

    // La que ya estaba bien viaja solo con su id: nada que tocar.
    expect(vs[0]).toEqual({ id: 1 });

    // La desviada lleva su arreglo COMPLETO: quitar el resto borraría el SELLER_SKU.
    const attrs = vs[1].attributes as Record<string, unknown>[];
    expect(attrs).toContainEqual({ id: "SELLER_SKU", value_name: "GT135-TAN-26" });
    expect(attrs).toContainEqual({ id: "MATERIAL", value_name: "Piel real" });
    expect(attrs.filter((a) => a.id === "MATERIAL")).toHaveLength(1);
  });

  it("corrige a la vez el nivel publicación cuando también está desviado", () => {
    const item = grupoDesparejo()[1]; // publicación dice "Piel (cuero) y textil"
    const plan = armarPlanUnificacion(item, "MATERIAL", "Piel real");
    expect(plan.niveles).toContain("publicacion");
    expect((plan.cuerpo as { attributes: unknown[] }).attributes).toEqual([
      { id: "MATERIAL", value_name: "Piel real" },
    ]);
  });

  it("el objetivo viaja SIEMPRE por nombre, nunca por value_id", () => {
    // Mandar solo el value_id truena en publicaciones donde ese id no
    // resuelve: "Value name of attribute MATERIALS was not provided and
    // couldn't be resolved from attributes database" (visto en producción).
    const item = grupoDesparejo()[1]; // su MATERIAL actual sí trae value_id
    const plan = armarPlanUnificacion(item, "MATERIAL", "Piel real");
    expect((plan.cuerpo as { attributes: unknown[] }).attributes).toEqual([
      { id: "MATERIAL", value_name: "Piel real" },
    ]);
  });

  it("una variante SIN el atributo lo recibe cuando sus hermanas sí lo tienen", () => {
    const item = grupoDesparejo()[0];
    item.variations![1].attributes = [{ id: "SELLER_SKU", value_name: "GT135-TAN-26" }];
    const plan = armarPlanUnificacion(item, "MATERIAL", "Piel real");
    const vs = (plan.cuerpo as { variations: Record<string, unknown>[] }).variations;
    expect(vs[1].attributes).toContainEqual({ id: "MATERIAL", value_name: "Piel real" });
  });

  it("respeta los ejes del picker: reemplaza dentro de attribute_combinations reenviando el resto intacto", () => {
    const item: ItemCrudo = {
      id: "MLM300",
      variations: [
        {
          id: 7,
          attribute_combinations: [
            { id: "SIZE", name: "Talla", value_id: "55", value_name: "25" },
            { id: "MATERIAL", name: "Material", value_name: "Piel real" },
          ],
        },
        {
          id: 8,
          attribute_combinations: [
            { id: "SIZE", name: "Talla", value_id: "56", value_name: "26" },
            { id: "MATERIAL", name: "Material", value_name: "Textil" },
          ],
        },
      ],
    };
    const plan = armarPlanUnificacion(item, "MATERIAL", "Piel real");
    const vs = (plan.cuerpo as { variations: Record<string, unknown>[] }).variations;
    expect(vs[0]).toEqual({ id: 7 });
    expect(vs[1].attribute_combinations).toEqual([
      { id: "SIZE", value_id: "56", value_name: "26" },
      { id: "MATERIAL", value_name: "Piel real" },
    ]);
  });

  it("si ya está parejo no hay nada que escribir", () => {
    const item = grupoDesparejo()[1];
    const plan = armarPlanUnificacion(item, "MATERIAL", "Piel (cuero) y textil");
    expect(plan.cuerpo).toBeNull();
  });

  it("un atributo que no existe en ningún lado se agrega a nivel publicación", () => {
    const item: ItemCrudo = { id: "MLM400", attributes: [], variations: [] };
    const plan = armarPlanUnificacion(item, "MATERIAL", "Piel real");
    expect(plan.niveles).toEqual(["publicacion"]);
    expect((plan.cuerpo as { attributes: unknown[] }).attributes).toEqual([
      { id: "MATERIAL", value_name: "Piel real" },
    ]);
  });
});
