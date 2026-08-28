import { describe, expect, it } from "vitest";
import { unicasPorLlave } from "./repos";

describe("upsert por tandas: una sola fila por llave", () => {
  it("quita la llave repetida y deja la ÚLTIMA", () => {
    // El caso real: dos variantes de MELI con el mismo SELLER_SKU. Postgres
    // tira la sentencia entera con "ON CONFLICT DO UPDATE command cannot
    // affect row a second time" y se pierde la tanda completa.
    const filas = [
      { account_id: "a", sku: "GT135-NEGRO-25", inventory_id: "VIEJO" },
      { account_id: "a", sku: "GT135-NEGRO-26", inventory_id: "OTRO" },
      { account_id: "a", sku: "GT135-NEGRO-25", inventory_id: "NUEVO" },
    ];
    const out = unicasPorLlave(filas, "account_id,sku");
    expect(out).toHaveLength(2);
    expect(out.find((f) => f.sku === "GT135-NEGRO-25")?.inventory_id).toBe("NUEVO");
  });

  it("el mismo sku en otra cuenta no es repetido", () => {
    const filas = [
      { account_id: "a", sku: "GT135-NEGRO-25" },
      { account_id: "b", sku: "GT135-NEGRO-25" },
    ];
    expect(unicasPorLlave(filas, "account_id,sku")).toHaveLength(2);
  });

  it("llave de tres columnas: la foto del stock es por cuenta+sku+fecha", () => {
    const filas = [
      { account_id: "a", sku: "X", fecha: "2026-08-28", disponible: 1 },
      { account_id: "a", sku: "X", fecha: "2026-08-27", disponible: 5 },
      { account_id: "a", sku: "X", fecha: "2026-08-28", disponible: 9 },
    ];
    const out = unicasPorLlave(filas, "account_id,sku,fecha");
    expect(out).toHaveLength(2);
    expect(out.find((f) => f.fecha === "2026-08-28")?.disponible).toBe(9);
  });

  it("sin repetidos devuelve el MISMO arreglo, sin copiar", () => {
    const filas = [{ account_id: "a", sku: "X" }, { account_id: "a", sku: "Y" }];
    expect(unicasPorLlave(filas, "account_id,sku")).toBe(filas);
  });

  it("no confunde llaves que se pegan ('a'+'bc' vs 'ab'+'c')", () => {
    const filas = [
      { account_id: "a", sku: "bc" },
      { account_id: "ab", sku: "c" },
    ];
    expect(unicasPorLlave(filas, "account_id,sku")).toHaveLength(2);
  });

  it("una lista vacía no truena", () => {
    expect(unicasPorLlave([], "account_id,sku")).toHaveLength(0);
  });
});
