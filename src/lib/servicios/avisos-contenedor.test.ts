import { describe, expect, it } from "vitest";
import { avisoQueToca, correoDeLlegada, type ContenedorParaAviso } from "./avisos-contenedor";

const base: ContenedorParaAviso = {
  id: "c1",
  numero: "S260-2026",
  estado: "en_transito",
  llegadaEst: "2026-09-20",
  llegadaReal: null,
  avisoPrevioEn: null,
  avisoLlegadaEn: null,
};

describe("qué recordatorio le toca al contenedor", () => {
  it("una semana antes de la llegada estimada avisa de las fotos, y no antes", () => {
    expect(avisoQueToca(base, "2026-09-12")).toBeNull();
    expect(avisoQueToca(base, "2026-09-13")).toBe("previo");
    expect(avisoQueToca(base, "2026-09-19")).toBe("previo");
  });

  it("el día que llega avisa la llegada, aunque nunca se haya mandado el previo", () => {
    expect(avisoQueToca(base, "2026-09-20")).toBe("llegada");
    expect(avisoQueToca({ ...base, avisoPrevioEn: null }, "2026-09-21")).toBe("llegada");
  });

  it("cada aviso se manda UNA vez", () => {
    expect(avisoQueToca({ ...base, avisoPrevioEn: "2026-09-13T13:00:00Z" }, "2026-09-14")).toBeNull();
    expect(avisoQueToca({ ...base, avisoLlegadaEn: "2026-09-20T13:00:00Z" }, "2026-09-21")).toBeNull();
  });

  it("un contenedor ya recibido no manda nada", () => {
    expect(avisoQueToca({ ...base, estado: "recibido" }, "2026-09-20")).toBeNull();
  });

  it("la fecha real manda sobre la estimada", () => {
    expect(avisoQueToca({ ...base, llegadaReal: "2026-09-18" }, "2026-09-18")).toBe("llegada");
    // Adelantado: el 17 todavía no llega, pero ya está dentro de la semana previa.
    expect(avisoQueToca({ ...base, llegadaReal: "2026-09-18" }, "2026-09-17")).toBe("previo");
  });

  it("un contenedor viejo no llueve correo el día que se prende esto", () => {
    expect(avisoQueToca({ ...base, llegadaEst: "2026-06-01" }, "2026-09-20")).toBeNull();
  });

  it("sin fecha de llegada no hay nada que recordar", () => {
    expect(avisoQueToca({ ...base, llegadaEst: null }, "2026-09-20")).toBeNull();
  });
});

describe("el correo de llegada", () => {
  it("dice qué contenedor, cuántas cajas y de qué pedidos", () => {
    const c = correoDeLlegada({
      numero: "S260-2026",
      numeroNaviera: "HMMU4106958",
      cajas: 611,
      modelos: [
        { modelo: "GT150", color: "M BROWN", cajas: 107 },
        { modelo: "GT217", color: "TAN", cajas: 31 },
      ],
      pedidos: ["IN10079"],
    });
    expect(c.asunto).toBe("Llegó a USA el contenedor S260-2026 (HMMU4106958)");
    expect(c.texto).toContain("611 cajas · pedidos IN10079");
    expect(c.texto).toContain("- GT150 M BROWN: 107 cajas");
    expect(c.html).toContain("<td>GT217</td>");
  });
});
