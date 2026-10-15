import { describe, expect, it } from "vitest";
import { armarCorreoDePublicidad, canalConError, compararConAnterior, htmlCorreoPublicidad, paraGuardar } from "./publicidad-correo";
import { filasAmazon, itemsDeGasto, type PublicidadCanal } from "./publicidad-canales";
import { armarRecomendaciones, type FilaPublicidad, type RecomendacionAds } from "./publicidad";

const rec = (modelo: string, accion: RecomendacionAds["accion"]): RecomendacionAds => ({
  modelo,
  accion,
  queHacer: `hacer ${accion}`,
  razon: "porque sí",
});

const fila = (modelo: string, extra: Partial<FilaPublicidad> = {}): FilaPublicidad => ({
  modelo,
  anuncios: 0,
  unidades: 0,
  importe: 0,
  ganancia: null,
  gastoAds: 0,
  ventaAds: 0,
  unidadesAds: 0,
  clicks: 0,
  impresiones: 0,
  costoPorUnidad: null,
  tacos: null,
  gananciaNeta: null,
  ...extra,
});

const canal = (recomendaciones: RecomendacionAds[], extra: Partial<PublicidadCanal> = {}): PublicidadCanal => ({
  recomendaciones,
  gastoAds: 1000,
  tacos: 0.05,
  hasta: "2026-10-10",
  avisos: [],
  ...extra,
});

describe("compararConAnterior", () => {
  it("marca lo nuevo, conserva desde cuándo sigue lo pendiente y saca lo resuelto, por canal", () => {
    const { recomendaciones, resueltas } = compararConAnterior(
      [
        { canal: "meli_calzado", recomendaciones: [rec("GT148", "pausar"), rec("GT190", "activar")] },
        { canal: "amazon", recomendaciones: [rec("GT148", "pausar")] },
      ],
      [
        { canal: "meli_calzado", modelo: "GT148", accion: "pausar", queHacer: "x", desde: "2026-10-05" },
        { canal: "meli_calzado", modelo: "GT114", accion: "bajar", queHacer: "y", desde: "2026-10-08" },
      ],
      "2026-10-12",
    );
    expect(recomendaciones.map((r) => [r.canal, r.modelo, r.nueva, r.desde])).toEqual([
      ["meli_calzado", "GT148", false, "2026-10-05"],
      ["meli_calzado", "GT190", true, "2026-10-12"],
      // El mismo modelo en OTRO canal es otra cosa que hacer.
      ["amazon", "GT148", true, "2026-10-12"],
    ]);
    expect(resueltas.map((r) => r.modelo)).toEqual(["GT114"]);
  });

  it("si cambia la acción del modelo es otra cosa que hacer: sale como nueva", () => {
    const { recomendaciones, resueltas } = compararConAnterior(
      [{ canal: "meli_calzado", recomendaciones: [rec("GT148", "pausar")] }],
      [{ modelo: "GT148", accion: "bajar", queHacer: "x", desde: "2026-10-08" }],
      "2026-10-12",
    );
    expect(recomendaciones[0].nueva).toBe(true);
    expect(resueltas).toHaveLength(1);
  });

  it("un canal que no se leyó no da nada por resuelto", () => {
    const { resueltas } = compararConAnterior(
      [{ canal: "amazon", recomendaciones: [] }],
      [{ canal: "amazon", modelo: "GT148", accion: "pausar", queHacer: "x", desde: "2026-10-08" }],
      "2026-10-12",
      new Set(),
    );
    expect(resueltas).toHaveLength(0);
  });

  it("el primer correo no marca nada como nuevo", () => {
    const { recomendaciones } = compararConAnterior([{ canal: "meli_fundas", recomendaciones: [rec("499", "pausar")] }], null, "2026-10-12");
    expect(recomendaciones[0].nueva).toBe(false);
    expect(paraGuardar(recomendaciones)[0]).toMatchObject({ canal: "meli_fundas", desde: "2026-10-12" });
  });
});

describe("correo de publicidad", () => {
  it("junta los tres canales, cuenta los cambios y los nuevos en el asunto", () => {
    const c = armarCorreoDePublicidad({
      dia: "2026-10-12",
      rango: { desde: "2026-09-28", hasta: "2026-10-11" },
      canales: {
        meli_calzado: canal([rec("GT148", "pausar"), rec("GT190", "activar")]),
        meli_fundas: canal([]),
        amazon: canalConError("No se pudo leer SKU Economics de Amazon: boom"),
      },
      anterior: { dia: "2026-10-08", recomendaciones: [{ canal: "meli_calzado", modelo: "GT148", accion: "pausar", queHacer: "x", desde: "2026-10-08" }] },
    });
    expect(c.secciones.map((s) => s.canal)).toEqual(["meli_calzado", "meli_fundas", "amazon"]);
    const { asunto, html, texto } = htmlCorreoPublicidad(c);
    expect(asunto).toBe("Publicidad: 2 cambios por hacer (1 nuevo) en calzado, fundas y Amazon");
    expect(html).toContain("NUEVO");
    expect(html).toContain("pendiente desde hace 4 días");
    expect(html).toContain("Fundas · Mercado Libre");
    expect(html).toContain("SKU Economics de Amazon: boom");
    expect(texto).toContain("[NUEVO] GT190");
  });

  it("sin cambios lo dice", () => {
    const c = armarCorreoDePublicidad({
      dia: "2026-10-12",
      rango: { desde: "2026-09-28", hasta: "2026-10-11" },
      canales: { meli_calzado: canal([]), meli_fundas: canal([]), amazon: canal([]) },
      anterior: null,
    });
    expect(htmlCorreoPublicidad(c).asunto).toBe("Publicidad: nada que cambiar en calzado, fundas y Amazon");
  });
});

