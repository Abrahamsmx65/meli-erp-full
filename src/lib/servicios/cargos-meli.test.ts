import { describe, expect, it } from "vitest";
import { cargosGuardados, clasificarCargo, extraerCargos } from "./cargos-meli";

describe("clasificarCargo", () => {
  it("separa lo de Full de lo que ya va en el neto", () => {
    expect(clasificarCargo("Almacenamiento Full")).toBe("full");
    expect(clasificarCargo("Cargo por almacenamiento prolongado")).toBe("full");
    expect(clasificarCargo("Retiro de stock")).toBe("full");
    expect(clasificarCargo("Comisión por venta")).toBe("venta");
    expect(clasificarCargo("Costo de envío")).toBe("venta");
    expect(clasificarCargo("Product Ads")).toBe("publicidad");
    expect(clasificarCargo("Pago recibido")).toBe("pago");
    expect(clasificarCargo("Bonificación")).toBe("bonificacion");
    expect(clasificarCargo("Servicio raro")).toBe("otro");
  });

  it("reconoce los códigos de la factura de MELI México", () => {
    expect(clasificarCargo("CHARGE CFWA Cargo por servicio de almacenamiento Full")).toBe("full");
    expect(clasificarCargo("CHARGE CFCB Cargo por servicio de colecta Full")).toBe("full");
    expect(clasificarCargo("CHARGE CFPB Cargo por incumplimiento en Envíos Full")).toBe("full");
    expect(clasificarCargo("CHARGE CFF Cargo por envíos de Mercado Libre")).toBe("venta");
    expect(clasificarCargo("CHARGE CV Cargo por venta")).toBe("venta");
    expect(clasificarCargo("CHARGE PADS Cargo por campaña de publicidad de Product Ads")).toBe("publicidad");
    expect(clasificarCargo("BONUS BFF Anulación del cargo por envíos de Mercado Libre")).toBe("bonificacion");
    expect(clasificarCargo("CHARGE CDSD Cargo por devolución")).toBe("otro");
    expect(clasificarCargo("CHARGE CESM Cargo por mantenimiento de Mi página")).toBe("otro");
  });
});

describe("cargosGuardados", () => {
  it("propaga una falla de Supabase en vez de devolver cargos cero", async () => {
    const db = {
      from: () => ({
        select: (_columnas: string, opciones?: { head?: boolean }) => {
          const q: any = {
            eq: () => q,
            order: () => q,
            range: () => q,
            then: (resolver: (valor: unknown) => unknown) =>
              Promise.resolve({
                data: null,
                error: { message: opciones?.head ? "permission denied" : "permission denied" },
                count: null,
              }).then(resolver),
          };
          return q;
        },
      }),
    } as any;

    await expect(cargosGuardados(db, "meli-1", "2026-08")).rejects.toThrow(
      "meli_cargos: permission denied",
    );
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

describe("cargosGuardados", () => {
  it("propaga un error de lectura en vez de reportar cero cargos", async () => {
    const q: any = {
      eq: () => q,
      order: () => q,
      range: () => Promise.resolve({ data: null, error: { message: "lectura caída" } }),
    };
    const db = {
      from: () => ({
        select: () => q,
      }),
    } as any;

    await expect(cargosGuardados(db, "cuenta", "2026-08")).rejects.toThrow(
      "meli_cargos: lectura caída",
    );
  });
});

describe("claveDePeriodo", () => {
  it("toma la clave del periodo que empieza en el mes pedido", async () => {
    const { claveDePeriodo } = await import("./cargos-meli");
    const crudo = {
      results: [
        { period: { key: "2026-08-01T00:00:00.000-04:00", date_from: "2026-08-01T00:00:00.000-04:00", date_to: "2026-08-31T23:59:59.000-04:00" } },
        { period: { key: "2026-09-01T00:00:00.000-04:00", date_from: "2026-09-01T00:00:00.000-04:00" } },
      ],
    };
    expect(claveDePeriodo(crudo, "2026-09")).toEqual({
      clave: "2026-09-01T00:00:00.000-04:00",
      claves: ["2026-08-01T00:00:00.000-04:00", "2026-09-01T00:00:00.000-04:00"],
    });
    expect(claveDePeriodo(crudo, "2026-07").clave).toBeNull();
  });

  it("acepta claves numéricas amarrando por date_from, y listas planas", async () => {
    const { claveDePeriodo } = await import("./cargos-meli");
    expect(claveDePeriodo({ results: [{ key: 4471, date_from: "2026-09-01" }] }, "2026-09")).toEqual({ clave: "4471", claves: ["4471"] });
    expect(claveDePeriodo([{ period: { key: "SEP-2026-09" } }], "2026-09").clave).toBe("SEP-2026-09");
    expect(claveDePeriodo(null, "2026-09")).toEqual({ clave: null, claves: [] });
  });
});

describe("extraerResumen", () => {
  it("saca montos con nombre y nunca los cuenta como gasto si no se reconocen", async () => {
    const { extraerResumen } = await import("./cargos-meli");
    const filas = extraerResumen(
      {
        summary: { charges_amount: 1000.5, bonus_amount: -20 },
        charges: [
          { type: "Almacenamiento Full", amount: 300 },
          { type: "Comisión por venta", amount: 600 },
        ],
      },
      "2026-08",
    );
    const porTipo = new Map(filas.map((f) => [f.tipo, f]));
    expect(porTipo.get("Almacenamiento Full")).toMatchObject({ clase: "full", monto: 300, subtipo: "resumen" });
    expect(porTipo.get("Comisión por venta")).toMatchObject({ clase: "venta", monto: 600 });
    expect(porTipo.get("summary.charges_amount")).toMatchObject({ clase: "resumen", monto: 1000.5 });
    expect(filas.every((f) => f.clase !== "otro")).toBe(true);
    expect(new Set(filas.map((f) => f.detalleId)).size).toBe(filas.length);
  });
});

describe("partición de la lectura", () => {
  it("arma los días del periodo y los parámetros de cada filtro", async () => {
    const { diasDelPeriodo, paramsDeParticion, cursoresDe, SUBTIPOS_INTERES } = await import("./cargos-meli");
    expect(diasDelPeriodo("2026-02")).toHaveLength(28);
    expect(diasDelPeriodo("2026-08")[30]).toBe("2026-08-31");
    expect(paramsDeParticion({ modo: "dia", param: "date_from" }, "2026-08-03")).toEqual({ date_from: "2026-08-03", date_to: "2026-08-03" });
    expect(paramsDeParticion({ modo: "dia", param: "creation_date_from" }, "2026-08-03")).toEqual({
      creation_date_from: "2026-08-03T00:00:00.000-06:00",
      creation_date_to: "2026-08-03T23:59:59.999-06:00",
    });
    expect(paramsDeParticion({ modo: "subtipo", param: "detail_sub_type" }, "CFWA")).toEqual({ detail_sub_type: "CFWA" });
    expect(paramsDeParticion({ modo: "ninguna" }, "")).toEqual({});
    expect(cursoresDe({ modo: "subtipo", param: "x" }, "2026-08")).toEqual(SUBTIPOS_INTERES);
    expect(cursoresDe({ modo: "ninguna" }, "2026-08")).toEqual([""]);
  });
});
