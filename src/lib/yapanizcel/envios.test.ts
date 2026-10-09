import { describe, expect, it } from "vitest";
import { sugeridasDePlan, vistaPantallaDePlan, type PlanConDetalle } from "./envios";
import type { LineaPlan } from "./plan";

const linea = (sku: string, c: Partial<LineaPlan> = {}): LineaPlan => ({
  sku,
  vendidas: 0,
  diasConStock: 30,
  porCalendario: false,
  ventaDiaria: 0,
  tendencia: null,
  enFull: 0,
  enTransferencia: 0,
  enCamino: 0,
  posicion: 0,
  cobertura: Infinity,
  objetivo: 0,
  falta: 0,
  enBodega: 0,
  mandar: 0,
  motivo: "cubierto" as LineaPlan["motivo"],
  ...c,
});

const plan = (lineas: LineaPlan[]): PlanConDetalle =>
  ({
    lineas,
    unidades: 30,
    skus: 2,
    faltanteSinCubrir: 5,
    desde: "2026-09-09",
    hasta: "2026-10-08",
    titulos: new Map([["499-A06", "Funda A06"]]),
    inventario: { sinAmarrar: { renglones: 3, unidades: 40 } },
    descontinuados: { activo: true, skus: new Set(["X", "Y"]) },
    parametros: { diasVenta: 30, diasObjetivo: 15, multiploEnvio: 10, minimoEnvio: 10, diasCaducidadEnvio: 10 },
  }) as unknown as PlanConDetalle;

describe("vistas chicas del plan", () => {
  it("la pantalla lleva solo las líneas con algo que decir, con su título, y los conteos de TODO el plan", () => {
    const p = plan([
      linea("499-A06", { vendidas: 4, mandar: 20 }),
      linea("499-A07"),
      linea("499-A08", { falta: 5, motivo: "sin_inventario" as LineaPlan["motivo"] }),
    ]);
    const v = vistaPantallaDePlan(p);
    expect(v.lineas.map((l) => l.sku)).toEqual(["499-A06", "499-A08"]);
    expect(v.lineas[0].titulo).toBe("Funda A06");
    expect(v.lineas[1].titulo).toBeNull();
    expect(v.sinInventario).toBe(1);
    expect(v.sinAmarrar).toEqual({ renglones: 3, unidades: 40 });
    expect(v.descontinuados).toEqual({ activo: true, skus: 2 });
    expect(v.parametros).toEqual({ diasVenta: 30, diasObjetivo: 15, multiploEnvio: 10, diasCaducidadEnvio: 10 });
    expect([v.unidades, v.skus, v.faltanteSinCubrir, v.desde, v.hasta]).toEqual([30, 2, 5, "2026-09-09", "2026-10-08"]);
  });

  it("las sugeridas de etiquetas: lo que se manda, de más a menos", () => {
    const p = plan([linea("A", { mandar: 10 }), linea("B"), linea("C", { mandar: 40 })]);
    expect(sugeridasDePlan(p)).toEqual([
      { sku: "C", cantidad: 40 },
      { sku: "A", cantidad: 10 },
    ]);
  });
});
