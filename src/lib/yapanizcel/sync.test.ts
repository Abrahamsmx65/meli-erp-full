import { describe, expect, it, vi } from "vitest";
import { completarNetos, type OrdenLeida } from "./sync";

function dbConCache(filas: Record<string, unknown>[]) {
  return {
    from: () => ({
      select: (columnas: string) => {
        const consulta: any = {
          eq: () => consulta,
          in: () => consulta,
          not: () => consulta,
          then: (ok: (valor: unknown) => unknown, fallo?: (error: unknown) => unknown) =>
            Promise.resolve({
              data: columnas === "order_id"
                ? filas.map((f) => ({ order_id: f.order_id }))
                : filas,
            }).then(ok, fallo),
        };
        return consulta;
      },
    }),
  } as any;
}

const ordenes: OrdenLeida[] = [
  { id: 1, fecha: "2026-01-01", total: 100, pagos: [101], renglones: [{ sku: "PENDIENTE", unidades: 1, importe: 100, comision: 20 }] },
  { id: 2, fecha: "2026-01-01", total: 100, pagos: [102], renglones: [{ sku: "CERO", unidades: 1, importe: 100, comision: 20 }] },
  { id: 3, fecha: "2026-01-01", total: 100, pagos: [103], renglones: [{ sku: "NEGATIVO", unidades: 1, importe: 100, comision: 20 }] },
];

const cache = [
  { order_id: 1, neto: 0, neto_actual: null, neto_en: null, actualizado_en: "2026-01-02T00:00:00Z", cargos_leidos_en: "2026-01-02T00:00:00Z", reembolso_incluido_neto_base: null, reembolso_base_confiable: null },
  { order_id: 2, neto: 0, neto_actual: null, neto_en: "2026-01-02T00:00:00Z", actualizado_en: "2026-01-02T00:00:00Z", cargos_leidos_en: "2026-01-02T00:00:00Z", reembolso_incluido_neto_base: 100, reembolso_base_confiable: true },
  { order_id: 3, neto: -15, neto_actual: null, neto_en: "2026-01-02T00:00:00Z", actualizado_en: "2026-01-02T00:00:00Z", cargos_leidos_en: "2026-01-02T00:00:00Z", reembolso_incluido_neto_base: 100, reembolso_base_confiable: true },
];

describe("completarNetos", () => {
  it("no devuelve placeholders fuera del límite y conserva cero/negativos confirmados", async () => {
    const get = vi.fn();
    const netos = await completarNetos(dbConCache(cache), "cuenta", { get } as any, ordenes, 0);

    expect(get).not.toHaveBeenCalled();
    expect([...netos]).toEqual([[2, 0], [3, -15]]);
  });

  it("no certifica el placeholder cuando falla la lectura de Mercado Pago", async () => {
    const get = vi.fn().mockRejectedValue(new Error("MP no disponible"));
    const netos = await completarNetos(dbConCache(cache), "cuenta", { get } as any, ordenes, 1);

    expect(get).toHaveBeenCalledTimes(1);
    expect([...netos]).toEqual([[2, 0], [3, -15]]);
  });
});