import { describe, expect, it } from "vitest";
import {
  aplicarEnCamino,
  resumirEnCamino,
  type FilaEnvioEntrante,
} from "./fba-en-camino";
import type { RenglonAmazon } from "./amazon";

function fila(x: Partial<FilaEnvioEntrante>): FilaEnvioEntrante {
  return {
    shipment_id: "FBA000",
    seller_sku: "GT114-LT BROWN-26-MX",
    nombre: null,
    estado: "SHIPPED",
    enviado: 0,
    recibido: 0,
    vigente: true,
    ...x,
  };
}

function renglon(x: Partial<RenglonAmazon>): RenglonAmazon {
  return {
    sku: "GT114-LT BROWN-26-MX",
    titulo: null,
    asin: null,
    unidades: 10,
    ordenes: 10,
    importe: 0,
    disponible: 0,
    enTransferencia: 30,
    totalFba: 30,
    cobertura: null,
    ...x,
  };
}

describe("resumirEnCamino", () => {
  it("sin detalle sincronizado no opina (null): se queda el reporte", () => {
    expect(resumirEnCamino([])).toBeNull();
  });

  it("solo lo pendiente de envíos VIGENTES cuenta como en camino", () => {
    const r = resumirEnCamino([
      // vigente: mandó 20, recibió 5 → 15 en camino
      fila({ shipment_id: "FBA001", enviado: 20, recibido: 5 }),
      // viejo (sin movimiento en 20 días): sus 30 pendientes NO cuentan
      fila({ shipment_id: "FBA002", enviado: 30, recibido: 0, vigente: false }),
    ]);
    expect(r).not.toBeNull();
    expect(r!.porSku.get("GT114-LT BROWN-26-MX")).toBe(15);
    expect(r!.paresViejos).toBe(30);
    expect(r!.viejos).toHaveLength(1);
    expect(r!.viejos[0].shipmentId).toBe("FBA002");
    expect(r!.enviosVigentes).toBe(1);
  });

  it("suma varios envíos vigentes del mismo SKU y no baja de cero", () => {
    const r = resumirEnCamino([
      fila({ shipment_id: "FBA001", enviado: 10, recibido: 4 }),
      fila({ shipment_id: "FBA003", enviado: 6, recibido: 0 }),
      // recibido de más (ajuste de Amazon): pendiente 0, no negativo
      fila({ shipment_id: "FBA004", enviado: 5, recibido: 9 }),
    ]);
    expect(r!.porSku.get("GT114-LT BROWN-26-MX")).toBe(12);
  });

  it("agrupa lo viejo POR ENVÍO para poder enseñarlo y cerrarlo", () => {
    const r = resumirEnCamino([
      fila({ shipment_id: "FBA009", seller_sku: "A", enviado: 8, vigente: false, nombre: "FBA STA viejo" }),
      fila({ shipment_id: "FBA009", seller_sku: "B", enviado: 4, vigente: false, nombre: "FBA STA viejo" }),
    ]);
    expect(r!.viejos).toEqual([
      { shipmentId: "FBA009", nombre: "FBA STA viejo", estado: "SHIPPED", pares: 12 },
    ]);
    expect(r!.porSku.size).toBe(0);
  });
});

describe("aplicarEnCamino", () => {
  it("el caso GT114-LT BROWN-26: 30 fantasmas del reporte se vuelven 0 y el faltante renace", () => {
    const [r] = aplicarEnCamino(
      [renglon({})],
      resumirEnCamino([
        fila({ shipment_id: "FBA002", enviado: 30, recibido: 0, vigente: false }),
      ]),
    );
    expect(r.enTransferencia).toBe(0);
    expect(r.totalFba).toBe(0);
  });

  it("respeta lo vigente y deja intactos los renglones sin cambio", () => {
    const enCamino = resumirEnCamino([
      fila({ shipment_id: "FBA001", enviado: 12, recibido: 2 }),
    ]);
    const [r] = aplicarEnCamino([renglon({ enTransferencia: 10, totalFba: 10 })], enCamino);
    expect(r.enTransferencia).toBe(10);
    expect(r.totalFba).toBe(10);
  });

  it("sin detalle (null) no toca nada: mejor el reporte que inventar ceros", () => {
    const original = renglon({});
    const [r] = aplicarEnCamino([original], null);
    expect(r).toBe(original);
  });
});
