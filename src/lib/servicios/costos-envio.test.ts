import { describe, expect, it } from "vitest";
import {
  armarEnviosReales,
  armarRevision,
  sigueCobrandoDeMas,
  claveTarifa,
  dimensionesParaMeli,
  ladosOrdenados,
  medidaDeConsenso,
  medidasDeAtributos,
  numeroDeAtributo,
  puedeCobrarDeMas,
  type VarianteEnvio,
} from "./costos-envio";

/**
 * El caso real que destapó esto: el GT229. Quince tallas miden ~27 × 24 × 10
 * cm y su envío cuesta $88.50; dos quedaron mal medidas en Full y cuestan
 * $139.50 y $190. Los números de aquí son los que contestaron MELI y su
 * simulador el 1 de septiembre de 2026.
 */
const GT229: [string, number, number, number, number][] = [
  // sku-corto, alto, ancho, largo, peso
  ["BLK-23", 10, 26, 26, 440],
  ["BLK-24", 10, 20.8, 26.2, 460],
  ["BLK-25", 10.3, 23.7, 27.5, 500],
  ["BLK-26", 7.2, 22.6, 27.4, 600],
  ["BLK-27", 10.2, 25.5, 27.9, 540],
  ["BLK-28", 8.6, 23, 30.6, 600],
  ["DK-23", 10.6, 22, 26.2, 450],
  ["DK-24", 9.8, 24, 25.6, 480],
  ["DK-25", 11.2, 23.8, 27.4, 520],
  ["DK-26", 36.6, 29.4, 11.2, 530], // mal medida: la caja "parada"
  ["DK-27", 9.6, 25, 29.8, 560],
  ["DK-28", 9.8, 24.6, 31.8, 600],
  ["TAB-23", 11.2, 23.4, 29.6, 440],
  ["TAB-24", 25.2, 25.4, 28.4, 480], // mal medida: 25 cm de alto
  ["TAB-25", 9.8, 24.2, 28.6, 520],
  ["TAB-26", 9, 23.6, 27.2, 620],
  ["TAB-27", 10.2, 29.6, 30.2, 560],
  ["TAB-28", 11.6, 23.2, 32.4, 600],
];

function variantesGT229(costos: Record<string, [number, number]> = {}): VarianteEnvio[] {
  return GT229.map(([corto, alto, ancho, largo, peso]) => {
    const [costo, normal] = costos[corto] ?? [88.5, 88.5];
    return {
      sku: `GT229-${corto}-MX`,
      itemId: `MLM${corto}`,
      inventoryId: `INV${corto}`,
      modelo: "GT229",
      color: corto.split("-")[0],
      talla: corto.split("-")[1],
      medida: { alto, ancho, largo, peso },
      fuente: "MEASUREMENT",
      medidaVendedor: null,
      precio: 499,
      tipoPublicacion: "gold_pro",
      envioGratis: true,
      estado: "active",
      costo,
      costoNormal: normal,
      pesoFacturable: null,
    };
  });
}

