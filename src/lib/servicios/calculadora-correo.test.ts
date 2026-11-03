import { describe, expect, it } from "vitest";
import { correoSolicitudFactura, limpiarDestinatarios } from "./calculadora-correo";

describe("correo de la solicitud de factura", () => {
  it("limpia los destinatarios", () => {
    expect(limpiarDestinatarios("A@x.com; b@y.mx, a@x.com  nada")).toEqual(["a@x.com", "b@y.mx"]);
  });

  it("lleva las dos facturas con precio sin y con IVA", () => {
    const fila = { modelo: "GT114", descripcion: "", codigoSat: "53111600", pares: 12, precioConIva: 116, precioSinIva: 100, importeSinIva: 1200, iva: 192, total: 1392 };
    const c = correoSolicitudFactura({
      nombre: "factura-s271.xlsx", numero: "S271-2026", iso: "MIEU1", fuente: "erp", meses: ["2026-09"], avisos: [],
      facturas: [
        { tipo: "komerline", titulo: "Factura Industher a Komerline", filas: [fila], totales: { pares: 12, base: 1200, iva: 192, total: 1392 }, sinPrecio: [] },
        { tipo: "industher", titulo: "Factura a Industher", filas: [fila], totales: { pares: 12, base: 1200, iva: 192, total: 1392 }, sinPrecio: [] },
      ],
    });
    expect(c.asunto).toBe("Solicitud de factura · contenedor S271-2026 (MIEU1)");
    expect(c.html).toContain("Factura a Industher");
    expect(c.html).toContain("Precio sin IVA");
    expect(c.html).toContain("$100.00");
    expect(c.texto).toContain("$100.000 sin IVA");
  });
});
