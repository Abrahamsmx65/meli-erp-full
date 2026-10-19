import { describe, expect, it } from "vitest";
import {
  cuerpoDeActividad,
  horasDeCiclica,
  lotesDeProductos,
  ordenarOfertas,
  precioDeNivel,
  preciosDeDetalle,
  productosParaOferta,
  relampagosDeActividad,
  resumirActividad,
  tituloDeCiclica,
  tituloDeOferta,
  topeParaTikTok,
  ultimaRelampago,
  ventanaDeOferta,
  ventanasQueFaltan,
  explicarErrorDeCiclica,
  VENTANAS_ADELANTE,
  ventanasVivasDeRelampagos,
} from "./promociones";

const sku = (skuId: string, productId: string, sellerSku: string, estado = "ACTIVATE", precio: number | null = 499) => ({
  skuId,
  productId,
  sellerSku,
  skuInterno: sellerSku,
  estado,
  precio,
});

describe("productosParaOferta", () => {
  it("un producto activo por modelo, el de más variantes, con su precio de lista más común", () => {
    const p = productosParaOferta(
      [
        sku("s1", "P1", "GT148-BLK-24-MX"),
        sku("s2", "P1", "GT148-BLK-25-MX"),
        sku("s3", "P9", "GT148-CREAM-24-MX", "ACTIVATE", 450),
        sku("s4", "P2", "GT125-BLK-24-MX", "DRAFT"),
        sku("s5", "P3", "GT114-BLK-24-MX", "ACTIVATE", null),
      ],
      new Map([["P1", "Botas GT148"]]),
    );
    expect(p.map((x) => x.modelo)).toEqual(["GT114", "GT148"]);
    expect(p[1]).toMatchObject({ productId: "P1", skuIds: ["s1", "s2"], precioLista: 499, titulo: "Botas GT148" });
    expect(p[0].precioLista).toBeNull();
  });
});

describe("título, ventana y topes", () => {
  it("el título lleva la fecha y hora de México y respeta los 50 caracteres", () => {
    // 2026-10-15 18:00 México = 2026-10-16 00:00 UTC
    const t = tituloDeOferta(new Date("2026-10-16T00:00:00Z"), "normal");
    expect(t).toBe("Relámpago GETAC 15/10 18:00");
    expect(tituloDeOferta(new Date("2026-10-16T00:00:00Z"), "live")).toContain("live");
    expect(tituloDeOferta(new Date("2026-10-16T00:00:00Z"), "campana", "x".repeat(60)).length).toBe(50);
  });

  it("la ventana va en segundos y exige un inicio futuro", () => {
    const ahora = new Date("2026-10-15T20:00:00Z");
    const v = ventanaDeOferta(new Date("2026-10-15T20:15:00Z"), 72, ahora);
    expect(v.beginTime).toBe(Math.floor(Date.parse("2026-10-15T20:15:00Z") / 1000));
    expect(v.endTime - v.beginTime).toBe(72 * 3600);
    expect(() => ventanaDeOferta(new Date("2026-10-15T19:00:00Z"), 72, ahora)).toThrow(/futuro/);
    expect(() => ventanaDeOferta(new Date("2026-10-15T21:00:00Z"), 0, ahora)).toThrow(/duración/);
  });

  it("los topes: 1 a 99, lo demás es sin tope", () => {
    expect(topeParaTikTok(5)).toBe(5);
    expect(topeParaTikTok(99)).toBe(99);
    expect(topeParaTikTok(100)).toBe(-1);
    expect(topeParaTikTok("")).toBe(-1);
    expect(topeParaTikTok(0)).toBe(-1);
  });
});

