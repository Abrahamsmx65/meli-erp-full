import { describe, expect, it } from "vitest";
import { interpretarLives, interpretarProductosDeLive, pedidosDelLive, resumenLives } from "./lives";

const m = (amount: number) => ({ amount: String(amount), currency: "MXN" });

const crudoLives = {
  data: {
    latest_available_date: "2026-11-12",
    total_count: 2,
    next_page_token: "p2",
    live_stream_sessions: [
      {
        id: "L1",
        title: "Botas de temporada",
        start_time: "1794481200", // 2026-11-12 11:00:00Z
        end_time: "1794488400", // 2026-11-12 13:00:00Z
        creator: { nick_name: "GETAC", user_name: "getac.mx", author_type: "OFFICIAL" },
        sales_performance: {
          live_attributed_gmv: m(3500.7),
          live_gmv: m(3000),
          live_indirect_gmv: m(500.7),
          live_attributed_orders: 12,
          live_attributed_sku_orders: 13,
          live_attributed_items_sold: 14,
          attributed_customers: 11,
          products_sold: 4,
          payment_rate: "0.9",
          aov: m(291.72),
        },
        traffic: { viewers: 820, views: 1300, pcu: 45, acu: 20, avg_viewing_duration_per_viewer: 95, impressions: 9000, product_clicks: 210, product_impressions: 3000, ctr: "0.16", watch_gpm: m(2693), gmv_per_hour: m(1750), products_added: 9 },
        interaction_performance: { likes: 500, comments: 60, shares: 7, new_followers: 15 },
      },
      { id: "", title: "sin id" },
    ],
  },
};

describe("interpretarLives", () => {
  it("una sesión por live con sus ventas, tráfico e interacción; la hora en ISO y la duración en minutos", () => {
    const r = interpretarLives(crudoLives, "OFFICIAL_ACCOUNTS");
    expect(r.lives).toHaveLength(1);
    expect(r.siguiente).toBe("p2");
    expect(r.total).toBe(2);
    const l = r.lives[0];
    expect(l).toMatchObject({ liveId: "L1", titulo: "Botas de temporada", cuentaTipo: "OFFICIAL_ACCOUNTS", creador: { nombre: "GETAC", usuario: "getac.mx" } });
    expect(l.inicio).toBe("2026-11-12T11:00:00.000Z");
    expect(l.fin).toBe("2026-11-12T13:00:00.000Z");
    expect(l.duracionMin).toBe(120);
    expect(l.ventas).toMatchObject({ gmv: 3500.7, gmvDirecto: 3000, gmvIndirecto: 500.7, pedidos: 12, piezas: 14, clientes: 11, productosVendidos: 4, productosAgregados: 9, tasaPago: 0.9, ticketPromedio: 291.72 });
    expect(l.trafico).toMatchObject({ espectadores: 820, vistas: 1300, pico: 45, promedioConcurrentes: 20, duracionPromedioVista: 95, clicsProducto: 210, ctr: 0.16, gpm: 2693, gmvPorHora: 1750 });
    expect(l.interaccion).toEqual({ likes: 500, comentarios: 60, compartidos: 7, seguidoresNuevos: 15 });
  });
  it("sin forma contesta vacío", () => {
    expect(interpretarLives(null, "OFFICIAL_ACCOUNTS").lives).toEqual([]);
    expect(interpretarLives({ data: {} }, "OFFICIAL_ACCOUNTS").siguiente).toBeUndefined();
  });
});

describe("interpretarProductosDeLive", () => {
  it("lo vendido por producto, de más a menos GMV, con clics aunque TikTok los escriba mal", () => {
    const r = interpretarProductosDeLive({
      data: {
        products: [
          { id: "P2", name: "GT114", sales: { direct_gmv: m(200), items_sold: 1, sku_orders: 1, main_orders: 1, customers: 1, avg_price: m(200) }, traffic: { product_impressions: 100, produt_clicks: 9, ctr: "0.09", add_to_cart_count: 2 } },
          { id: "P1", name: "GT150", sales: { direct_gmv: m(2800), items_sold: 10, sku_orders: 9, main_orders: 8, customers: 8, avg_price: m(280) }, traffic: { product_impressions: 2000, product_clicks: 150, ctr: "0.075" } },
          { id: "", name: "nada" },
        ],
      },
    });
    expect(r.map((p) => p.productId)).toEqual(["P1", "P2"]);
    expect(r[0]).toMatchObject({ nombre: "GT150", piezas: 10, gmv: 2800, pedidos: 8, clics: 150, ctr: 0.075, alCarrito: 0 });
    expect(r[1]).toMatchObject({ clics: 9, alCarrito: 2 });
  });
});

