/**
 * Clips de MELI en publicaciones agrupadas: qué formas de respuesta se
 * entienden y a quién le toca el video de quién.
 *
 * El caso que motivó esto: con el agrupador de variantes cada color es su
 * propio MLM, el clip se sube a UNA variante y las hermanas quedan sin video
 * (menos exposición) aunque en la página agrupada "se vea".
 */
import { describe, expect, it } from "vitest";
import {
  elegirClipFuente,
  normalizarClips,
  planAplicaciones,
  tieneClipVivo,
  type FilaPlan,
} from "./clips";

describe("normalizarClips: la respuesta de MELI venga como venga", () => {
  it("entiende la envoltura {clips: [...]}", () => {
    const clips = normalizarClips({
      clips: [{ id: "abc", status: "ACTIVE", url: "https://cdn.meli.com/v/abc.mp4" }],
    });
    expect(clips).toHaveLength(1);
    expect(clips[0].id).toBe("abc");
    expect(clips[0].estado).toBe("active");
    expect(clips[0].url).toBe("https://cdn.meli.com/v/abc.mp4");
  });

  it("entiende la lista directa y {results: [...]}", () => {
    expect(normalizarClips([{ clip_uuid: "x1" }])).toHaveLength(1);
    expect(normalizarClips({ results: [{ uuid: "x2" }, { uuid: "x3" }] })).toHaveLength(2);
  });

  it("entiende un objeto suelto (un solo clip sin envoltura)", () => {
    const clips = normalizarClips({ clip_id: "solo", state: "approved" });
    expect(clips).toHaveLength(1);
    expect(clips[0].id).toBe("solo");
    expect(clips[0].estado).toBe("approved");
  });

  it("encuentra la URL del video aunque venga anidada, sin confundir el thumbnail", () => {
    const clips = normalizarClips({
      clips: [
        {
          id: "n",
          thumbnail: "https://cdn.meli.com/miniatura.jpg",
          media: { video: { playback_url: "https://cdn.meli.com/video/n.mp4?token=1" } },
        },
      ],
    });
    expect(clips[0].url).toBe("https://cdn.meli.com/video/n.mp4?token=1");
  });

  it("con basura o vacío no truena: lista vacía", () => {
    expect(normalizarClips(null)).toEqual([]);
    expect(normalizarClips("texto")).toEqual([]);
    expect(normalizarClips({})).toEqual([]);
    expect(normalizarClips({ clips: [] })).toEqual([]);
  });

  it("conserva el crudo completo para poder revisar sin re-escanear", () => {
    const crudo = { id: "k", campo_raro: 42 };
    expect(normalizarClips([crudo])[0].crudo).toEqual(crudo);
  });
});

describe("tieneClipVivo y elegirClipFuente", () => {
  it("un clip rechazado o borrado no cuenta como clip", () => {
    expect(tieneClipVivo(normalizarClips([{ id: "a", status: "rejected" }]))).toBe(false);
    expect(tieneClipVivo(normalizarClips([{ id: "a", status: "deleted" }]))).toBe(false);
    expect(
      tieneClipVivo(normalizarClips([{ id: "a", status: "rejected" }, { id: "b", status: "active" }])),
    ).toBe(true);
  });

  it("sin estado se asume vivo: mejor enseñarlo que esconderlo", () => {
    expect(tieneClipVivo(normalizarClips([{ id: "a" }]))).toBe(true);
  });

  it("de fuente prefiere el clip ya aprobado con URL", () => {
    const clips = normalizarClips([
      { id: "moderando", status: "in_process", url: "https://x.com/mod.mp4" },
      { id: "bueno", status: "active", url: "https://x.com/bueno.mp4" },
    ]);
    expect(elegirClipFuente(clips)?.id).toBe("bueno");
  });

  it("sin URL descargable no hay fuente: no se inventa nada", () => {
    expect(elegirClipFuente(normalizarClips([{ id: "a", status: "active" }]))).toBeNull();
  });
});

describe("planAplicaciones: a quién le toca el video de quién", () => {
  const fila = (extra: Partial<FilaPlan>): FilaPlan => ({
    itemId: "MLM1",
    modelo: "GT104",
    estadoPub: "active",
    tieneClip: false,
    clipUrl: null,
    videoErpUrl: null,
    enCola: false,
    ...extra,
  });

  it("propaga el clip de la hermana a las demás variantes del MISMO modelo", () => {
    const plan = planAplicaciones([
      fila({ itemId: "MLM1", tieneClip: true, clipUrl: "https://x.com/gt104.mp4" }),
      fila({ itemId: "MLM2" }),
      fila({ itemId: "MLM3" }),
      fila({ itemId: "MLM9", modelo: "GT200" }), // otro modelo: ni lo toca
    ]);
    expect(plan.map((a) => a.itemId).sort()).toEqual(["MLM2", "MLM3"]);
    expect(plan[0].origenItemId).toBe("MLM1");
    expect(plan[0].url).toBe("https://x.com/gt104.mp4");
    expect(plan[0].origen).toBe("hermana");
  });

  it("las pausadas no entran: MELI solo acepta clips en publicaciones activas", () => {
    const plan = planAplicaciones([
      fila({ itemId: "MLM1", tieneClip: true, clipUrl: "https://x.com/v.mp4" }),
      fila({ itemId: "MLM2", estadoPub: "paused" }),
    ]);
    expect(plan).toEqual([]);
  });

  it("lo que ya está en cola o ya tiene clip no se vuelve a encolar", () => {
    const plan = planAplicaciones([
      fila({ itemId: "MLM1", tieneClip: true, clipUrl: "https://x.com/v.mp4" }),
      fila({ itemId: "MLM2", enCola: true }),
      fila({ itemId: "MLM3", tieneClip: true }),
    ]);
    expect(plan).toEqual([]);
  });

  it("sin hermana con URL, el video del ERP es el respaldo", () => {
    const plan = planAplicaciones([
      // Tiene clip pero MELI no dio URL descargable: no sirve de fuente.
      fila({ itemId: "MLM1", tieneClip: true }),
      fila({ itemId: "MLM2", videoErpUrl: "https://storage.erp.com/gt104.mp4" }),
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      itemId: "MLM2",
      origenItemId: null,
      url: "https://storage.erp.com/gt104.mp4",
      origen: "erp",
    });
  });

  it("sin ninguna fuente, el modelo se queda como está (visible, no encolado)", () => {
    expect(planAplicaciones([fila({ itemId: "MLM1" }), fila({ itemId: "MLM2" })])).toEqual([]);
  });

  it("sin modelo no hay grupo: no se puede saber quién es hermana de quién", () => {
    expect(
      planAplicaciones([
        fila({ itemId: "MLM1", modelo: null, tieneClip: true, clipUrl: "https://x.com/v.mp4" }),
        fila({ itemId: "MLM2", modelo: null }),
      ]),
    ).toEqual([]);
  });
});
