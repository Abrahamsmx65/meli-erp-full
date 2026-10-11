import { describe, expect, it } from "vitest";
import { armarCorreoDePublicidad, compararConAnterior, htmlCorreoPublicidad, paraGuardar } from "./publicidad-correo";
import { armarRecomendaciones, type FilaPublicidad, type Publicidad, type RecomendacionAds } from "./publicidad";

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

describe("compararConAnterior", () => {
  it("marca lo nuevo, conserva desde cuándo sigue lo pendiente y saca lo resuelto", () => {
    const { recomendaciones, resueltas } = compararConAnterior(
      [rec("GT148", "pausar"), rec("GT190", "activar")],
      [
        { modelo: "GT148", accion: "pausar", queHacer: "x", desde: "2026-10-08" },
        { modelo: "GT114", accion: "bajar", queHacer: "y", desde: "2026-10-09" },
      ],
      "2026-10-11",
    );
    expect(recomendaciones.map((r) => [r.modelo, r.nueva, r.desde])).toEqual([
      ["GT148", false, "2026-10-08"],
      ["GT190", true, "2026-10-11"],
    ]);
    expect(resueltas.map((r) => r.modelo)).toEqual(["GT114"]);
  });

  it("si cambia la acción del modelo es otra cosa que hacer: sale como nueva", () => {
    const { recomendaciones, resueltas } = compararConAnterior(
      [rec("GT148", "pausar")],
      [{ modelo: "GT148", accion: "bajar", queHacer: "x", desde: "2026-10-08" }],
      "2026-10-11",
    );
    expect(recomendaciones[0].nueva).toBe(true);
    expect(resueltas).toHaveLength(1);
  });

  it("el primer correo no marca nada como nuevo", () => {
    const { recomendaciones } = compararConAnterior([rec("GT148", "pausar")], null, "2026-10-11");
    expect(recomendaciones[0].nueva).toBe(false);
    expect(paraGuardar(recomendaciones)[0].desde).toBe("2026-10-11");
  });
});

describe("correo de publicidad", () => {
  const publicidad = (recomendaciones: RecomendacionAds[]): Publicidad => ({
    filas: [],
    recomendaciones,
    totales: { gastoAds: 1234, ventaAds: 10000, unidadesAds: 10, unidades: 50, importe: 25000, ganancia: 5000, coberturaCosto: 1, costoPorUnidad: 24.68, tacos: 0.049, acos: 0.123 },
    sinAmarre: { gasto: 50, anuncios: 1 },
    errorAds: null,
    advertencias: [],
    errorRecomendaciones: null,
  });

  it("cuenta los cambios y los nuevos en el asunto y agrupa por acción", () => {
    const c = armarCorreoDePublicidad({
      dia: "2026-10-11",
      rango: { desde: "2026-09-27", hasta: "2026-10-10" },
      publicidad: publicidad([rec("GT148", "pausar"), rec("GT190", "activar")]),
      anterior: [{ modelo: "GT148", accion: "pausar", queHacer: "x", desde: "2026-10-09" }],
    });
    const { asunto, html, texto } = htmlCorreoPublicidad(c);
    expect(asunto).toBe("Publicidad hoy: 2 cambios por hacer (1 nuevo)");
    expect(html).toContain("NUEVO HOY");
    expect(html).toContain("pendiente desde hace 2 días");
    expect(texto).toContain("[NUEVO] GT190");
    expect(c.avisos.some((a) => a.includes("no amarran"))).toBe(true);
  });

  it("sin cambios lo dice", () => {
    const c = armarCorreoDePublicidad({ dia: "2026-10-11", rango: { desde: "2026-09-27", hasta: "2026-10-10" }, publicidad: publicidad([]), anterior: null });
    expect(htmlCorreoPublicidad(c).asunto).toBe("Publicidad hoy: nada que cambiar");
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
});
