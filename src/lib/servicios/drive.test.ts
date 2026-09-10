import { describe, expect, it } from "vitest";
import { esHojaDeCalculo, fechaDelListado, leerListadoPublico, MIME_CARPETA, MIME_SHEET } from "./drive";

describe("fecha del listado público", () => {
  const ahora = Date.parse("2026-09-10T15:00:00Z");
  it("sin año es del año corriente; con año se respeta; una hora es hoy; 'Dec 30' visto en enero es del año pasado", () => {
    expect(new Date(fechaDelListado("Sep 8", ahora)).toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(new Date(fechaDelListado("Sep 9, 2025", ahora)).toISOString()).toBe("2025-09-09T00:00:00.000Z");
    expect(new Date(fechaDelListado("10:32 AM", ahora)).toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(new Date(fechaDelListado("Dec 30", Date.parse("2027-01-03T12:00:00Z"))).toISOString()).toBe("2026-12-30T00:00:00.000Z");
    expect(fechaDelListado(undefined)).toBeNaN();
    expect(fechaDelListado("hoy")).toBeNaN();
  });
});

const HTML = `
<div class="flip-entries">
<div class="flip-entry" id="entry-1AbCdEf"><a href="https://drive.google.com/file/d/1AbCdEf/view?usp=drive_web" target="_blank">
<div class="flip-entry-info"><div class="flip-entry-title">S259-2026 PACKING LIST.xlsx</div>
<div class="flip-entry-last-modified"><div>Sep 9, 2026</div></div></div></a></div>
<div class="flip-entry" id="entry-2XyZ"><a href="https://docs.google.com/spreadsheets/d/2XyZ/edit?usp=drive_web">
<div class="flip-entry-title">S260-2026 &amp; fundas</div><div class="flip-entry-last-modified"><div>hoy</div></div></a></div>
<div class="flip-entry" id="entry-3Pdf"><a href="https://drive.google.com/file/d/3Pdf/view"><div class="flip-entry-title">factura.pdf</div></a></div>
<div class="flip-entry flip-entry-folder" id="entry-4Dir"><a href="https://drive.google.com/embeddedfolderview?id=4Dir"><div class="flip-entry-title">S260</div></a></div>
</div>`;

describe("listado público de Drive", () => {
  it("saca id, nombre, tipo y fecha de cada entrada; una hoja de Google se reconoce por su enlace", () => {
    const a = leerListadoPublico(HTML);
    expect(a.map((x) => x.id)).toEqual(["1AbCdEf", "2XyZ", "3Pdf", "4Dir"]);
    expect(a[3]).toMatchObject({ nombre: "S260", mime: MIME_CARPETA });
    expect(a[0]).toMatchObject({ nombre: "S259-2026 PACKING LIST.xlsx", modificadoEn: "2026-09-09T00:00:00.000Z" });
    expect(a[1]).toMatchObject({ nombre: "S260-2026 & fundas", mime: MIME_SHEET, modificadoEn: null });
    expect(a.filter(esHojaDeCalculo).map((x) => x.id)).toEqual(["1AbCdEf", "2XyZ"]);
  });
  it("con HTML sin entradas devuelve vacío", () => {
    expect(leerListadoPublico("<html></html>")).toEqual([]);
  });
});
