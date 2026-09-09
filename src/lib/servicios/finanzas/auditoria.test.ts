import { describe, expect, it } from "vitest";
import { ordenAuditadaDeFila } from "./auditoria";

describe("auditoría por orden", () => {
  it("convierte la fila guardada a centavos y prefiere el neto releído", () => {
    const o = ordenAuditadaDeFila({
      order_id: 2000018341066916,
      fecha: "2026-09-08",
      tipo_venta: "directa",
      total: "208",
      total_comprador: null,
      comision_mp: "31.2",
      envio_mp: "39",
      isr_mp: "4.48",
      iva_mp: "14.34",
      retencion_mp: null,
      otros_mp: "0",
      cargos_sin_desglosar: "0",
      neto: "118.98",
      neto_actual: null,
      neto_calculado: "118.98",
      reembolsado: null,
      estado: "paid",
      estado_pago: "approved",
      cargos_fuente: "v1/payments",
      cargos_completos: true,
      libera_en: "2026-09-11T01:39:07+00:00",
    });
    expect(o).toMatchObject({
      orderId: "2000018341066916",
      tipoVenta: "directa",
      total: 20800,
      comision: 3120,
      envio: 3900,
      isr: 448,
      iva: 1434,
      neto: 11898,
      netoCalculado: 11898,
      fuente: "v1/payments",
      completa: true,
    });
    // La cascada de la orden cierra al centavo.
    expect(o.total - o.comision - o.envio - o.isr - o.iva - o.otros - o.sinDesglosar).toBe(o.neto);
  });

  it("una relectura manda: neto_actual sustituye al neto original; sin fuente queda «sin leer»", () => {
    const o = ordenAuditadaDeFila({ order_id: 1, fecha: "2026-09-01", total: 100, neto: 80, neto_actual: 20, reembolsado: 60 });
    expect(o.neto).toBe(2000);
    expect(o.reembolsado).toBe(6000);
    expect(o.fuente).toBeNull();
    expect(o.tipoVenta).toBeNull();
  });
});