describe("cuerpo de la actividad y lotes de productos", () => {
  it("arma la actividad relámpago por variante", () => {
    expect(cuerpoDeActividad("  Relámpago  GETAC ", { beginTime: 10, endTime: 20 })).toEqual({
      title: "Relámpago GETAC",
      activity_type: "FLASHSALE",
      product_level: "VARIATION",
      begin_time: 10,
      end_time: 20,
    });
    expect(() => cuerpoDeActividad("  ", { beginTime: 10, endTime: 20 })).toThrow(/título/);
  });

  it("cada variante con su precio y topes; se parte en lotes de 300 variantes", () => {
    const muchos = Array.from({ length: 299 }, (_, i) => `a${i}`);
    const lotes = lotesDeProductos(
      [
        { modelo: "GT148", productId: "P1", precio: 153, skuIds: muchos },
        { modelo: "GT114", productId: "P2", precio: 199.5, skuIds: ["b1", "b2"] },
        { modelo: "GT125", productId: "P3", precio: 180, skuIds: ["c1"] },
      ],
      { porTalla: 50, porComprador: 2 },
    );
    expect(lotes).toHaveLength(2);
    expect((lotes[0][0] as any).skus).toHaveLength(299);
    expect(lotes[0]).toHaveLength(1);
    expect(lotes[1].map((p: any) => p.id)).toEqual(["P2", "P3"]);
    expect((lotes[1][0] as any).skus[0]).toEqual({ id: "b1", activity_price_amount: "199.50", quantity_limit: 50, quantity_per_user: 2 });
    expect((lotes[1][0] as any).quantity_limit).toBe(-1);
    expect(() => lotesDeProductos([{ modelo: "GT1", productId: "P", precio: 0, skuIds: ["x"] }], { porTalla: -1, porComprador: -1 })).toThrow(/precio/);
    expect(() => lotesDeProductos([], { porTalla: -1, porComprador: -1 })).toThrow(/ningún modelo/);
  });
});

describe("ofertas de TikTok resumidas", () => {
  it("resume una actividad cruda y las ordena: en curso, programadas, lo demás", () => {
    const a = resumirActividad({ activity_id: "A1", title: "Relámpago", activity_type: "FLASHSALE", status: "EXPIRED", begin_time: 1700000000, end_time: 1700259200, products: [{}, {}], activity_commands: ["IMMUTABLE"] });
    expect(a).toMatchObject({ activityId: "A1", estado: "EXPIRED", productos: 2, inmutable: true });
    expect(a.inicio).toBe(new Date(1700000000 * 1000).toISOString());
    const orden = ordenarOfertas([
      { ...a, activityId: "x", estado: "EXPIRED" },
      { ...a, activityId: "y", estado: "NOT_START" },
      { ...a, activityId: "z", estado: "ONGOING" },
    ]);
    expect(orden.map((o) => o.activityId)).toEqual(["z", "y", "x"]);
  });

  it("el precio por nivel sale de Precios para TikTok", () => {
    expect(precioDeNivel({ live: 145, normal: 153, campana: 161 }, "live")).toBe(145);
    expect(precioDeNivel(undefined, "normal")).toBeNull();
    expect(precioDeNivel({ live: 0, normal: 153, campana: 161 }, "live")).toBeNull();
  });
});

describe("relámpagos cíclicos", () => {
  const ahora = new Date("2026-10-15T18:00:00Z");
  const h = 3_600_000;

  it("sin nada vivo arma UNA ventana de 72 h desde ahora + 15 min (TikTok no deja dos a la vez)", () => {
    expect(VENTANAS_ADELANTE).toBe(1);
    const v = ventanasQueFaltan([], 72, ahora);
    expect(v).toHaveLength(1);
    expect(v[0].inicio.toISOString()).toBe("2026-10-15T18:15:00.000Z");
    expect(v[0].fin.getTime() - v[0].inicio.getTime()).toBe(72 * h);
  });

  it("con una ventana corriendo (o programada) no falta nada, aunque esté por terminar", () => {
    const corriendo = { inicio: new Date(ahora.getTime() - 71 * h), fin: new Date(ahora.getTime() + 1 * h) };
    expect(ventanasQueFaltan([corriendo], 72, ahora)).toEqual([]);
    const programada = { inicio: new Date(ahora.getTime() + 5 * h), fin: new Date(ahora.getTime() + 77 * h) };
    expect(ventanasQueFaltan([programada], 72, ahora)).toEqual([]);
  });

  it("una ventana que ya terminó no cuenta: se arranca desde ahora", () => {
    const vieja = { inicio: new Date(ahora.getTime() - 100 * h), fin: new Date(ahora.getTime() - 28 * h) };
    const v = ventanasQueFaltan([vieja], 72, ahora);
    expect(v).toHaveLength(1);
    expect(v[0].inicio.toISOString()).toBe("2026-10-15T18:15:00.000Z");
  });

  it("las horas se topan a 72 y por omisión son 72; con más ventanas pedidas se encadenan desde el fin de la última", () => {
    expect(horasDeCiclica(100)).toBe(72);
    expect(horasDeCiclica(24)).toBe(24);
    expect(horasDeCiclica(null)).toBe(72);
    const corriendo = { inicio: new Date(ahora.getTime() - 10 * h), fin: new Date(ahora.getTime() + 62 * h) };
    const v = ventanasQueFaltan([corriendo], 72, ahora, 3);
    expect(v).toHaveLength(2);
    expect(v[0].inicio.getTime()).toBe(corriendo.fin.getTime());
    expect(v[1].inicio.getTime()).toBe(v[0].fin.getTime());
  });

  it("el error de TikTok se explica en palabras, sin códigos ni rutas", () => {
    const conflicto =
      "Lote 1 de 1 (1 productos): TikTok Shop 17029022 en /promotion/202309/activities/769/products: Resource Conflict. The `product or sku` conflicts with `another ONGOING or NOT_START activity`";
    expect(explicarErrorDeCiclica("GT135", conflicto)).toBe("TikTok ya tiene el GT135 en otra relámpago viva o programada; la cíclica entra cuando termine esa.");
    expect(explicarErrorDeCiclica("GT148", "TikTok Shop 17029004 en /promotion/202309/activities: Resource Already Exists. A promotion name is already in use.")).toMatch(/otro nombre/);
    expect(explicarErrorDeCiclica("GT1", "TikTok Shop 12345 en /promotion/x: Algo raro")).toBe("Algo raro");
  });

  it("el título lleva el modelo y la hora de inicio en México, dentro de 50 caracteres", () => {
    const t = tituloDeCiclica("gt148", new Date("2026-10-16T02:30:00Z"));
    expect(t).toBe("Cíclica GT148 15/10 20:30");
    expect(t.length).toBeLessThanOrEqual(50);
  });
});