describe("lectura de los atributos de MELI", () => {
  it("lee el número venga en texto o en value_struct, y el peso siempre en gramos", () => {
    expect(numeroDeAtributo({ id: "PACKAGE_LENGTH", value_name: "26.2 cm" })).toBe(26.2);
    expect(
      numeroDeAtributo({ id: "PACKAGE_WIDTH", value_struct: { number: 20.8, unit: "cm" } }),
    ).toBe(20.8);
    expect(numeroDeAtributo({ id: "PACKAGE_WEIGHT", value_name: "1.2 kg" }, true)).toBe(1200);
    expect(numeroDeAtributo({ id: "PACKAGE_WEIGHT", value_name: "440 g" }, true)).toBe(440);
    expect(numeroDeAtributo(undefined)).toBeNull();
  });

  it("separa las medidas de MELI de las que declaró el vendedor", () => {
    const { medida, medidaVendedor, fuente } = medidasDeAtributos([
      { id: "PACKAGE_HEIGHT", value_name: "10 cm" },
      { id: "PACKAGE_WIDTH", value_name: "26 cm" },
      { id: "PACKAGE_LENGTH", value_name: "26 cm" },
      { id: "PACKAGE_WEIGHT", value_name: "440 g" },
      { id: "PACKAGE_DATA_SOURCE", value_name: "MEASUREMENT" },
      { id: "SELLER_PACKAGE_HEIGHT", value_name: "26 cm" },
      { id: "SELLER_PACKAGE_WIDTH", value_name: "26 cm" },
      { id: "SELLER_PACKAGE_LENGTH", value_name: "10 cm" },
      { id: "SELLER_PACKAGE_WEIGHT", value_name: "440 g" },
    ]);
    expect(medida).toEqual({ alto: 10, ancho: 26, largo: 26, peso: 440 });
    expect(medidaVendedor).toEqual({ alto: 26, ancho: 26, largo: 10, peso: 440 });
    expect(fuente).toBe("MEASUREMENT");
  });

  it("lee el user product, que manda el valor SOLO en values[0] (tal cual contestó MELI el 25-sep-2026)", () => {
    const up = [
      { id: "SELLER_PACKAGE_HEIGHT", name: "Altura del paquete del seller", values: [{ id: null, name: "26 cm", struct: { number: 26, unit: "cm" } }] },
      { id: "SELLER_PACKAGE_LENGTH", values: [{ id: null, name: "10 cm", struct: { number: 10, unit: "cm" } }] },
      { id: "PACKAGE_DATA_SOURCE", values: [{ id: "52228227", name: "MEASUREMENT", struct: null }] },
      { id: "SELLER_PACKAGE_WEIGHT", values: [{ id: null, name: "480 g", struct: { number: 480, unit: "g" } }] },
      { id: "PACKAGE_WEIGHT", values: [{ id: null, name: "480 g", struct: { number: 480, unit: "g" } }] },
      { id: "PACKAGE_LENGTH", values: [{ id: null, name: "28.4 cm", struct: { number: 28.4, unit: "cm" } }] },
      { id: "PACKAGE_HEIGHT", values: [{ id: null, name: "25.2 cm", struct: { number: 25.2, unit: "cm" } }] },
      { id: "SELLER_PACKAGE_WIDTH", values: [{ id: null, name: "21 cm", struct: { number: 21, unit: "cm" } }] },
      { id: "PACKAGE_WIDTH", values: [{ id: null, name: "25.4 cm", struct: { number: 25.4, unit: "cm" } }] },
    ];
    expect(medidasDeAtributos(up)).toEqual({
      medida: { alto: 25.2, ancho: 25.4, largo: 28.4, peso: 480 },
      medidaVendedor: { alto: 26, ancho: 21, largo: 10, peso: 480 },
      fuente: "MEASUREMENT",
    });
    // Y si solo viene el texto, también.
    expect(numeroDeAtributo({ id: "PACKAGE_WEIGHT", values: [{ name: "1.2 kg" }] }, true)).toBe(1200);
  });

  it("una publicación sin medidas completas no inventa ninguna", () => {
    const { medida } = medidasDeAtributos([{ id: "PACKAGE_HEIGHT", value_name: "10 cm" }]);
    expect(medida).toBeNull();
  });
});

describe("comparación entre hermanas", () => {
  it("los ejes permutados son la MISMA caja", () => {
    expect(ladosOrdenados({ alto: 10, ancho: 26, largo: 26, peso: 440 })).toEqual([26, 26, 10]);
    expect(ladosOrdenados({ alto: 26, ancho: 26, largo: 10, peso: 440 })).toEqual([26, 26, 10]);
  });

  it("el consenso es una caja de pantufla, no la promedia con las mal medidas", () => {
    const consenso = medidaDeConsenso(variantesGT229())!;
    // Mediana lado por lado: una caja de pantufla de 27.9 × 23.8 × 10 cm.
    // Ni la de 36.6 cm de alto ni la de 25.2 la mueven, que es justo el punto.
    expect(consenso.largo).toBe(27.9);
    expect(consenso.ancho).toBe(23.8);
    expect(consenso.alto).toBe(10);
    expect(consenso.peso).toBe(520);
  });

  it("sin al menos tres hermanas no hay consenso que valga", () => {
    expect(medidaDeConsenso(variantesGT229().slice(0, 2))).toBeNull();
  });

  it("solo se le pregunta el costo a las cajas que se pasan del consenso", () => {
    const consenso = medidaDeConsenso(variantesGT229())!;
    const caja = (alto: number, ancho: number, largo: number, peso: number) => ({
      alto,
      ancho,
      largo,
      peso,
    });
    // Las dos mal medidas se pasan.
    expect(puedeCobrarDeMas(caja(36.6, 29.4, 11.2, 530), consenso)).toBe(true);
    expect(puedeCobrarDeMas(caja(25.2, 25.4, 28.4, 480), consenso)).toBe(true);
    // La comparación es lado por lado y NO por volumen, a propósito: una caja
    // más chica de volumen pero más larga puede caer en otro escalón de
    // tarifa. Prefiere gastar una llamada de más a dejar pasar un cobro.
    expect(puedeCobrarDeMas(caja(10, 26, 26, 440), consenso)).toBe(true);
    // La que cabe entera dentro del consenso no puede costar más: no se pregunta.
    expect(puedeCobrarDeMas(caja(9, 23, 27, 500), consenso)).toBe(false);
    // Y medio centímetro es ruido de medición, no un error de captura.
    expect(puedeCobrarDeMas(caja(10.3, 24.2, 28.3, 535), consenso)).toBe(false);
  });
});

