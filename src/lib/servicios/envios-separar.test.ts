import { describe, expect, it } from "vitest";
import { separarEnvios } from "./envios";
import type { CajaGuardada } from "./cache";

const caja = (codigo: string, almacen: string, extras?: Partial<CajaGuardada>): CajaGuardada => ({
  codigo,
  skuCaja: `SKU-${codigo}`,
  pedido: "IN10001",
  modelo: "GT114",
  color: "NEGRO",
  almacen,
  esCorrida: false,
  talla: "25",
  cantidad: 2,
  cajasDisponibles: 5,
  paresPorCaja: 12,
  paresTotales: 24,
  contenedores: [],
  aporta: [{ sku: `GT114-NEGRO-25-MX`, talla: "25", paresPorCaja: 12, paresTotales: 24 }],
  ...extras,
});

describe("separarEnvios con almacenes precargados", () => {
  it("agrupa por grupo_envio sin tocar la base y ordena en alfabético natural", async () => {
    // db nulo a propósito: con almacenesPre NO debe haber ningún viaje.
    const db = null as never;
    const { envios, sinConfigurar } = await separarEnvios(db, "cuenta", [
      caja("c1", "Industher"),
      caja("c2", "Caseshop", { modelo: "GT104-1" }),
      caja("c3", "EnvioPack"),
      caja("c4", "Bodega Rara"),
    ], [
      { almacen: "Caseshop", grupo_envio: "Caseshop + Industher" },
      { almacen: "Industher", grupo_envio: "Caseshop + Industher" },
      { almacen: "EnvioPack", grupo_envio: "EnvioPack" },
    ]);

    // Caseshop + Industher juntos, EnvioPack aparte, y el almacén sin
    // configurar sale en su propio envío y se declara.
    expect(envios.map((e) => e.nombre).sort()).toEqual(["Bodega Rara", "Caseshop + Industher", "EnvioPack"]);
    expect(sinConfigurar).toEqual(["Bodega Rara"]);

    const juntos = envios.find((e) => e.nombre === "Caseshop + Industher")!;
    expect(juntos.cajas.map((c) => c.codigo)).toEqual(["c2", "c1"]); // Caseshop antes que Industher
    expect(juntos.totalCajas).toBe(4);
    expect(juntos.totalPares).toBe(48);
    // porSku en alfabético natural, no por pares.
    expect(juntos.porSku.map((s) => s.sku)).toEqual([...juntos.porSku.map((s) => s.sku)].sort((a, b) => a.localeCompare(b, "es", { numeric: true })));
  });
});
