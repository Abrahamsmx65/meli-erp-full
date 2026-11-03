import { describe, expect, it } from "vitest";
import { aliasPorInventario, unirPorInventario } from "./alias-inventario";

describe("variante con dos nombres (mismo inventory_id)", () => {
  // Caso real del 21-oct-2026: GT134 BLK-BLK talla 25.
  const activos = [{ sku: "GT134-BLK-BLK-25-MX", inventoryId: "NEDC47656" }];
  const apagados = [{ sku: "GT134-BLK / BLK-25-MX", inventoryId: "NEDC47656" }];

  it("el nombre apagado apunta al activo", () => {
    const alias = aliasPorInventario(activos, apagados);
    expect(alias.get("GT134-BLK / BLK-25-MX")).toBe("GT134-BLK-BLK-25-MX");
  });

  it("con dos activos del mismo inventario no adivina", () => {
    const alias = aliasPorInventario(
      [...activos, { sku: "OTRO-25-MX", inventoryId: "NEDC47656" }],
      apagados,
    );
    expect(alias.size).toBe(0);
  });

  it("el stock vivo del nombre apagado llega al activo (gana la lectura más reciente)", () => {
    const alias = aliasPorInventario(activos, apagados);
    const r = unirPorInventario(alias, {
      stockActual: [
        { sku: "GT134-BLK-BLK-25-MX", disponible: 0, enTransferencia: 0, noDisponible: 0, total: 0, actualizadoEn: "2026-09-08T14:05:19Z" },
        { sku: "GT134-BLK / BLK-25-MX", disponible: 49, enTransferencia: 12, noDisponible: 0, total: 61, actualizadoEn: "2026-10-21T14:05:15Z" },
      ],
      snapshots: [
        { sku: "GT134-BLK / BLK-25-MX", fecha: "2026-10-20", disponible: 52 },
      ],
      ventas: [
        { sku: "GT134-BLK-BLK-25-MX", fecha: "2026-10-20", unidades: 2 },
        { sku: "GT134-BLK / BLK-25-MX", fecha: "2026-10-20", unidades: 1 },
      ],
      operaciones: [],
    });
    expect(r.stockActual).toEqual([
      { sku: "GT134-BLK-BLK-25-MX", disponible: 49, enTransferencia: 12, noDisponible: 0, total: 61 },
    ]);
    expect(r.snapshots).toEqual([
      { sku: "GT134-BLK-BLK-25-MX", fecha: "2026-10-20", disponible: 52 },
    ]);
    expect(r.ventas).toHaveLength(1);
    expect(r.ventas[0]).toMatchObject({ sku: "GT134-BLK-BLK-25-MX", unidades: 3 });
  });

  it("en la misma fecha gana la foto de la fuente viva, no se suman", () => {
    const alias = aliasPorInventario(activos, apagados);
    const r = unirPorInventario(alias, {
      stockActual: [
        { sku: "GT134-BLK-BLK-25-MX", disponible: 0, enTransferencia: 0, noDisponible: 0, total: 0, actualizadoEn: "2026-09-08T00:00:00Z" },
        { sku: "GT134-BLK / BLK-25-MX", disponible: 49, enTransferencia: 0, noDisponible: 0, total: 49, actualizadoEn: "2026-10-21T00:00:00Z" },
      ],
      snapshots: [
        { sku: "GT134-BLK-BLK-25-MX", fecha: "2026-09-08", disponible: 0 },
        { sku: "GT134-BLK / BLK-25-MX", fecha: "2026-09-08", disponible: 30 },
        { sku: "GT134-BLK-BLK-25-MX", fecha: "2026-09-01", disponible: 5 },
      ],
      ventas: [],
      operaciones: [],
    });
    const porFecha = new Map(r.snapshots.map((s) => [s.fecha, s.disponible]));
    expect(porFecha.get("2026-09-08")).toBe(30);
    expect(porFecha.get("2026-09-01")).toBe(5);
  });

  it("sin alias no toca nada", () => {
    const r = unirPorInventario(new Map(), {
      stockActual: [{ sku: "A", disponible: 1, enTransferencia: 0, noDisponible: 0, total: 1, actualizadoEn: null }],
      snapshots: [],
      ventas: [],
      operaciones: [],
    });
    expect(r.stockActual).toEqual([{ sku: "A", disponible: 1, enTransferencia: 0, noDisponible: 0, total: 1 }]);
  });
});
