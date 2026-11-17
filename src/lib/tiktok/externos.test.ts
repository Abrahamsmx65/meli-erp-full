import { describe, expect, it } from "vitest";
import {
  amarreDeExterno,
  agruparPublicaciones,
  clavesDeVendedores,
  coincidePublicacion,
  fichaDeVendedor,
  llevaPrefijoDeVendedor,
  mismoVendedor,
  nombreDeVendedor,
  normalizarVendedor,
  partirPorVendedor,
  pedidosDeVendedor,
  publicacionesSinPrefijo,
  sinSkusExternos,
  sinVentasExternas,
  vendedorDePedido,
} from "./externos";

const externos = new Map([
  ["SH-001-M", "david"],
  ["SH-002-L", "david"],
]);

describe("de quién es cada pedido", () => {
  it("un pedido con algún par externo es del vendedor externo, aunque sea mixto", () => {
    expect(vendedorDePedido([{ sku: "GT148-BLK-24-MX" }, { sku: "SH-001-M" }], externos)).toBe("david");
    expect(vendedorDePedido([{ sku: "GT148-BLK-24-MX" }], externos)).toBeNull();
    expect(vendedorDePedido([], externos)).toBeNull();
  });

  it("reparte los pendientes y filtra por vendedor", () => {
    const renglones = new Map<string, { sku: string }[]>([
      ["A", [{ sku: "GT148-BLK-24-MX" }]],
      ["B", [{ sku: "SH-001-M" }]],
      ["C", [{ sku: "GT148-BLK-24-MX" }, { sku: "SH-002-L" }]],
      ["D", []],
    ]);
    const de = partirPorVendedor(renglones, externos);
    const pendientes = ["A", "B", "C", "D"].map((orderId) => ({ orderId }));
    expect(pedidosDeVendedor(pendientes, de, null).map((p) => p.orderId)).toEqual(["A", "D"]);
    expect(pedidosDeVendedor(pendientes, de, "david").map((p) => p.orderId)).toEqual(["B", "C"]);
  });

  it("normaliza la clave del vendedor y compara filtros", () => {
    expect(normalizarVendedor("David")).toBe("david");
    expect(normalizarVendedor("otro")).toBeNull();
    expect(normalizarVendedor(undefined)).toBeNull();
    expect(mismoVendedor(null, undefined)).toBe(true);
    expect(mismoVendedor("david", null)).toBe(false);
  });

  it("quita los SKUs externos de una lista", () => {
    expect(sinSkusExternos([{ sku: "SH-001-M" }, { sku: "GT1" }], externos)).toEqual([{ sku: "GT1" }]);
    expect(sinSkusExternos([{ sku: "SH-001-M" }], new Map())).toHaveLength(1);
  });
});

describe("ventas sin lo externo", () => {
  const ordenes = [
    { orderId: "solo-dueno", estado: "COMPLETED", creadoEn: "2026-10-10T10:00:00Z", pagoEsperado: 100, afiliado: 4 },
    { orderId: "solo-david", estado: "COMPLETED", creadoEn: "2026-10-10T10:00:00Z", pagoEsperado: 200, afiliado: 8 },
    { orderId: "mixto", estado: "COMPLETED", creadoEn: "2026-10-10T10:00:00Z", netoRecibido: 300, afiliado: 12, desglose: { comision: 30, envio: 15 } },
  ];
  const renglones = [
    { orderId: "solo-dueno", skuInterno: "GT148-BLK-24-MX", cantidad: 1, precio: 100, estado: "COMPLETED" },
    { orderId: "solo-david", skuInterno: "SH-001-M", cantidad: 2, precio: 100, estado: "COMPLETED" },
    { orderId: "mixto", skuInterno: "GT148-BLK-24-MX", cantidad: 1, precio: 100, estado: "COMPLETED" },
    { orderId: "mixto", skuInterno: "SH-002-L", cantidad: 1, precio: 300, estado: "COMPLETED" },
  ];

  it("saca el pedido solo externo y recorta el mixto a la parte del dueño por precio", () => {
    const r = sinVentasExternas(ordenes, renglones, externos);
    expect(r.ordenes.map((o) => o.orderId)).toEqual(["solo-dueno", "mixto"]);
    const mixto = r.ordenes[1] as any;
    expect(mixto.netoRecibido).toBeCloseTo(75);
    expect(mixto.afiliado).toBeCloseTo(3);
    expect(mixto.desglose.comision).toBeCloseTo(7.5);
    expect(mixto.desglose.envio).toBeCloseTo(3.75);
    expect(r.renglones.map((x) => x.skuInterno)).toEqual(["GT148-BLK-24-MX", "GT148-BLK-24-MX"]);
    // El pedido del dueño no se toca.
    expect(r.ordenes[0]).toBe(ordenes[0]);
  });

  it("sin precios reparte por pares; sin externos devuelve todo igual", () => {
    const sinPrecio = [
      { orderId: "mixto", skuInterno: "GT148-BLK-24-MX", cantidad: 1, precio: null, estado: "COMPLETED" },
      { orderId: "mixto", skuInterno: "SH-002-L", cantidad: 3, precio: null, estado: "COMPLETED" },
    ];
    const r = sinVentasExternas([ordenes[2]], sinPrecio, externos);
    expect((r.ordenes[0] as any).netoRecibido).toBeCloseTo(75);
    const igual = sinVentasExternas(ordenes, renglones, new Map());
    expect(igual.ordenes).toBe(ordenes);
  });
});

