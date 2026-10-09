import { describe, expect, it } from "vitest";
import { amarrarLineasCon, colorDeEncabezado, leerPedidoDeCeldas, modeloSegunMarca } from "./pedidos";

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
    expect(r.lineas[0]).toMatchObject({
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
    expect(r.lineas[0]).toMatchObject({
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
    expect(r.lineas[0]).toMatchObject({
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

describe("pedidos con columnas por COLOR (8-oct-2026)", async () => {
  const { readFileSync } = await import("node:fs");
  const { leerPedido } = await import("./pedidos");
  const por = (r: Awaited<ReturnType<typeof leerPedido>>) => new Map(r.lineas.map((l) => [l.skuBodega, l]));

  it("714: una sola columna de color (Transparent透明), costo UNIT PRICE(RMB) y fecha suelta", async () => {
    const r = await leerPedido(readFileSync("fixtures/yz-pedido-714.xls"), "714.xls");
    expect(r.folio).toBe("82156");
    expect(r.diseno).toBe("714");
    expect(r.fechaPedido).toBe("2026-09-16");
    expect(r.lineas).toHaveLength(11);
    expect(r.unidades).toBe(2400);
    const m = por(r);
    // Un solo color: el SKU va sin color (714-A37) y el color se guarda aparte.
    expect(m.get("714-A37")).toMatchObject({ color: "TRANSPARENT", cantidad: 100, costoUnitario: 5.3 });
    expect(m.get("714-RENO16")?.cantidad).toBe(100);
    expect(m.get("714-RM17")?.cantidad).toBe(200);
    expect(m.get("714-RMN174G")?.cantidad).toBe(200);
    // Lo que va DESPUÉS del renglón de total también se lee (S27, Oppo, Redmi).
    expect(m.get("714-S27ULTRA")?.cantidad).toBe(200);
  });

  it("648: una columna de color y tres RMB: gana la de más a la derecha (el conjunto)", async () => {
    const r = await leerPedido(readFileSync("fixtures/yz-pedido-648.xls"), "648.xls");
    expect(r.folio).toBe("82153");
    expect(r.lineas).toHaveLength(21);
    expect(r.unidades).toBe(3960);
    expect(por(r).get("648-A07")).toMatchObject({ color: "TRANSPARENT", cantidad: 100, costoUnitario: 3.2 });
    expect(por(r).get("648-A50")?.cantidad).toBe(50);
  });

  it("662: varias columnas de color: una línea por color, Qty solo como suma, costo Cost of Set", async () => {
    const r = await leerPedido(readFileSync("fixtures/yz-pedido-662.xls"), "662.xls");
    expect(r.folio).toBe("82154");
    expect(r.lineas).toHaveLength(59);
    expect(r.unidades).toBe(6750);
    expect(r.avisos).toEqual([]);
    const m = por(r);
    expect(m.get("662-A07-BLK")).toMatchObject({ color: "BLK", cantidad: 200, costoUnitario: 1.3 });
    expect(m.get("662-A07-GREEN")?.cantidad).toBe(160);
    expect(m.get("662-A07-FUCHSIA")?.cantidad).toBe(60);
    expect(m.has("662-A07-CREAM")).toBe(false);
    expect(m.get("662-RM15CC85-GREEN")?.cantidad).toBe(140);
    expect(m.get("662-RMN15PRO5G-BLK")?.cantidad).toBe(160);
  });

  it("686: colores en chino, inglés y mezclados, y una columna SIN nombre que queda por deducir", async () => {
    const r = await leerPedido(readFileSync("fixtures/yz-pedido-686.xls"), "686.xls");
    expect(r.folio).toBe("82155");
    expect(r.lineas).toHaveLength(5);
    expect(r.unidades).toBe(2100);
    const m = por(r);
    expect(m.get("686-IPAD11-BLK")).toMatchObject({ cantidad: 600, costoUnitario: 34 });
    expect(m.get("686-IPAD11-PURPLE")?.cantidad).toBe(300);
    expect(m.get("686-IPAD11-PINK")?.cantidad).toBe(450);
    expect(m.get("686-IPAD11-GREY")?.cantidad).toBe(300);
    expect(m.get("686-IPAD11-?")).toMatchObject({ color: "?", cantidad: 450 });
    expect(r.avisos.some((a) => a.includes("sin nombre de color"))).toBe(true);
  });
});

describe("colorDeEncabezado", () => {
  it("reconoce el color solo o con chino pegado, y no las notas que mencionan un color", () => {
    expect(colorDeEncabezado("BLK")).toBe("BLK");
    expect(colorDeEncabezado("Transparent透明")).toBe("TRANSPARENT");
    expect(colorDeEncabezado("purple 紫色")).toBe("PURPLE");
    expect(colorDeEncabezado("黑色")).toBe("BLK");
    expect(colorDeEncabezado("桃紅")).toBe("FUCHSIA");
    expect(colorDeEncabezado("米")).toBe("CREAM");
    expect(colorDeEncabezado("小單箱子用黃色膠布")).toBeNull();
    expect(colorDeEncabezado("Cost of Set")).toBeNull();
    expect(colorDeEncabezado("Qty")).toBeNull();
    expect(colorDeEncabezado("")).toBeNull();
  });
});

describe("amarre de las líneas contra MELI (catálogos reales, 8-oct-2026)", async () => {
  const { readFileSync } = await import("node:fs");
  const { leerPedido } = await import("./pedidos");

  it("686: la columna sin nombre es NAVY, el único color del iPad 11 que el archivo no nombra", async () => {
    const r = await leerPedido(readFileSync("fixtures/yz-pedido-686.xls"), "686.xls");
    const catalogo = ["N-686-iPad11-blk", "N-686-iPad11-grey", "N-686-iPad11-navy", "N-686-iPad11-pink", "N-686-iPad11-purple", "686-iPad10-blk"].map((sku) => ({ sku, estado: "active" }));
    const a = amarrarLineasCon(r, catalogo);
    const navy = a.lineas.find((l) => l.color === "NAVY");
    expect(navy).toMatchObject({ skuBodega: "686-IPAD11-NAVY", cantidad: 450, skuMeli: "N-686-iPad11-navy" });
    expect(a.lineas.every((l) => l.skuMeli)).toBe(true);
    expect(a.avisos.some((x) => x.includes("se tomó como NAVY"))).toBe(true);
  });

  it("686: con dos colores por nombrar no se adivina y el renglón queda en rojo", async () => {
    const r = await leerPedido(readFileSync("fixtures/yz-pedido-686.xls"), "686.xls");
    const catalogo = ["N-686-iPad11-blk", "N-686-iPad11-grey", "N-686-iPad11-navy", "N-686-iPad11-pink", "N-686-iPad11-purple", "N-686-iPad11-red"].map((sku) => ({ sku }));
    const a = amarrarLineasCon(r, catalogo);
    const suelta = a.lineas.find((l) => l.color === "?");
    expect(suelta?.skuMeli).toBeNull();
  });

  it("714: el SKU va sin color, pero si MELI sí lo lleva (714-G05-transparent) se prueba con él", () => {
    const pedido = {
      folio: "1", diseno: "714", fechaPedido: null, avisos: [], unidades: 2,
      lineas: [
        { skuBodega: "714-A37", diseno: "714", modelo: "A37", color: "TRANSPARENT", cantidad: 1, costoUnitario: null },
        { skuBodega: "714-G05", diseno: "714", modelo: "G05", color: "TRANSPARENT", cantidad: 1, costoUnitario: null },
      ],
    };
    const a = amarrarLineasCon(pedido, [{ sku: "714-A37" }, { sku: "714-G05-transparent" }]);
    expect(a.lineas[0]).toMatchObject({ skuBodega: "714-A37", skuMeli: "714-A37" });
    expect(a.lineas[1]).toMatchObject({ skuBodega: "714-G05-TRANSPARENT", skuMeli: "714-G05-transparent" });
  });

  it("514: Rmn14pro-5G amarra con el Pro aunque exista el Pro+ (el + ya no se pierde)", () => {
    const pedido = {
      folio: "1", diseno: "514", fechaPedido: null, avisos: [], unidades: 1,
      lineas: [{ skuBodega: "514-RMN14PRO-5G", diseno: "514", modelo: "RMN14PRO-5G", color: "", cantidad: 1, costoUnitario: null }],
    };
    const a = amarrarLineasCon(pedido, [{ sku: "C-514-Rmn14pro-5G", estado: "paused" }, { sku: "C-514-Rmn14pro+-5G" }, { sku: "C-514-Rmn14pro+5G" }]);
    expect(a.lineas[0].skuMeli).toBe("C-514-Rmn14pro-5G");
  });
});
