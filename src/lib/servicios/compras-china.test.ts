import { describe, expect, it } from "vitest";
import {
  EDAD_COMPRA_CHINA_CON_AVISOS_MS,
  EDAD_COMPRA_CHINA_MS,
  compraChinaNecesitaRefresco,
  tieneAvisos,
} from "./compras-china";

const ahora = Date.parse("2026-10-09T12:00:00Z");
const hace = (ms: number) => new Date(ahora - ms).toISOString();

describe("cuándo el latido rehace la sugerencia de compra a China", () => {
  it("sin renglón o invalidado, siempre", () => {
    expect(compraChinaNecesitaRefresco(null, ahora)).toBe(true);
    expect(compraChinaNecesitaRefresco({ generadoEn: hace(1_000), vigente: false, conAvisos: false }, ahora)).toBe(true);
  });
  it("fresco y sin avisos, no; pasada su media hora, sí", () => {
    expect(compraChinaNecesitaRefresco({ generadoEn: hace(10 * 60_000), vigente: true, conAvisos: false }, ahora)).toBe(false);
    expect(
      compraChinaNecesitaRefresco({ generadoEn: hace(EDAD_COMPRA_CHINA_MS + 1), vigente: true, conAvisos: false }, ahora),
    ).toBe(true);
  });
  it("con avisos de Amazon o TikTok se reintenta con la vida corta", () => {
    expect(
      compraChinaNecesitaRefresco(
        { generadoEn: hace(EDAD_COMPRA_CHINA_CON_AVISOS_MS - 1), vigente: true, conAvisos: true },
        ahora,
      ),
    ).toBe(false);
    expect(
      compraChinaNecesitaRefresco(
        { generadoEn: hace(EDAD_COMPRA_CHINA_CON_AVISOS_MS + 1), vigente: true, conAvisos: true },
        ahora,
      ),
    ).toBe(true);
  });
  it("una fecha ilegible se rehace", () => {
    expect(compraChinaNecesitaRefresco({ generadoEn: "basura", vigente: true, conAvisos: false }, ahora)).toBe(true);
  });
});

describe("avisos guardados con la sugerencia", () => {
  const limpio = { advertencias: [], disponible: true };
  it("sin avisos ni canales caídos, no hay avisos", () => {
    expect(tieneAvisos({ amazon: limpio, tiktok: limpio })).toBe(false);
  });
  it("un aviso o un canal no disponible cuenta", () => {
    expect(tieneAvisos({ amazon: { advertencias: ["x"], disponible: true }, tiktok: limpio })).toBe(true);
    expect(tieneAvisos({ amazon: limpio, tiktok: { advertencias: [], disponible: false } })).toBe(true);
  });
});