describe("formato que pide el simulador de MELI", () => {
  it("redondea hacia arriba: con decimales el API contesta 400", () => {
    expect(dimensionesParaMeli({ alto: 10.3, ancho: 23.7, largo: 27.5, peso: 500 })).toBe(
      "11x24x28,500",
    );
    expect(dimensionesParaMeli({ alto: 10, ancho: 26, largo: 26, peso: 440 })).toBe("10x26x26,440");
  });

  it("la clave de la caché junta caja, precio y tipo de publicación", () => {
    expect(claveTarifa({ alto: 10, ancho: 26, largo: 26, peso: 440 }, 499, "gold_pro")).toBe(
      "10x26x26,440|499|gold_pro",
    );
  });
});

describe("revisión del modelo", () => {
  const revision = armarRevision(
    variantesGT229({ "DK-26": [139.5, 88.5], "TAB-24": [190, 88.5] }),
  )[0];

  it("señala exactamente las dos variantes que cobran de más", () => {
    expect(revision.malas.map((v) => v.sku)).toEqual(["GT229-TAB-24-MX", "GT229-DK-26-MX"]);
    expect(revision.malas[0].sobrecosto).toBe(101.5);
    expect(revision.malas[1].sobrecosto).toBe(51);
    expect(revision.sobrecosto).toBe(152.5);
  });

  it("le pone a cada variante la medida real de sus hermanas", () => {
    const mala = revision.malas.find((v) => v.sku === "GT229-DK-26-MX")!;
    expect(mala.medida).toEqual({ alto: 36.6, ancho: 29.4, largo: 11.2, peso: 530 });
    expect(mala.medidaReal).toEqual(revision.medidaReal);
    expect(revision.hermanas).toBe(18);
  });

  it("sin envío gratis el sobrecosto lo paga el comprador: se marca, pero no cuenta como dinero propio", () => {
    const variantes = variantesGT229({ "DK-26": [139.5, 88.5] }).map((v) =>
      v.sku === "GT229-DK-26-MX" ? { ...v, envioGratis: false } : v,
    );
    const revision = armarRevision(variantes)[0];
    expect(revision.malas.map((v) => v.sku)).toEqual(["GT229-DK-26-MX"]);
    expect(revision.malas[0].sobrecosto).toBe(51);
    expect(revision.sobrecosto).toBe(0);
  });
});

/**
 * Lo que manda es lo que MELI COBRÓ de verdad (25-sep-2026, el dueño: «¿por
 * qué simulas y no revisas exactamente?»): la GT229-TABACO BROWN-24 mide
 * 28 × 25 × 25 en MELI y el simulador la marca con $152 contra $76, pero en
 * 26 ventas reales pagó lo mismo que sus hermanas al mismo precio.
 */