describe("pedidosDelLive", () => {
  const live = { inicio: "2026-11-12T11:00:00Z", fin: "2026-11-12T13:00:00Z" };
  const ordenes = [
    { orderId: "a", estado: "AWAITING_SHIPMENT", creadoEn: "2026-11-12T11:30:00Z", creador: null, afiliadoLeido: true, pagoEsperado: 240, netoRecibido: null, ingresoTikTok: 300 },
    { orderId: "b", estado: "COMPLETED", creadoEn: "2026-11-12T13:20:00Z", creador: null, afiliadoLeido: true, pagoEsperado: null, netoRecibido: null }, // en el margen, sin dato
    { orderId: "c", estado: "COMPLETED", creadoEn: "2026-11-12T13:40:00Z", creador: null, afiliadoLeido: true, pagoEsperado: 100 }, // fuera del margen
    { orderId: "d", estado: "COMPLETED", creadoEn: "2026-11-12T12:00:00Z", creador: "ana", afiliadoLeido: true, pagoEsperado: 100 }, // de creadora
    { orderId: "e", estado: "COMPLETED", creadoEn: "2026-11-12T12:10:00Z", creador: null, afiliadoLeido: false, pagoEsperado: 100 }, // sin revisar
    { orderId: "f", estado: "CANCELLED", creadoEn: "2026-11-12T12:20:00Z", creador: null, afiliadoLeido: true, pagoEsperado: 100 },
    { orderId: "g", estado: "COMPLETED", creadoEn: "2026-11-12T12:30:00Z", creador: null, afiliadoLeido: true, esMuestra: true },
    { orderId: "h", estado: "COMPLETED", creadoEn: "2026-11-12T12:40:00Z", creador: null, afiliadoLeido: true, pagoEsperado: 150 }, // sin costo
  ];
  const renglones = [
    { orderId: "a", skuInterno: "GT150-BLK-24-MX", cantidad: 1, precio: 300, estado: "AWAITING_SHIPMENT" },
    { orderId: "a", skuInterno: "GT150-BLK-25-MX", cantidad: 1, precio: 300, estado: "CANCELLED" },
    { orderId: "b", skuInterno: "GT114-BLK-24-MX", cantidad: 2, precio: 200, estado: "COMPLETED" },
    { orderId: "c", skuInterno: "GT114-BLK-24-MX", cantidad: 1, precio: 200, estado: "COMPLETED" },
    { orderId: "d", skuInterno: "GT114-BLK-24-MX", cantidad: 1, precio: 200, estado: "COMPLETED" },
    { orderId: "e", skuInterno: "GT114-BLK-24-MX", cantidad: 1, precio: 200, estado: "COMPLETED" },
    { orderId: "f", skuInterno: "GT114-BLK-24-MX", cantidad: 1, precio: 200, estado: "CANCELLED" },
    { orderId: "g", skuInterno: "GT114-BLK-24-MX", cantidad: 1, precio: 0, estado: "COMPLETED" },
    { orderId: "h", skuInterno: "GT999-BLK-24-MX", cantidad: 1, precio: 250, estado: "COMPLETED" },
  ];
  const costos = new Map([["GT150", 120], ["GT114", 90]]);

  it("toma solo los pedidos de la tienda en la ventana (más el margen), con lo que paga TikTok, su costo y la ganancia", () => {
    const r = pedidosDelLive(ordenes, renglones, live, costos);
    expect(r.ventana).toEqual({ desde: "2026-11-12T11:00:00.000Z", hasta: "2026-11-12T13:30:00.000Z", minutosDespues: 30 });
    expect(r.pedidos.map((p) => p.orderId)).toEqual(["a", "h", "b"]);
    const a = r.pedidos[0];
    expect(a).toMatchObject({ pares: 1, cobrado: 300, pagaTikTok: 240, costo: 120, ganancia: 120 });
    expect(a.skus).toEqual([{ sku: "GT150-BLK-24-MX", cantidad: 1 }]);
    const b = r.pedidos[2];
    expect(b).toMatchObject({ pares: 2, cobrado: 400, pagaTikTok: null, costo: 180, ganancia: null });
    const h = r.pedidos[1];
    expect(h).toMatchObject({ pagaTikTok: 150, costo: null, ganancia: null });
  });
  it("los totales separan sin dato, sin costo, sin revisar y de creadores", () => {
    const { totales } = pedidosDelLive(ordenes, renglones, live, costos);
    expect(totales).toEqual({
      pedidos: 3, pares: 4, cobrado: 950, pagaTikTok: 390, pedidosSinDato: 1, costo: 120, ganancia: 120, pedidosConGanancia: 1, pedidosSinCosto: 1, sinRevisar: 1, deCreadores: 1,
    });
  });
  it("sin margen el pedido de después del live no entra", () => {
    const r = pedidosDelLive(ordenes, renglones, live, costos, 0);
    expect(r.pedidos.map((p) => p.orderId)).toEqual(["a", "h"]);
  });
});

describe("resumenLives", () => {
  it("suma las sesiones y la ganancia de los pedidos guardados; un live sin pedidos calculados se cuenta aparte", () => {
    const sesion = interpretarLives(crudoLives, "OFFICIAL_ACCOUNTS").lives[0];
    const pedidos = pedidosDelLive(
      [{ orderId: "a", estado: "COMPLETED", creadoEn: "2026-11-12T11:30:00Z", creador: null, afiliadoLeido: true, pagoEsperado: 240 }],
      [{ orderId: "a", skuInterno: "GT150-BLK-24-MX", cantidad: 1, precio: 300, estado: "COMPLETED" }],
      { inicio: sesion.inicio!, fin: sesion.fin! },
      new Map([["GT150", 120]]),
    );
    const r = resumenLives([
      { sesion, pedidos },
      { sesion: { ...sesion, liveId: "L2", duracionMin: 30, trafico: { ...sesion.trafico, pico: 99, espectadores: 10 } }, pedidos: null },
    ]);
    expect(r).toMatchObject({ lives: 2, minutos: 150, gmv: 7001.4, pedidosTikTok: 24, piezas: 28, espectadores: 830, picoMaximo: 99, ganancia: 120, pagaTikTok: 240, pedidosTienda: 1, livesSinPedidos: 1 });
  });
});
