import { describe, expect, it } from "vitest";
import { mismoMomentoParaCuadrar, rangosDeAtajos } from "./ventas-vista";

describe("rangosDeAtajos", () => {
  it("da los atajos del filtro de fechas, 7 días primero y sin repetir", () => {
    expect(rangosDeAtajos("2026-10-10")).toEqual([
      { desde: "2026-10-04", hasta: "2026-10-10" },
      { desde: "2026-10-10", hasta: "2026-10-10" },
      { desde: "2026-09-11", hasta: "2026-10-10" },
      { desde: "2026-10-01", hasta: "2026-10-10" },
      { desde: "2026-09-26", hasta: "2026-10-10" },
      { desde: "2026-10-09", hasta: "2026-10-09" },
    ]);
  });

  it("el día 1 «Este mes» es lo mismo que «Hoy» y no se repite", () => {
    const r = rangosDeAtajos("2026-11-01");
    expect(r.filter((x) => x.desde === "2026-11-01" && x.hasta === "2026-11-01")).toHaveLength(1);
    expect(r).toHaveLength(5);
  });
});

describe("mismoMomentoParaCuadrar", () => {
  const ahora = Date.parse("2026-10-11T15:00:00Z");
  it("un periodo cerrado siempre se cuadra", () => {
    expect(mismoMomentoParaCuadrar({ desde: "2026-10-01", hasta: "2026-10-10" }, null, ahora, "2026-10-11")).toBe(true);
  });
  it("con hoy dentro, solo si el dinero es de hace menos de un minuto", () => {
    const r = { desde: "2026-10-05", hasta: "2026-10-11" };
    expect(mismoMomentoParaCuadrar(r, "2026-10-11T14:59:30Z", ahora, "2026-10-11")).toBe(true);
    expect(mismoMomentoParaCuadrar(r, "2026-10-11T14:50:00Z", ahora, "2026-10-11")).toBe(false);
    expect(mismoMomentoParaCuadrar(r, null, ahora, "2026-10-11")).toBe(false);
  });
});
