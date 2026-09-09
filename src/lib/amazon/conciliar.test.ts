import { describe, expect, it } from "vitest";
import { conciliar, fechaDeReporte, leerReporteTransacciones } from "./conciliar";

const CSV = `﻿"Incluye  transacciones de Amazon Marketplace, Fulfillment by Amazon (FBA) y Amazon Webstore"
"Todos los importes en MXN, a menos que se especifique"
"fecha/hora","Id. de liquidación","tipo","Id. del pedido","sku","descripción","cantidad","marketplace","cumplimiento","ciudad del pedido","estado del pedido","código postal del pedido","modelo de recaudación de impuestos","ventas de productos","impuesto de ventas de productos","créditos de envío","impuesto de abono de envío","créditos por envoltorio de regalo","impuesto de créditos de envoltura","Tarifa reglamentaria","Impuesto sobre tarifa reglamentaria","descuentos promocionales","impuesto de reembolsos promocionales","impuesto de retenciones en la plataforma","tarifas de venta","tarifas fba","tarifas de otra transacción","otro","total","Estado de la transacción","Fecha de liberación de la transacción"
"31 jul 2026 11:03:59 p.m. GMT-7","27240596111","Pedido","702-6207082-8815410","GT204-BLK-24-MX","Getac Chanclas, Mujer","1","amazon.com.mx","Amazon","TLAQUEPAQUE","JALISCO","45600","MarketplaceFacilitator","137.92","22.07","18.97","3.03","0","0","0","0","-18.97","-3.03","-11.04","-24.00","-35.00","0","0","89.95","Lanzado","4 ago 2026 5:11:02 a.m. GMT-7"
"2 ago 2026 10:00:28 a.m. GMT-7","27240596111","Pedido","702-6207082-8815410","GT204-BLK-25-MX","Otra talla","1","amazon.com.mx","Amazon","","","","MarketplaceFacilitator","1,137.92","0","0","0","0","0","0","0","0","0","0","0","0","0","0","1,000.05","Lanzado",""
"5 ago 2026 1:00:00 p.m. GMT-7","27240596111","Reembolso","701-0000000-0000001","GT1","x","1","amazon.com.mx","Amazon","","","","","-100","0","0","0","0","0","0","0","0","0","0","15","0","0","0","-85","Lanzado",""
"6 ago 2026 1:00:00 p.m. GMT-7","27240596111","Tarifa de servicio","","","","","amazon.com.mx","","","","","","0","0","0","0","0","0","0","0","0","0","0","0","0","0","-116","-116","Lanzado",""
"7 ago 2026 1:00:00 p.m. GMT-7","27240596111","Trasferir","","","","","amazon.com.mx","","","","","","0","0","0","0","0","0","0","0","0","0","0","0","0","0","-507,248.65","-507,248.65","Lanzado",""
"8 ago 2026 1:00:00 p.m. GMT-7","27287569251","Pedido","702-9999999-9999999","GT2","y","1","amazon.com.mx","Amazon","","","","","200","0","0","0","0","0","0","0","0","0","0","0","0","0","0","167.47","Diferido",""
`;

describe("leerReporteTransacciones", () => {
  it("lee fechas GMT-7 con a.m./p.m., miles con coma y el preámbulo", () => {
    const r = leerReporteTransacciones(CSV);
    expect(r).toHaveLength(6);
    expect(r[0]).toMatchObject({ liquidacion: "27240596111", tipo: "Pedido", orden: "702-6207082-8815410", sku: "GT204-BLK-24-MX", cantidad: 1, total: 89.95, estado: "Lanzado" });
    expect(r[0].fechaIso).toBe("2026-08-01T06:03:59.000Z");
    expect(r[1].total).toBe(1000.05);
    expect(r[3].orden).toBeNull();
    expect(r[4].total).toBe(-507248.65);
    expect(fechaDeReporte("2 ago 2026 10:00:28 a.m. GMT-7")).toBe("2026-08-02T17:00:28.000Z");
    expect(fechaDeReporte("2 ago 2026 12:15:00 a.m. GMT-7")).toBe("2026-08-02T07:15:00.000Z");
    expect(fechaDeReporte("basura")).toBeNull();
  });
});

describe("conciliar", () => {
  it("cruza orden por orden, tipo por lista, deja fuera transferencias y diferidos, y enseña lo que no cuadra", () => {
    const reporte = leerReporteTransacciones(CSV);
    const informe = conciliar(
      reporte,
      [
        { amazon_order_id: "702-6207082-8815410", eventos: 2, monto: 1090.0 },
        { amazon_order_id: "701-0000000-0000001", eventos: 1, monto: -85 },
        { amazon_order_id: "701-5555555-5555555", eventos: 1, monto: 50 },
      ],
      [{ lista: "ProductAdsPaymentEventList", descripcion: "CHARGE", posted_en: "2026-08-06T20:00:00Z", monto: -116, clasificado: true }],
      [{ grupo_id: "g1", inicio: "2026-08-03T00:00:00Z", fin: "2026-08-06T00:00:00Z", estado: "Closed", total_original: 100, suma_eventos: 100, completo: true, cuadra: true }],
    );
    expect(informe.rango).toEqual({ desde: "2026-08-01T06:03:59.000Z", hasta: "2026-08-08T20:00:00.000Z" });
    expect(informe.transferencias).toEqual([{ liquidacion: "27240596111", monto: -507248.65 }]);
    expect(informe.diferidos).toEqual({ renglones: 1, total: 167.47 });
    // Reporte lanzado sin transferencias: 89.95 + 1000.05 − 85 − 116 = 889. ERP: 1090 − 85 + 50 − 116 = 939.
    expect(informe.totales).toEqual({ reporte: 889, erp: 939, diferencia: -50 });
    expect(informe.equivalencias[0]).toMatchObject({ renglones: 3, reporte: 1005, eventos: 4, erp: 1055, diferencia: -50 });
    expect(informe.equivalencias.find((e) => e.nombre.startsWith("Publicidad"))).toMatchObject({ renglones: 1, reporte: -116, eventos: 1, erp: -116, diferencia: 0 });
    expect(informe.ordenes).toMatchObject({ enReporte: 2, enErp: 3, cuadran: 2, soloReporte: 0, soloErp: 1, distintas: 0, sumaReporte: 1005, sumaErp: 1055 });
    expect(informe.ordenes.ejemplos).toEqual([{ orden: "701-5555555-5555555", reporte: null, erp: 50, diferencia: -50 }]);
    expect(informe.tiposSinEquivalente).toEqual([]);
    expect(informe.liquidaciones[0]).toMatchObject({ grupo: "g1", cuadra: true });
    expect(informe.avisos.some((a) => a.includes("DIFERIDOS"))).toBe(true);
  });
});
