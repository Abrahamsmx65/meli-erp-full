import { describe, expect, it } from "vitest";
import { clasificarCargo, extraerCargos } from "./cargos-meli";

describe("clasificarCargo", () => {
  it("separa lo de Full de lo que ya va en el neto", () => {
    expect(clasificarCargo("Almacenamiento Full")).toBe("full");
    expect(clasificarCargo("Cargo por almacenamiento prolongado")).toBe("full");
    expect(clasificarCargo("Retiro de stock")).toBe("full");
    expect(clasificarCargo("Comisión por venta")).toBe("venta");
    expect(clasificarCargo("Costo de envío")).toBe("venta");
    expect(clasificarCargo("Product Ads")).toBe("publicidad");
    expect(clasificarCargo("Pago recibido")).toBe("pago");
    expect(clasificarCargo("Bonificación")).toBe("pago");
    expect(clasificarCargo("Servicio raro")).toBe("otro");
  });
});

describe("extraerCargos", () => {
  it("lee el formato charge_info del API de facturación", () => {
    const crudo = {
      results: [
        {
          charge_info: {
            detail_id: 991,
            detail_type: "Almacenamiento Full",
            detail_sub_type: "Mensual",
            transaction_detail: "Almacenamiento agosto",
            detail_amount: "123.45",
            creation_date_time: "2026-08-31T10:00:00.000-06:00",
          },
        },
        { charge_info: { detail_id: 992, detail_type: "Comisión por venta", detail_amount: 30 } },
        { charge_info: { detail_type: "Sin monto" } },
      ],
    };
    const cargos = extraerCargos(crudo, "2026-08");
    expect(cargos).toHaveLength(2);
    expect(cargos[0]).toMatchObject({
      detalleId: "991",
      periodo: "2026-08",
      fecha: "2026-08-31",
      tipo: "Almacenamiento Full",
      subtipo: "Mensual",
      descripcion: "Almacenamiento agosto",
      monto: 123.45,
      clase: "full",
    });
    expect(cargos[1]).toMatchObject({ detalleId: "992", clase: "venta", monto: 30, fecha: null });
  });

  it("acepta renglones planos y les inventa un id estable si no traen", () => {
    const cargos = extraerCargos([{ type: "Servicio", amount: 10, date_created: "2026-08-02" }], "2026-08");
    expect(cargos[0]).toMatchObject({ tipo: "Servicio", monto: 10, fecha: "2026-08-02", clase: "otro" });
    expect(cargos[0].detalleId).toBe("2026-08:0:Servicio:10");
  });
});