describe("relámpagos por producto desde el detalle de la actividad", () => {
  const resumen = { activityId: "A1", titulo: "GT148 13 A 15 OCT", tipo: "FLASHSALE", estado: "ONGOING", nivelProducto: "VARIATION", inicio: "2026-10-14T02:22:00.000Z", fin: "2026-10-17T02:21:00.000Z", productos: 1, inmutable: false };
  const detalle = {
    products: [
      { id: "P148", skus: [{ id: "s1", activity_price: { amount: "162.00" } }, { id: "s2", activity_price: { amount: "162.00" } }, { id: "s3", activity_price: { amount: "180.00" } }] },
      { id: "P150", activity_price: { amount: "199.00" }, skus: [] },
      { id: "P999", skus: [{ id: "s9" }] },
    ],
  };

  it("el precio por producto es el más repetido entre sus variantes, o el del producto si no hay por variante", () => {
    const p = preciosDeDetalle(detalle);
    expect(p.get("P148")).toBe(162);
    expect(p.get("P150")).toBe(199);
    expect(p.get("P999")).toBeNull();
  });

  it("arma un renglón por producto con los datos de la actividad", () => {
    const r = relampagosDeActividad(resumen, detalle);
    expect(r.map((x) => x.productId)).toEqual(["P148", "P150", "P999"]);
    expect(r[0].relampago).toMatchObject({ activityId: "A1", estado: "ONGOING", precio: 162, fin: "2026-10-17T02:21:00.000Z" });
  });

  it("la última relámpago es la viva que termina más tarde; una vencida solo si no hay viva; las vivas se vuelven ventanas", () => {
    const vencida = { activityId: "V", titulo: "v", estado: "EXPIRED", inicio: "2026-10-01T00:00:00.000Z", fin: "2026-10-04T00:00:00.000Z", precio: 150 };
    const enCurso = { ...resumen, activityId: "A1", precio: 162 } as any;
    const programada = { activityId: "A2", titulo: "gt148 16 a 19", estado: "NOT_START", inicio: "2026-10-17T02:22:00.000Z", fin: "2026-10-20T02:20:00.000Z", precio: 170 };
    expect(ultimaRelampago([vencida, enCurso, programada])?.activityId).toBe("A2");
    expect(ultimaRelampago([vencida])?.activityId).toBe("V");
    expect(ultimaRelampago([])).toBeNull();
    const ahora = new Date("2026-10-15T18:00:00Z");
    const ventanas = ventanasVivasDeRelampagos([vencida, enCurso, programada], ahora);
    expect(ventanas).toHaveLength(2);
    // y mientras el GT148 tenga relámpago viva o programada, la cíclica no crea nada
    expect(ventanasQueFaltan(ventanas, 72, ahora)).toEqual([]);
    // en cuanto terminan, arranca
    expect(ventanasQueFaltan(ventanas, 72, new Date("2026-10-20T02:21:00Z"))).toHaveLength(1);
  });
});
