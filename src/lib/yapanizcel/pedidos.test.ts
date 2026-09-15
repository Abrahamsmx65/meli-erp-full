import { describe, expect, it } from "vitest";
import { leerPedidoDeCeldas, modeloSegunMarca } from "./pedidos";

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

describe("pedido real de micas (Internet_82144_462_…Glass_with_box.xls)", async () => {
  const { readFileSync } = await import("node:fs");
  const { leerPedido } = await import("./pedidos");
  const r = await leerPedido(readFileSync("fixtures/yz-pedido-462.xls"), "pedido.xls");

  it("saca folio, diseño y fecha aunque estén arriba de la tabla", () => {
    expect(r.folio).toBe("82144");
    expect(r.diseno).toBe("462");
    expect(r.fechaPedido).toBe("2026-08-14");
  });

  it("encuentra el modelo sin encabezado y toma Qty como cantidad, no Total", () => {
    expect(r.lineas).toHaveLength(31);
    expect(r.unidades).toBe(9_300);
    expect(r.lineas[0]).toEqual({
      skuBodega: "462-I18PRO",
      diseno: "462",
      modelo: "I18PRO",
      color: "",
      cantidad: 2000,
      costoUnitario: 2.93,
    });
  });

  it("escribe el modelo como MELI según la marca", () => {
    const por = new Map(r.lineas.map((l) => [l.skuBodega, l]));
    expect(por.get("462-IXR")?.cantidad).toBe(200);
    expect(por.get("462-ISE2022")?.cantidad).toBe(50);
    expect(por.get("462-A57")?.cantidad).toBe(800);
    expect(por.get("462-S23ULTRA")?.costoUnitario).toBe(6.13);
    expect(por.get("462-RMN13PRO4G")?.cantidad).toBe(100);
    expect(por.get("462-POCOX8PRO")?.cantidad).toBe(200);
  });
});

describe("modeloSegunMarca", () => {
  it("iPhone lleva la i; iPad su nombre", () => {
    expect(modeloSegunMarca("Iphone", "I18 Pro Max")).toBe("I18PROMAX");
    expect(modeloSegunMarca("Iphone", "XR")).toBe("IXR");
    expect(modeloSegunMarca("Iphone", "Air")).toBe("IAIR");
    expect(modeloSegunMarca("iPad", "10")).toBe("IPAD10");
  });
  it("Redmi Note es Rmn con su red, Redmi es Rm, Poco sin red", () => {
    expect(modeloSegunMarca("Redmi", "Note 13 Pro 4G")).toBe("RMN13PRO4G");
    expect(modeloSegunMarca("Redmi", "12C")).toBe("RM12C");
    expect(modeloSegunMarca("Redmi", "Poco M7 4G")).toBe("POCOM7");
    expect(modeloSegunMarca("Xiaomi", "Rmn13")).toBe("RMN13");
  });
  it("Samsung y sin marca van tal cual", () => {
    expect(modeloSegunMarca("Samsung", "S24 Plus")).toBe("S24PLUS");
    expect(modeloSegunMarca("", "I17 Pro")).toBe("I17PRO");
  });
});
