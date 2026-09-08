import { beforeEach, describe, expect, it, vi } from "vitest";
import { leerCacheYzGuardado } from "./cache";
import {
  derivadasDeCompras,
  detalleDesdeCompras,
  obtenerCompras,
  obtenerDetalleCompras,
  obtenerResumenCompras,
  resumenDesdeCompras,
  type ComprasCalculadas,
  type VarianteCalculada,
} from "./compras";

vi.mock("./cache", async (importOriginal) => {
  const original = await importOriginal<typeof import("./cache")>();
  return { ...original, leerCacheYzGuardado: vi.fn() };
});

const leerCache = vi.mocked(leerCacheYzGuardado);

function variante(sku: string, diseno: string, extra: Partial<VarianteCalculada> = {}): VarianteCalculada {
  return {
    diseno,
    skuMeli: sku,
    titulo: null,
    modelo: sku.split("-")[1] ?? "",
    color: "",
    vendidas30: 0,
    ventaDiaria: 0,
    enFull: 0,
    enTransferencia: 0,
    enCaminoFull: 0,
    enBodega: 0,
    enCaminoChina: 0,
    posicionTotal: 0,
    cobertura: Infinity,
    objetivo: 0,
    sugerido: 0,
    costoUnitario: null,
    descontinuada: false,
    ...extra,
  };
}

const compras: ComprasCalculadas = {
  generadoEn: "2026-09-08T00:00:00Z",
  diasVenta: 30,
  descontinuados: { activo: true, historialDesde: "2026-03-01", disenos: ["654"] },
  variantes: [
    variante("499-I13", "499", { vendidas30: 30, ventaDiaria: 1, sugerido: 120 }),
    variante("499-I14", "499", { descontinuada: true }),
    // Diseño retirado completo: hasta la variante nueva viene marcada.
    variante("654-I13", "654", { descontinuada: true }),
    variante("654-I15PRO", "654", { descontinuada: true }),
    // Calzado de la cuenta: no se pide desde aquí.
    variante("GT114-BLK-25", "GT114", { vendidas30: 5 }),
  ],
};

describe("lectores cacheados de compras", () => {
  beforeEach(() => {
    leerCache.mockReset();
  });

  it.each([
    ["completo", (db: any) => obtenerCompras(db, "cuenta")],
    ["resumen", (db: any) => obtenerResumenCompras(db, "cuenta")],
    ["detalle", (db: any) => obtenerDetalleCompras(db, "cuenta", "499")],
  ])("propaga un fallo al leer %s sin iniciar el cálculo", async (_nombre, leer) => {
    const fallo = new Error("permission denied for table yz_cache");
    leerCache.mockResolvedValue({ estado: "fallo", error: fallo });
    const db = { from: vi.fn() };

    await expect(leer(db)).rejects.toBe(fallo);
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each([
    ["completo", (db: any) => obtenerCompras(db, "cuenta"), 1],
    ["resumen", (db: any) => obtenerResumenCompras(db, "cuenta"), 1],
    ["detalle", (db: any) => obtenerDetalleCompras(db, "cuenta", "499"), 2],
  ])("la ausencia real de %s conserva el primer cálculo", async (_nombre, leer, lecturasEsperadas) => {
    const inicioCalculo = new Error("inicio del cálculo");
    leerCache.mockResolvedValue({ estado: "ausente" });
    const db = { from: vi.fn(() => { throw inicioCalculo; }) };

    await expect(leer(db)).rejects.toBe(inicioCalculo);
    expect(leerCache).toHaveBeenCalledTimes(lecturasEsperadas);
    expect(db.from).toHaveBeenCalledOnce();
  });
});

describe("resumenDesdeCompras", () => {
  it("un diseño retirado completo no sale; el que sigue vendiendo sí, sin sus variantes muertas", () => {
    const r = resumenDesdeCompras(compras);
    expect(r.disenos.map((d) => d.diseno)).toEqual(["499"]);
    expect(r.disenos[0]).toMatchObject({ variantes: 1, descontinuadas: 1, vendidas30: 30, sugerido: 120 });
    expect(r.descontinuados).toEqual({ skus: 3, disenos: 1, activo: true, historialDesde: "2026-03-01" });
  });
});

describe("detalleDesdeCompras", () => {
  it("un diseño retirado no existe para la pantalla", () => {
    expect(detalleDesdeCompras(compras, "654")).toBeNull();
    expect(detalleDesdeCompras(compras, "no-existe")).toBeNull();
  });

  it("el diseño vivo trae sus variantes vivas y lista las descontinuadas aparte", () => {
    const d = detalleDesdeCompras(compras, " 499 ")!;
    expect(d.diseno).toBe("499");
    expect(d.variantes.map((v) => v.skuMeli)).toEqual(["499-I13"]);
    expect(d.descontinuadas).toEqual(["499-I14"]);
    expect(d.sugerido).toBe(120);
  });
});

describe("derivadasDeCompras", () => {
  it("guarda el resumen y un renglón por diseño vivo, nada más", () => {
    const filas = derivadasDeCompras(compras);
    expect(filas.map((f) => f.clave)).toEqual(["compras:resumen", "compras:d:499"]);
  });
});
