import { describe, expect, it } from "vitest";
import {
  FALLOS_PARA_RENDIRSE,
  anotarExito,
  anotarFallo,
  anotarSalto,
  avisoDeGuardia,
  crearGuardia,
  debePreguntar,
} from "./recoleccion";

describe("guardia de horarios de recolección", () => {
  it("después de tres fallos seguidos deja de preguntar", () => {
    const g = crearGuardia();
    for (let i = 0; i < FALLOS_PARA_RENDIRSE; i++) {
      expect(debePreguntar(g)).toBe(true);
      anotarFallo(g, "Internal error. Please try again.");
    }
    expect(debePreguntar(g)).toBe(false);
  });

  it("un éxito en medio reinicia la cuenta: dos fallos sueltos no la rinden", () => {
    const g = crearGuardia();
    anotarFallo(g, "x");
    anotarFallo(g, "x");
    anotarExito(g);
    anotarFallo(g, "x");
    expect(debePreguntar(g)).toBe(true);
    expect(g.fallos).toBe(3);
  });

  it("sin fallos no hay aviso", () => {
    expect(avisoDeGuardia(crearGuardia())).toBeNull();
  });

  it("el aviso dice cuántos salieron como recolección sin hora, qué contestó TikTok y que se dejó de preguntar", () => {
    const g = crearGuardia();
    anotarFallo(g, "e1");
    anotarFallo(g, "e2");
    anotarFallo(g, "Internal error. Please try again.");
    anotarSalto(g);
    anotarSalto(g);
    const a = avisoDeGuardia(g)!;
    expect(a).toContain("5 paquetes");
    expect(a).toContain("Internal error. Please try again.");
    expect(a).toContain("recolección sin hora fija");
    expect(a).toContain("ya no se le preguntó");
  });

  it("un solo fallo sin rendirse no dice que dejó de preguntar", () => {
    const g = crearGuardia();
    anotarFallo(g, "e");
    const a = avisoDeGuardia(g)!;
    expect(a).toContain("1 paquete");
    expect(a).not.toContain("ya no se le preguntó");
  });
});
