import { describe, expect, it } from "vitest";
import { esquemaPedido, resumir, traducirErrorRpc } from "../pedidos";
import type { Pedido } from "../tipos";

function pedido(sobre: Partial<Pedido>): Pedido {
  return {
    id: crypto.randomUUID(), evento_id: "e", referencia: "EV-AAAAAA", nombre: "Ana", correo: "a@a.mx",
    telefono: null, cantidad: 2, total: 500, estado: "pendiente", comprobante_ruta: null, aviso_pago_en: null,
    pagado_en: null, confirmado_por: null, cancelado_en: null, notas: null, correo_enviado_en: null,
    creado_en: new Date().toISOString(), ...sobre,
  };
}

describe("esquema del pedido", () => {
  it("normaliza correo y acepta cantidad como texto del formulario", () => {
    const r = esquemaPedido.parse({
      evento_id: "8f4d6b6e-9d1f-4a5c-9f4e-2f2b1e0c9a10",
      nombre: "  Ana López ",
      correo: " ANA@Correo.MX ",
      telefono: "",
      cantidad: "3",
    });
    expect(r.nombre).toBe("Ana López");
    expect(r.correo).toBe("ana@correo.mx");
    expect(r.cantidad).toBe(3);
  });

  it("rechaza nombre corto, correo malo y cantidad cero", () => {
    const base = { evento_id: "8f4d6b6e-9d1f-4a5c-9f4e-2f2b1e0c9a10", nombre: "Ana López", correo: "a@a.mx", cantidad: 1 };
    expect(esquemaPedido.safeParse({ ...base, nombre: "Al" }).success).toBe(false);
    expect(esquemaPedido.safeParse({ ...base, correo: "no-es-correo" }).success).toBe(false);
    expect(esquemaPedido.safeParse({ ...base, cantidad: 0 }).success).toBe(false);
  });
});

describe("errores de la base traducidos", () => {
  it("convierte las claves del RPC en mensajes para el comprador", () => {
    expect(traducirErrorRpc('P0001: SIN_LUGARES')).toMatch(/lugares/);
    expect(traducirErrorRpc('EVENTO_INACTIVO')).toMatch(/cerrada/);
    expect(traducirErrorRpc('otra cosa')).toMatch(/Intenta de nuevo/);
  });
});

describe("resumen del panel", () => {
  it("cuenta pedidos por estado, boletos pagados, usados y dinero", () => {
    const p1 = pedido({ estado: "pagado", cantidad: 2, total: 500 });
    const p2 = pedido({ estado: "pagado", cantidad: 1, total: 250 });
    const p3 = pedido({ estado: "por_confirmar" });
    const p4 = pedido({ estado: "pendiente" });
    const p5 = pedido({ estado: "cancelado", cantidad: 4 });
    const r = resumir(
      [p1, p2, p3, p4, p5],
      [
        { estado: "usado", pedido_id: p1.id },
        { estado: "valido", pedido_id: p1.id },
        { estado: "usado", pedido_id: p2.id },
        // un boleto usado de un pedido cancelado no cuenta
        { estado: "usado", pedido_id: p5.id },
      ],
    );
    expect(r).toEqual({
      total: 5, pendientes: 1, porConfirmar: 1, pagados: 2, cancelados: 1,
      boletosPagados: 3, boletosUsados: 2, dinero: 750,
    });
  });
});
