import { describe, expect, it } from "vitest";
import { interpretarFuentes, sumarFuentes, ventanasPorLeer } from "./fuentes-venta";

const m = (amount: number) => ({ amount: String(amount), currency: "MXN" });

const crudo = {
  latest_available_date: "2026-11-03",
  performance: {
    intervals: [
      {
        start_date: "2026-11-02",
        end_date: "2026-11-03",
        sales: {
          gmv: m(10000),
          live_gmv: m(5000),
          video_gmv: m(2000),
          product_card_attributed_gmv: m(1500),
          seller_live_gmv: m(1000),
          creator_live_gmv: m(4000),
          seller_video_gmv: m(500),
          creator_video_gmv: m(1500),
          orders_count: 40,
          items_sold: 45,
          refunds: m(120.5),
        },
        breakdowns: {
          seller_product_card_gmv: m(1200),
          affiliate_product_card_attributed_gmv: m(300),
          shop_tab_and_search: { search_attributed: m(800), shop_tab_attributed: m(200), others: m(500) },
        },
      },
      {
        start_date: "2026-11-01",
        end_date: "2026-11-02",
        sales: { gmv: m(1000), live_gmv: m(1000), orders_count: 4, items_sold: 4 },
        breakdowns: {},
      },
      { start_date: null, sales: { gmv: m(99) } },
    ],
  },
};

describe("interpretarFuentes", () => {
  it("un renglón por día, ordenado, con cada fuente y lo nuestro contra lo de creadores", () => {
    const dias = interpretarFuentes(crudo);
    expect(dias.map((d) => d.fecha)).toEqual(["2026-11-01", "2026-11-02"]);
    const d = dias[1];
    expect(d).toMatchObject({
      gmv: 10000,
      live: 5000,
      video: 2000,
      tarjeta: 1500,
      buscador: 800,
      pestanaTienda: 200,
      otros: 1500,
      vendedor: { live: 1000, video: 500, tarjeta: 1200 },
      creadores: { live: 4000, video: 1500, tarjeta: 300 },
      pedidos: 40,
      piezas: 45,
    });
    expect(d.crudo.refunds).toBe(120.5);
    expect(d.crudo.orders_count).toBe(40);
  });
  it("lo que TikTok no manda es cero y «otros» nunca es negativo", () => {
    const d = interpretarFuentes(crudo)[0];
    expect(d).toMatchObject({ gmv: 1000, live: 1000, video: 0, tarjeta: 0, otros: 0, vendedor: { live: 0, video: 0, tarjeta: 0 } });
  });
  it("también acepta la respuesta con `data` adentro y sin forma contesta vacío", () => {
    expect(interpretarFuentes({ data: crudo })).toHaveLength(2);
    expect(interpretarFuentes(null)).toEqual([]);
    expect(interpretarFuentes({ performance: {} })).toEqual([]);
  });
});

describe("sumarFuentes", () => {
  it("suma los días y saca el % de cada fuente sobre el GMV, sin las vacías", () => {
    const r = sumarFuentes(interpretarFuentes(crudo));
    expect(r.gmv).toBe(11000);
    expect(r.pedidos).toBe(44);
    expect(r.dias).toBe(2);
    expect(r.desde).toBe("2026-11-01");
    expect(r.hasta).toBe("2026-11-02");
    expect(r.fuentes.map((f) => [f.clave, f.monto])).toEqual([
      ["live", 6000],
      ["video", 2000],
      ["tarjeta", 1500],
      ["otros", 1500],
    ]);
    expect(r.tarjetaNuestra).toEqual({ buscador: 800, pestanaTienda: 200 });
    expect(r.fuentes[0].porcentaje).toBeCloseTo(54.55, 1);
    expect(r.vendedor).toEqual({ live: 1000, video: 500, tarjeta: 1200 });
    // el día 1 solo trae live_gmv sin reparto: no se le inventa canal
    expect(r.creadores).toEqual({ live: 4000, video: 1500, tarjeta: 300 });
  });
  it("«otros» sale del GMV menos live, video y tarjeta, aunque el renglón guardado diga otra cosa", () => {
    const d = { ...interpretarFuentes(crudo)[1], otros: 500 };
    const r = sumarFuentes([d]);
    expect(r.fuentes.find((f) => f.clave === "otros")?.monto).toBe(1500);
  });
  it("sin días todo es cero", () => {
    const r = sumarFuentes([]);
    expect(r).toMatchObject({ gmv: 0, fuentes: [], dias: 0, desde: null, hasta: null });
  });
});

describe("ventanasPorLeer", () => {
  it("siempre los últimos días hasta mañana, y hacia atrás tramos desde lo más viejo guardado", () => {
    const v = ventanasPorLeer("2026-11-04", ["2026-10-20", "2026-11-03"], { recientes: 4, fondo: "2026-09-01", diasPorTramo: 30, tramos: 3 });
    expect(v).toEqual([
      { desde: "2026-11-01", hasta: "2026-11-05", esFondo: false },
      { desde: "2026-09-20", hasta: "2026-10-20", esFondo: true },
      { desde: "2026-09-01", hasta: "2026-09-20", esFondo: true },
    ]);
  });
  it("sin nada guardado el fondo arranca donde termina la ventana reciente", () => {
    const v = ventanasPorLeer("2026-11-04", [], { recientes: 4, fondo: "2026-10-20", diasPorTramo: 30, tramos: 3 });
    expect(v).toEqual([
      { desde: "2026-11-01", hasta: "2026-11-05", esFondo: false },
      { desde: "2026-10-20", hasta: "2026-11-01", esFondo: true },
    ]);
  });
  it("con la historia completa solo queda la ventana reciente", () => {
    const v = ventanasPorLeer("2026-11-04", ["2026-09-01"], { recientes: 2, fondo: "2026-09-01" });
    expect(v).toEqual([{ desde: "2026-11-03", hasta: "2026-11-05", esFondo: false }]);
  });
});
