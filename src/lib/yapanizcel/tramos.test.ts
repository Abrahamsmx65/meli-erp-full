import { describe, expect, it } from "vitest";
import { avanzarEstado, planearTramos } from "./tramos";

describe("planearTramos", () => {
  it("la primera vez cubre el horizonte en tramos de 7, del más reciente al más viejo", () => {
    const t = planearTramos({ desde: null, hasta: null }, "2026-09-01", 90);
    expect(t[0]).toEqual({ desde: "2026-08-26", hasta: "2026-09-01", tipo: "reciente" });
    expect(t[1]).toEqual({ desde: "2026-08-19", hasta: "2026-08-25", tipo: "atras" });
    expect(t.at(-1)!.desde).toBe("2026-06-04"); // hoy − 89
    // contiguos y sin huecos
    for (let i = 1; i < t.length; i++) {
      const fin = new Date(`${t[i].hasta}T00:00:00Z`);
      fin.setUTCDate(fin.getUTCDate() + 1);
      expect(fin.toISOString().slice(0, 10)).toBe(t[i - 1].desde);
    }
  });

  it("con todo cubierto solo recalcula los últimos 7 días", () => {
    const t = planearTramos({ desde: "2026-06-04", hasta: "2026-09-01" }, "2026-09-01", 90);
    expect(t).toEqual([{ desde: "2026-08-26", hasta: "2026-09-01", tipo: "reciente" }]);
  });

  it("si pasaron días sin sincronizar, el tramo reciente crece hasta hoy", () => {
    const t = planearTramos({ desde: "2026-06-04", hasta: "2026-08-20" }, "2026-09-01", 90);
    expect(t[0]).toEqual({ desde: "2026-08-14", hasta: "2026-09-01", tipo: "reciente" });
  });

  it("si quedó a medias hacia atrás, sigue desde donde iba", () => {
    const t = planearTramos({ desde: "2026-08-19", hasta: "2026-09-01" }, "2026-09-01", 90);
    expect(t[0].tipo).toBe("reciente");
    expect(t[1]).toEqual({ desde: "2026-08-12", hasta: "2026-08-18", tipo: "atras" });
  });
});

describe("avanzarEstado", () => {
  it("extiende el rango cubierto sin encogerlo", () => {
    let e = avanzarEstado({ desde: null, hasta: null }, { desde: "2026-08-26", hasta: "2026-09-01", tipo: "reciente" });
    expect(e).toEqual({ desde: "2026-08-26", hasta: "2026-09-01" });
    e = avanzarEstado(e, { desde: "2026-08-19", hasta: "2026-08-25", tipo: "atras" });
    expect(e).toEqual({ desde: "2026-08-19", hasta: "2026-09-01" });
    e = avanzarEstado(e, { desde: "2026-08-30", hasta: "2026-09-02", tipo: "reciente" });
    expect(e).toEqual({ desde: "2026-08-19", hasta: "2026-09-02" });
  });
});

describe("horizonte de 180 días", () => {
  it("con 90 días cubiertos sigue hacia atrás hasta completar medio año", () => {
    const t = planearTramos({ desde: "2026-06-04", hasta: "2026-09-01" }, "2026-09-01");
    expect(t[0].tipo).toBe("reciente");
    expect(t[1]).toEqual({ desde: "2026-05-28", hasta: "2026-06-03", tipo: "atras" });
    expect(t.at(-1)!.desde).toBe("2026-03-06"); // hoy − 179
  });
});
