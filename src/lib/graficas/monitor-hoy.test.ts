import { describe, expect, it } from "vitest";
import { armarMonitorHoy, cambio, minutoMx, restarDias } from "./monitor-hoy";
import type { VentasTiempo } from "./ventas-tiempo";

const HOY = "2026-10-09";
const calzado: VentasTiempo = {
  canal: "meli_calzado",
  dias: [
    { f: "2026-10-02", u: 40, o: 40, i: 8000 },
    { f: "2026-10-08", u: 20, o: 20, i: 4000 },
    { f: HOY, u: 12, o: 12, i: 2400 },
  ],
  // ayer: 10 a las 9 y 10 a las 21; hace una semana: 20 a las 9 y 20 a las 21
  horas: [
    { f: "2026-10-02", h: 9, u: 20, o: 20, i: 4000 },
    { f: "2026-10-02", h: 21, u: 20, o: 20, i: 4000 },
    { f: "2026-10-08", h: 9, u: 10, o: 10, i: 2000 },
    { f: "2026-10-08", h: 21, u: 10, o: 10, i: 2000 },
    { f: HOY, h: 9, u: 12, o: 12, i: 2400 },
  ],
};
const amazon: VentasTiempo = {
  canal: "amazon",
  dias: [
    { f: "2026-10-08", u: 5, o: 5, i: 1000 },
    { f: HOY, u: 2, o: 2, i: 400 },
  ],
  horas: [],
};

describe("monitor de hoy", () => {
  it("fechas y minuto de México", () => {
    expect(restarDias(HOY, 7)).toBe("2026-10-02");
    expect(minutoMx(Date.parse("2026-10-09T16:30:00Z"))).toBe(10 * 60 + 30);
  });

  it("compara contra lo que ayer llevaba A ESTA HORA, no contra el día completo", () => {
    const m = armarMonitorHoy([calzado], HOY, 12 * 60);
    const c = m.canales[0];
    expect(c.hoy.aEstaHora).toEqual({ u: 12, i: 2400 });
    expect(c.ayer.aEstaHora).toEqual({ u: 10, i: 2000 });
    expect(c.ayer.completo).toEqual({ u: 20, i: 4000 });
    expect(c.semana.aEstaHora).toEqual({ u: 20, i: 4000 });
    expect(cambio(m.total.hoy.i, m.total.ayer?.i)).toBeCloseTo(0.2);
  });

  it("la hora en curso cuenta en proporción a sus minutos", () => {
    const m = armarMonitorHoy([calzado], HOY, 9 * 60 + 30);
    expect(m.canales[0].ayer.aEstaHora?.u).toBeCloseTo(5);
  });

  it("las horas se escalan al total del día cuando no todas las órdenes traen hora", () => {
    const parcial: VentasTiempo = { ...calzado, dias: calzado.dias.map((d) => (d.f === "2026-10-08" ? { ...d, u: 40, i: 8000 } : d)) };
    const m = armarMonitorHoy([parcial], HOY, 12 * 60);
    expect(m.canales[0].ayer.aEstaHora).toEqual({ u: 20, i: 4000 });
  });

  it("un canal sin hora sale de la comparación a esta hora y se nombra", () => {
    const m = armarMonitorHoy([calzado, amazon], HOY, 12 * 60);
    expect(m.total.hoy).toEqual({ u: 14, i: 2800 });
    expect(m.total.ayer).toEqual({ u: 10, i: 2000 });
    expect(m.total.ayerCompleto).toEqual({ u: 25, i: 5000 });
    expect(m.sinHoraAyer).toEqual(["Amazon"]);
    // la comparación contra ayer deja fuera lo de hoy de Amazon también
    expect(m.total.hoyContraAyer).toEqual({ u: 12, i: 2400 });
    expect(m.total.hoyContraSemana).toEqual({ u: 14, i: 2800 });
    expect(m.sinHoraSemana).toEqual([]); // sin venta hace una semana: nada que partir
    expect(m.curvas.hoy).toHaveLength(13);
    expect(m.curvas.ayer[23]).toEqual({ u: 20, i: 4000 });
  });

  it("sin base no hay cambio", () => {
    expect(cambio(100, 0)).toBeNull();
    expect(cambio(100, null)).toBeNull();
  });
});
