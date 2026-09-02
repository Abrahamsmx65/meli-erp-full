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

describe("pedido real de la fábrica (Internet_82143_499_Magsafe_with_glass.xls)", async () => {
  const { readFileSync } = await import("node:fs");
  const { leerPedido } = await import("./pedidos");
  const r = await leerPedido(readFileSync("fixtures/yz-pedido.xls"), "pedido.xls");

  it("saca folio, diseño y fecha de las celdas sueltas", () => {
    expect(r.folio).toBe("82143");
    expect(r.diseno).toBe("499");
    expect(r.fechaPedido).toBe("2026-07-20");
  });

  it("lee las 14 líneas y 11,000 unidades, sin el TOTAL", () => {
    expect(r.lineas).toHaveLength(14);
    expect(r.unidades).toBe(11000);
  });

  it("arma el SKU como en bodega y toma el costo del SET, no de la funda sola", () => {
    expect(r.lineas[0]).toEqual({
      skuBodega: "499-I17PROMAX",
      diseno: "499",
      modelo: "I17PROMAX",
      color: "",
      cantidad: 3000,
      costoUnitario: 6.75,
    });
    expect(r.lineas.find((l) => l.skuBodega === "499-I17E")?.cantidad).toBe(600);
  });
});
