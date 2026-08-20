/**
 * El sheet de corridas se baja como .xlsx y pasa por el importador de
 * siempre; aquí se prueba la conversión de URL, la detección de pestaña y
 * las defensas de la descarga (sheet privado, URL ajena).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  descargarSheetCorridas,
  importarCorridasDeLibro,
  urlExportacionSheets,
} from "./corridas-sheets";

const URL_SHEET =
  "https://docs.google.com/spreadsheets/d/1HfJEFXNObD8gIaFiFb7AftHeIxuBduj9YB_TkJZpB2c/edit?gid=0#gid=0";

describe("urlExportacionSheets", () => {
  it("convierte la URL del navegador en la URL de exportación a xlsx", () => {
    expect(urlExportacionSheets(URL_SHEET)).toBe(
      "https://docs.google.com/spreadsheets/d/1HfJEFXNObD8gIaFiFb7AftHeIxuBduj9YB_TkJZpB2c/export?format=xlsx",
    );
  });

  it("acepta la URL sin sufijos", () => {
    expect(
      urlExportacionSheets("https://docs.google.com/spreadsheets/d/abc123_-XYZ"),
    ).toContain("/d/abc123_-XYZ/export?format=xlsx");
  });

  it("rechaza URLs que no son de Google Sheets", () => {
    expect(() => urlExportacionSheets("https://ejemplo.com/archivo.xlsx")).toThrow(
      /Google Sheets/,
    );
  });
});

describe("importarCorridasDeLibro", () => {
  const bufCorridas = readFileSync(join(process.cwd(), "fixtures", "CORRIDAS_BASE.xlsx"));

  it("encuentra la pestaña de corridas y la lee con el importador real", async () => {
    const r = await importarCorridasDeLibro(bufCorridas);
    expect(r.corridas.length).toBeGreaterThan(0);
    expect(r.hoja).toBeTruthy();
    expect(r.tallas.length).toBeGreaterThan(0);
  });

  it("truena con mensaje claro si ninguna pestaña trae las columnas", async () => {
    // Un xlsx real que NO es de corridas: el reporte de existencias.
    const otro = readFileSync(join(process.cwd(), "fixtures", "ExistenciasGlobales.xlsx"));
    await expect(importarCorridasDeLibro(otro)).rejects.toThrow(/Ninguna pestaña/);
  });
});

describe("descargarSheetCorridas", () => {
  beforeEach(() => {
    vi.stubEnv("CORRIDAS_SHEET_URL", URL_SHEET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("pide la URL de exportación y regresa el archivo", async () => {
    const llamadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        llamadas.push(String(url));
        // "PK" + relleno: suficiente para pasar la revisión de que es un ZIP.
        return new Response(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), { status: 200 });
      }),
    );

    const buf = await descargarSheetCorridas();
    expect(buf[0]).toBe(0x50);
    expect(llamadas[0]).toContain("/export?format=xlsx");
    expect(llamadas[0]).not.toContain("edit");
  });

  it("si Google regresa HTML (sheet privado), lo dice con instrucciones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Sign in</html>", { status: 200 })),
    );

    await expect(descargarSheetCorridas()).rejects.toThrow(/no es público/);
  });

  it("sin CORRIDAS_SHEET_URL truena con instrucción clara, sin llamar a Google", async () => {
    vi.stubEnv("CORRIDAS_SHEET_URL", "");
    const espia = vi.fn();
    vi.stubGlobal("fetch", espia);

    await expect(descargarSheetCorridas()).rejects.toThrow(/CORRIDAS_SHEET_URL/);
    expect(espia).not.toHaveBeenCalled();
  });
});
