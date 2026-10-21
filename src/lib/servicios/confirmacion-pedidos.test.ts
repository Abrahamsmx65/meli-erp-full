import { describe, expect, it } from "vitest";
import {
  armarCorreoConfirmacion,
  hayQueAvisar,
  nuevosConfirmadosDesde,
  type RevisionConfirmacion,
} from "./confirmacion-pedidos";
import type { ConfirmacionPedido } from "./pedidos-sheet";

function c(pedido: string, estado: ConfirmacionPedido["estado"], extra: Partial<ConfirmacionPedido> = {}): ConfirmacionPedido {
  return {
    pedido,
    estado,
    fechaConfirm: null,
    embarque: null,
    fabrica: null,
    paresSheet: null,
    paresErp: 1000,
    modelos: ["GT142"],
    creadoEn: "2026-10-21T15:00:00Z",
    ...extra,
  };
}

describe("nuevosConfirmadosDesde", () => {
  it("solo los confirmados que la revisión anterior no tenía", () => {
    const lista = [c("IN10192", "falta"), c("IN10190", "confirmado"), c("IN10189", "confirmado")];
    expect(nuevosConfirmadosDesde(lista, ["in10189"])).toEqual(["IN10190"]);
    expect(nuevosConfirmadosDesde(lista, null)).toEqual(["IN10190", "IN10189"]);
    expect(nuevosConfirmadosDesde(lista, ["IN10190", "IN10189"])).toEqual([]);
  });
});

describe("hayQueAvisar", () => {
  it("avisa si falta alguno o alguno se confirmó desde ayer; si no, calla", () => {
    expect(hayQueAvisar({ faltan: 1, nuevosConfirmados: [] })).toBe(true);
    expect(hayQueAvisar({ faltan: 0, nuevosConfirmados: ["IN10190"] })).toBe(true);
    expect(hayQueAvisar({ faltan: 0, nuevosConfirmados: [] })).toBe(false);
  });
});

describe("armarCorreoConfirmacion", () => {
  const base: RevisionConfirmacion = {
    dia: "2026-10-22",
    revisadoEn: "2026-10-22T14:00:00Z",
    confirmacion: [
      c("IN10192", "falta", { modelos: ["GT142"], paresErp: 3120 }),
      c("IN10190", "confirmado", { fechaConfirm: "Oct 21", paresErp: 5232, paresSheet: 5232, modelos: ["GT104-3"] }),
      c("IN10189", "confirmado", { paresErp: 4500, paresSheet: 4560, modelos: ["GT128"] }),
      c("IN10161", "fuera", { paresErp: 4080, modelos: ["GT142"], creadoEn: "2026-09-04T15:00:00Z" }),
    ],
    nuevosConfirmados: ["IN10190"],
    faltan: 1,
    confirmados: 2,
  };

  it("el asunto dice cuántos faltan y el cuerpo separa lo que falta de lo confirmado", () => {
    const { asunto, html, texto } = armarCorreoConfirmacion(base);
    expect(asunto).toBe("Pedidos a China: 1 por confirmar · 2026-10-22");
    expect(html).toContain("Falta confirmar");
    expect(html).toContain("IN10192");
    expect(html).toContain("Confirmado · Oct 21 · nuevo");
    // pares distintos entre el ERP y el sheet se dicen, no se tapan
    expect(html).toContain("sheet: 4,560");
    expect(texto).toContain("IN10192 · GT142 · 3,120 pares · FALTA CONFIRMAR");
    expect(texto).toContain("IN10190 · GT104-3 · 5,232 pares · confirmado Oct 21");
    // el viejo que China ya quitó del sheet no va en el correo
    expect(html).not.toContain("IN10161");
    expect(texto).not.toContain("IN10161");
  });

  it("con todo confirmado lo dice en el asunto", () => {
    const { asunto } = armarCorreoConfirmacion({
      ...base,
      confirmacion: base.confirmacion.filter((x) => x.estado === "confirmado"),
      faltan: 0,
    });
    expect(asunto).toBe("Pedidos a China: todo confirmado · 2026-10-22");
  });
});
