import { describe, expect, it } from "vitest";
import { paramsTrasAviso, resultadoEstructurado } from "./mcp";

describe("paramsTrasAviso", () => {
  const params = { model: "marketing_studio_video", prompt: "in the dark" };

  it("usa las generaciones ilimitadas cuando el MCP pregunta", () => {
    expect(paramsTrasAviso({ unlim_choice: true }, params)).toEqual({
      ...params,
      use_unlim: true,
    });
  });

  it("declina el preset recomendado para generar literal", () => {
    const sc = {
      notice: {
        type: "preset_recommendation",
        message: 'This prompt looks like the Higgsfield preset "IN THE DARK".',
        data: { preset: { id: "preset-123", name: "IN THE DARK" } },
      },
    };
    expect(paramsTrasAviso(sc, params)).toEqual({ ...params, declined_preset_id: "preset-123" });
  });

  it("no vuelve a llamar con la misma respuesta ya contestada", () => {
    expect(paramsTrasAviso({ unlim_choice: true }, { ...params, use_unlim: true })).toBeNull();
    const sc = { notice: { type: "preset_recommendation", data: { preset: { id: "p1" } } } };
    expect(paramsTrasAviso(sc, { ...params, declined_preset_id: "p1" })).toBeNull();
  });

  it("un aviso sin preset o una respuesta con folio no es pregunta", () => {
    expect(paramsTrasAviso({ notice: { type: "preset_recommendation" } }, params)).toBeNull();
    expect(paramsTrasAviso({ results: [{ id: "job-1" }] }, params)).toBeNull();
    expect(paramsTrasAviso(null, params)).toBeNull();
  });
});

describe("resultadoEstructurado", () => {
  it("prefiere structuredContent y si no, el primer texto JSON", () => {
    expect(resultadoEstructurado({ structuredContent: { a: 1 } })).toEqual({ a: 1 });
    expect(
      resultadoEstructurado({
        content: [
          { type: "text", text: "no es json" },
          { type: "text", text: '{"b":2}' },
        ],
      }),
    ).toEqual({ b: 2 });
    expect(resultadoEstructurado({})).toBeNull();
  });
});
