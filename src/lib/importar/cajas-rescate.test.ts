import { describe, expect, it } from "vitest";
import { construirCajas, rescatarFilaMalCapturada } from "./cajas";
import type { FilaExistencia } from "./excel";

const fila = (o: Partial<FilaExistencia>): FilaExistencia => ({
  almacen: "Industher",
  codigoAlmacen: "",
  skuCaja: "IN10057-24-GT114-BLK",
  pedido: "",
  modelo: "IN10057",
  color: "24-GT114-BLK",
  talla: "CORRIDA",
  contenedor: "",
  cajasFisicas: 3,
  cajasApartadas: 0,
  enCamino: 0,
  cajasDisponibles: 3,
  paresPorCaja: 1,
  paresDisponibles: 3,
  ...o,
});

describe("rescatarFilaMalCapturada: la caja capturada con el SKU revuelto cuenta como inventario (21-oct-2026)", () => {
  it("«IN10057 · 24-GT114-BLK» es GT114 BLK talla 24 del IN10057", () => {
    expect(rescatarFilaMalCapturada(fila({}))).toMatchObject({ pedido: "IN10057", modelo: "GT114", color: "BLK", talla: "24" });
  });
  it("sin talla al frente, el pedido en el modelo también se endereza; un color con guion se conserva", () => {
    expect(rescatarFilaMalCapturada(fila({ color: "GT148-M BROWN-RED" }))).toMatchObject({
      pedido: "IN10057",
      modelo: "GT148",
      color: "M BROWN-RED",
      talla: "CORRIDA",
    });
  });
  it("la talla dentro del color («24-BLK») sale al campo de talla", () => {
    expect(rescatarFilaMalCapturada(fila({ modelo: "GT114", color: "24-BLK", pedido: "IN10057" }))).toMatchObject({
      modelo: "GT114",
      color: "BLK",
      talla: "24",
    });
  });
  it("un renglón bien capturado se devuelve tal cual", () => {
    const bien = fila({ modelo: "GT114", color: "BLK", pedido: "IN10057", talla: "24" });
    expect(rescatarFilaMalCapturada(bien)).toBe(bien);
    const corrida = fila({ modelo: "GT104-5", color: "GREEN", pedido: "IN10190", talla: "CORRIDA" });
    expect(rescatarFilaMalCapturada(corrida)).toBe(corrida);
  });
});

describe("construirCajas: los pares de la caja rescatada salen de su corrida color-talla", () => {
  it("con «pares por caja» 1, la caja toma los 24 de «IN10057 · GT114 · BLK-24»", () => {
    const r = construirCajas([fila({})], [{ pedido: "IN10057", modelo: "GT114", color: "BLK-24", tallas: { "24": 24 }, total: 24 }], {
      indice: {
        exactos: new Set(["GT114-BLK-24-MX"]),
        canonicos: new Map([["GT114-BLK-24-MX", "GT114-BLK-24-MX"]]),
        aplastados: new Map([["GT114BLK24MX", "GT114-BLK-24-MX"]]),
      },
    });
    expect(r.cajas).toHaveLength(1);
    expect(r.cajas[0]).toMatchObject({ pedido: "IN10057", modelo: "GT114", color: "BLK", talla: "24", paresPorCaja: 24, cajasDisponibles: 3 });
  });
});