describe("Amazon", () => {
  it("arma filas por modelo con la ganancia ANTES de publicidad", () => {
    const filas = filasAmazon(
      [
        { seller_sku: "GT148-BLK-24-MX", unidades: 10, ventas: 3000, publicidad: 300, neto: 1500, ultima_fecha: "2026-10-08" },
        { seller_sku: "GT148-BLK-25-MX", unidades: 10, ventas: 3000, publicidad: 300, neto: 1500, ultima_fecha: "2026-10-08" },
        { seller_sku: "GT114-NEGRO-25", unidades: 5, ventas: 1000, publicidad: 0, neto: 600, ultima_fecha: "2026-10-08" },
      ],
      (sku) => (sku.startsWith("GT148") ? 100 : null),
    );
    const gt148 = filas.find((f) => f.modelo === "GT148")!;
    // (1500 + 300 − 100 × 10) × 2
    expect(gt148.ganancia).toBe(1600);
    expect(gt148.tacos).toBeCloseTo(0.1);
    expect(filas.find((f) => f.modelo === "GT114")!.ganancia).toBeNull();
    expect([...itemsDeGasto(filas).keys()]).toEqual(["GT148"]);
  });

  it("pausa en FBA lo que gasta con stock corto", () => {
    const filas = filasAmazon([{ seller_sku: "GT148-BLK-24-MX", unidades: 70, ventas: 21000, publicidad: 2000, neto: 10000, ultima_fecha: "2026-10-08" }], () => 100);
    const rs = armarRecomendaciones({ filas, stockDeModelo: new Map([["GT148", 20]]), dias: 14, itemsDeModelo: itemsDeGasto(filas), almacen: "FBA", unidad: "piezas" });
    expect(rs[0]).toMatchObject({ modelo: "GT148", accion: "pausar" });
    expect(rs[0].razon).toContain("piezas");
  });
});

describe("productos nuevos sin anuncio", () => {
  it("sugiere anunciar un producto nuevo con stock aunque venda poco o nada", () => {
    const rs = armarRecomendaciones({
      filas: [fila("GT190", { unidades: 3, importe: 900 }), fila("GT114", { unidades: 3, importe: 900 })],
      stockDeModelo: new Map([
        ["GT190", 400],
        ["GT114", 400],
        ["GT206", 120],
      ]),
      dias: 14,
      itemsDeModelo: new Map(),
      modelosConHistoria: new Set(["GT114"]),
    });
    const nuevos = rs.filter((r) => r.queHacer.includes("producto nuevo")).map((r) => r.modelo);
    expect(nuevos).toEqual(["GT190", "GT206"]);
    // El modelo viejo que vende poco no es candidato (no llega a 1 al día).
    expect(rs.some((r) => r.modelo === "GT114")).toBe(false);
  });

  it("un producto nuevo que ya tiene anuncio no se vuelve a sugerir", () => {
    const rs = armarRecomendaciones({
      filas: [fila("GT190", { unidades: 3, importe: 900, gastoAds: 50 })],
      stockDeModelo: new Map([["GT190", 400]]),
      dias: 14,
      itemsDeModelo: new Map([["GT190", [{ itemId: "MLM1", titulo: null, estado: "active", campanaId: null, compartido: false }]]]),
      modelosConHistoria: new Set(),
    });
    expect(rs.some((r) => r.queHacer.includes("producto nuevo"))).toBe(false);
  });

  it("fundas: la cobertura se mide con su propia vara", () => {
    const filas = [fila("499", { unidades: 140, importe: 14000, gastoAds: 500, ganancia: 5000, tacos: 500 / 14000 })];
    const items = new Map([["499", [{ itemId: "MLM1", titulo: null, estado: "active", campanaId: null, compartido: false }]]]);
    // 100 piezas a 10 al día = 10 días: con la vara del calzado (14) se pausaría.
    const conCalzado = armarRecomendaciones({ filas, stockDeModelo: new Map([["499", 100]]), dias: 14, itemsDeModelo: items });
    const conFundas = armarRecomendaciones({ filas, stockDeModelo: new Map([["499", 100]]), dias: 14, itemsDeModelo: items, coberturaCorta: 5, coberturaLarga: 30 });
    expect(conCalzado[0]?.accion).toBe("pausar");
    expect(conFundas.some((r) => r.accion === "pausar")).toBe(false);
  });
});
