import { describe, expect, it } from "vitest";
import {
  cuerpoDeActividad,
  lotesDeProductos,
  ordenarOfertas,
  precioDeNivel,
  productosParaOferta,
  resumirActividad,
  tituloDeOferta,
  topeParaTikTok,
  ventanaDeOferta,
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