describe("nombre del kardex de un SKU externo", () => {
  it("sin amarre, una publicación de David usa su seller_sku tal cual (con su «D-»)", () => {
    const r = amarreDeExterno(" D-GT074-BLK-24-MX ", { skuInterno: null, origen: null }, true);
    expect(r).toEqual({ skuInterno: "D-GT074-BLK-24-MX", origen: "externo" });
  });
  it("lo que sí amarró se respeta, y una publicación del dueño no cambia", () => {
    const amarrado = { skuInterno: "GT146-BLK-23-MX", origen: "exacto" as const };
    expect(amarreDeExterno("GT146-BLK-23-MX", amarrado, true)).toBe(amarrado);
    const nada = { skuInterno: null, origen: null };
    expect(amarreDeExterno("D-GT074-BLK-24-MX", nada, false)).toBe(nada);
    expect(amarreDeExterno("   ", nada, true)).toBe(nada);
  });
});

describe("publicaciones para ligar", () => {
  const skus = [
    { productId: "p1", sellerSku: "GT148-BLK-24-MX", titulo: "Botas GT148", estado: "ACTIVATE" },
    { productId: "p1", sellerSku: "GT148-BLK-25-MX", titulo: "Botas GT148", estado: "ACTIVATE" },
    { productId: "p2", sellerSku: "SH-001-M", titulo: "Blusa Shein", estado: "ACTIVATE" },
  ];
  it("agrupa por publicación, las ligadas primero, y busca por pedazos", () => {
    const lista = agruparPublicaciones(skus, new Map([["p2", "david"]]));
    expect(lista.map((p) => p.productId)).toEqual(["p2", "p1"]);
    expect(lista[1].skus).toBe(2);
    expect(lista[0].vendedor).toBe("david");
    expect(coincidePublicacion(lista[1], "gt148 botas")).toBe(true);
    expect(coincidePublicacion(lista[1], "shein")).toBe(false);
    expect(coincidePublicacion(lista[0], "sh-001")).toBe(true);
  });
});

describe("saldos: segundo vendedor externo con prefijo «S-»", () => {
  it("la clave saldos existe, se normaliza y tiene su nombre y su ruta", () => {
    expect(normalizarVendedor("Saldos")).toBe("saldos");
    expect(nombreDeVendedor("saldos")).toBe("Saldos");
    expect(fichaDeVendedor("saldos")).toMatchObject({ ruta: "/tiktok/saldos", prefijo: "S-", persona: false });
    expect(fichaDeVendedor("david")).toMatchObject({ ruta: "/tiktok/externos", prefijo: "D-", persona: true });
    expect(fichaDeVendedor(null)).toBeNull();
    expect(clavesDeVendedores()).toEqual(["david", "saldos"]);
  });

  it("un pedido con un par de saldos es de saldos, y uno con David y saldos es del primero que aparece", () => {
    const externos = new Map([
      ["S-GT114-BLK-24-MX", "saldos"],
      ["D-GT074-BLK-24-MX", "david"],
    ]);
    expect(vendedorDePedido([{ sku: "GT148-BLK-24-MX" }, { sku: "S-GT114-BLK-24-MX" }], externos)).toBe("saldos");
    expect(vendedorDePedido([{ sku: "GT148-BLK-24-MX" }], externos)).toBeNull();
    const de = partirPorVendedor(new Map([["A", [{ sku: "S-GT114-BLK-24-MX" }]], ["B", [{ sku: "D-GT074-BLK-24-MX" }]], ["C", [{ sku: "GT1" }]]]), externos);
    const pendientes = ["A", "B", "C"].map((orderId) => ({ orderId }));
    expect(pedidosDeVendedor(pendientes, de, "saldos").map((p) => p.orderId)).toEqual(["A"]);
    expect(pedidosDeVendedor(pendientes, de, "david").map((p) => p.orderId)).toEqual(["B"]);
    expect(pedidosDeVendedor(pendientes, de, null).map((p) => p.orderId)).toEqual(["C"]);
  });

  it("reconoce el prefijo del vendedor sin importar mayúsculas", () => {
    expect(llevaPrefijoDeVendedor("saldos", "S-GT114-BLK-24-MX")).toBe(true);
    expect(llevaPrefijoDeVendedor("saldos", " s-gt114-blk-24-mx")).toBe(true);
    expect(llevaPrefijoDeVendedor("saldos", "GT114-BLK-24-MX")).toBe(false);
    expect(llevaPrefijoDeVendedor("saldos", "SH-001-M")).toBe(false);
    expect(llevaPrefijoDeVendedor("david", "D-GT074-BLK-24-MX")).toBe(true);
    expect(llevaPrefijoDeVendedor("david", "S-GT074-BLK-24-MX")).toBe(false);
    expect(llevaPrefijoDeVendedor("saldos", null)).toBe(false);
  });

  it("señala las publicaciones ligadas cuyos SKU no llevan el prefijo", () => {
    const lista = agruparPublicaciones(
      [
        { productId: "1", sellerSku: "S-GT114-BLK-24-MX", titulo: "Saldo GT114", estado: "ACTIVATE" },
        { productId: "2", sellerSku: "GT125-BLK-24-MX", titulo: "GT125 sin prefijo", estado: "ACTIVATE" },
        { productId: "3", sellerSku: "GT130-BLK-24-MX", titulo: "Del dueño", estado: "ACTIVATE" },
        { productId: "4", sellerSku: "D-GT074-BLK-24-MX", titulo: "De David", estado: "ACTIVATE" },
      ],
      new Map([
        ["1", "saldos"],
        ["2", "saldos"],
        ["4", "david"],
      ]),
    );
    expect(publicacionesSinPrefijo(lista, "saldos").map((p) => p.productId)).toEqual(["2"]);
    expect(publicacionesSinPrefijo(lista, "david")).toEqual([]);
  });
});