describe("ventas reales contra el simulador", () => {
  const base = (sku: string, medida: [number, number, number, number], costo: number): VarianteEnvio => ({
    sku,
    itemId: "MLM1",
    inventoryId: null,
    modelo: "GT229",
    color: "TAB",
    talla: sku.split("-")[2],
    medida: { alto: medida[0], ancho: medida[1], largo: medida[2], peso: medida[3] },
    fuente: "MEASUREMENT",
    medidaVendedor: null,
    precio: 341,
    tipoPublicacion: "gold_special",
    envioGratis: true,
    estado: "active",
    costo,
    costoNormal: 76,
    pesoFacturable: null,
  });
  const lista = [
    base("GT229-TAB-23", [11.2, 23.4, 29.6, 440], 76),
    base("GT229-TAB-24", [25.2, 25.4, 28.4, 480], 152), // "mal medida" según el simulador
    base("GT229-TAB-25", [9.8, 24.2, 28.6, 520], 76),
    base("GT229-TAB-26", [9, 23.6, 27.2, 620], 76),
    base("GT229-TAB-27", [10.2, 29.6, 30.2, 560], 139.5), // "mal medida" según el simulador
  ];
  const real = (
    ordenes: number,
    comparables: number,
    pagadoDeMas: number,
    ultimos: [number, number | null][],
    ordenesDeMas = pagadoDeMas > 0 ? 2 : 0,
  ) => ({
    ordenes,
    unidades: ordenes,
    mediana: 67.6,
    comparables,
    ordenesDeMas,
    pagadoDeMas,
    deMasPorVenta: 0,
    ultimos: ultimos.map(([envio, normal]) => ({ fecha: "2026-09-24", total: 222.25, envio, normal, hermanas: 12 })),
  });

  it("con ventas comparables manda lo real: la 24 no cobra de más, la 27 sin ventas queda por el simulador", () => {
    const reales = new Map([
      ["GT229-TAB-24", real(26, 25, 0, [[59.6, 59.6], [67.6, 67.6]])],
      ["GT229-TAB-23", real(6, 6, 0, [[67.6, 67.6], [76, 76]])],
    ]);
    const [m] = armarRevision(lista, reales);
    expect(m.malas.map((v) => v.sku)).toEqual(["GT229-TAB-27"]); // la 24 ya no
    const v24 = m.variantes.find((v) => v.sku === "GT229-TAB-24")!;
    expect(v24.conVentas).toBe(true);
    expect(v24.pagadoDeMas).toBe(0);
    expect(v24.sobrecosto).toBe(76); // el simulador la sigue señalando, pero no manda
    expect(v24.envioReal?.ultimos[0]).toMatchObject({ envio: 59.6, normal: 59.6 });
    const v27 = m.variantes.find((v) => v.sku === "GT229-TAB-27")!;
    expect(v27.conVentas).toBe(false);
    expect(v27.envioReal).toBeNull();
    expect(m.pagadoDeMas).toBe(0);
  });

  it("una que de verdad SIGUE pagando de más entra por lo real, aunque el simulador diga que está bien", () => {
    const reales = new Map([["GT229-TAB-25", real(8, 8, 123.4, [[193, 152], [193, 152]])]]);
    const [m] = armarRevision(lista, reales);
    expect(m.malas.map((v) => v.sku)).toEqual(["GT229-TAB-25", "GT229-TAB-24", "GT229-TAB-27"]);
    expect(m.malas[0].pagadoDeMas).toBe(123.4);
    expect(m.pagadoDeMas).toBe(123.4);
  });

  it("una que MELI ya corrigió no se señala: sus dos últimos pedidos pagan lo normal, lo de antes es historial", () => {
    // GT229-TABACO BROWN-26 real: $111.60 hasta el 3-sep, $76 desde el 16-sep.
    const reales = new Map([["GT229-TAB-26", real(10, 10, 71.2, [[76, 76], [76, 76]], 2)]]);
    const [m] = armarRevision(lista, reales);
    expect(m.malas.map((v) => v.sku)).not.toContain("GT229-TAB-26");
    expect(m.variantes.find((v) => v.sku === "GT229-TAB-26")!.pagadoDeMas).toBe(71.2); // el dinero sí se enseña
  });

  it("un solo pedido con envío doble no señala la talla: suele ser un carrito a medias", () => {
    const reales = new Map([["GT229-TAB-25", real(8, 8, 39, [[78, 39], [39, 39]], 1)]]);
    const [m] = armarRevision(lista, reales);
    expect(m.malas.map((v) => v.sku)).not.toContain("GT229-TAB-25");
    expect(sigueCobrandoDeMas(reales.get("GT229-TAB-25")!)).toBe(false);
    expect(sigueCobrandoDeMas(null)).toBe(false);
    expect(sigueCobrandoDeMas(real(2, 2, 78, [[78, 39], [78, 39]]))).toBe(true);
    // Un pedido sin hermana a ese precio no prueba nada.
    expect(sigueCobrandoDeMas(real(2, 1, 39, [[78, null], [78, 39]]))).toBe(false);
  });

  it("con una sola venta comparable no hay veredicto real: sigue el simulador", () => {
    const reales = new Map([["GT229-TAB-24", real(1, 1, 0, [[67.6, 67.6]])]]);
    const [m] = armarRevision(lista, reales);
    expect(m.malas.map((v) => v.sku)).toContain("GT229-TAB-24");
    expect(m.variantes.find((v) => v.sku === "GT229-TAB-24")!.conVentas).toBe(false);
  });

  it("arma el mapa con lo que contesta el RPC", () => {
    const mapa = armarEnviosReales([
      {
        sku: "A",
        ordenes: 3,
        unidades: 3,
        mediana: "67.6",
        comparables: 2,
        ordenes_de_mas: 1,
        pagado_de_mas: "41",
        de_mas_por_venta: null,
        ultimos: [{ fecha: "2026-09-24", total: 499, envio: 193, normal: 152, hermanas: 4 }],
      },
    ]);
    expect(mapa.get("A")).toEqual({
      ordenes: 3,
      unidades: 3,
      mediana: 67.6,
      comparables: 2,
      ordenesDeMas: 1,
      pagadoDeMas: 41,
      deMasPorVenta: null,
      ultimos: [{ fecha: "2026-09-24", total: 499, envio: 193, normal: 152, hermanas: 4 }],
    });
  });
});
