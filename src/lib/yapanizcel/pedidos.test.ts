import { describe, expect, it } from "vitest";
import { leerPedidoDeCeldas } from "./pedidos";

describe("leerPedidoDeCeldas", () => {
  it("lee por encabezados y saca el folio del título", () => {
    const r = leerPedidoDeCeldas([
      ["PEDIDO: YZ-0012", "", "", ""],
      ["", "", "", ""],
      ["SKU", "COLOR", "QTY", "UNIT PRICE"],
      ["499-IP15PM", "NEGRO", "200", "$1.20"],
      ["499-A54", "", "1,000", "1.1"],
      ["TOTAL", "", "1200", ""],
    ]);
    expect(r.folio).toBe("YZ-0012");
    expect(r.unidades).toBe(1200);
    expect(r.lineas[0]).toEqual({
      skuBodega: "499-IP15PM",
      diseno: "499",
      modelo: "IP15PM",
      color: "NEGRO",
      cantidad: 200,
      costoUnitario: 1.2,
    });
  });

  it("arma el SKU con diseño+modelo+color cuando no hay columna SKU", () => {
    const r = leerPedidoDeCeldas([
      ["DISEÑO", "MODELO", "COLOR", "CANTIDAD"],
      ["501", "IP15PM", "Azul", "50"],
    ]);
    expect(r.lineas[0].skuBodega).toBe("501-IP15PM-AZUL");
    expect(r.folio).toBeNull();
  });

  it("suma repetidos y avisa", () => {
    const r = leerPedidoDeCeldas([
      ["SKU", "CANTIDAD"],
      ["499-IP15PM", "10"],
      ["499-ip15pm", "5"],
    ]);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].cantidad).toBe(15);
    expect(r.avisos).toHaveLength(1);
  });

  it("truena sin encabezados", () => {
    expect(() => leerPedidoDeCeldas([["a", "b"], ["c", "d"]])).toThrow(/encabezados/);
  });
});
