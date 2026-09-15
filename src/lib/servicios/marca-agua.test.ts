import { describe, expect, it } from "vitest";
import {
  alinearSubtitulos,
  archivosSubtitulos,
  armarSubtitulos,
  escaparDrawtext,
  filtrosSubtitulos,
  parsearSilencios,
} from "./marca-agua";

const GUION =
  "¡FERNANDO! ¡Ahora sí, ven para acá! Ay… no. Está demasiado bonita para " +
  "gastártela a ti. O sea, mira ese corcho, la correa, el detallito. Esta " +
  'sandalia no se avienta… "se presume".';

describe("subtítulos del ERP (quemados con el guion exacto)", () => {
  it("parte el guion en renglones cortos que cubren todo el video en orden", () => {
    const subs = armarSubtitulos(GUION, 15);
    expect(subs.length).toBeGreaterThan(3);
    for (const s of subs) {
      expect(s.texto.length).toBeLessThanOrEqual(26);
      expect(s.hasta).toBeGreaterThan(s.desde);
    }
    // En orden y sin huecos gigantes: el siguiente arranca donde acabó el otro.
    for (let i = 1; i < subs.length; i++) {
      expect(subs[i].desde).toBeGreaterThanOrEqual(subs[i - 1].desde);
    }
    // El último termina pegado al final del video.
    expect(subs[subs.length - 1].hasta).toBeCloseTo(14.8, 1);
  });

  it("el texto queda seguro para drawtext dentro de un comando de shell", () => {
    const feo = `dijo "hola", 100% real: $VAR \`ls\` a; b \\ fin`;
    const limpio = escaparDrawtext(feo);
    // Nada que rompa las comillas dobles del shell ni el filtro.
    expect(limpio).not.toMatch(/["\\$;`%]/);
    // El apóstrofo sobrevive como tipográfico (drawtext lo pinta bien).
    expect(escaparDrawtext("l'engua")).toContain("’");
  });

  it("los filtros usan la fuente, ventanas de tiempo y centrado", () => {
    const filtros = filtrosSubtitulos("Hola. Qué bonitas sandalias de corcho.", 10);
    expect(filtros.length).toBeGreaterThan(0);
    for (const f of filtros) {
      expect(f).toContain("fontfile=/tmp/marca.ttf");
      // El texto va en archivo (textfile=): los dos puntos del guion
      // rompían el filtro si iban incrustados.
      expect(f).toContain("textfile=/tmp/sub");
      expect(f).not.toContain("text='");
      expect(f).toContain("x=(w-tw)/2");
      expect(f).toMatch(/enable='between\(t,[\d.]+,[\d.]+\)'/);
    }
    // Y los comandos que escriben cada renglón existen y son parejos.
    const archivos = archivosSubtitulos("Hola. Qué bonitas sandalias de corcho.", 10);
    expect(archivos.length).toBe(filtros.length);
    expect(archivos[0]).toMatch(/^printf "%s" ".+" > \/tmp\/sub0\.txt$/);
  });

  it("sin guion no hay filtros y con espacios tampoco", () => {
    expect(armarSubtitulos("", 15)).toEqual([]);
    expect(armarSubtitulos("   ", 15)).toEqual([]);
  });
});

// Salida real de silencedetect sobre un video generado (probada con ffmpeg):
// habla en [0, 1.36], [3.12, 3.55], [4.31, 5.18] y [5.70, 15.07].
const SALIDA_REAL =
  "silence_start: 1.36383\nsilence_end: 3.1166\n" +
  "silence_start: 3.54528\nsilence_end: 4.31061\n" +
  "silence_start: 5.17694\nsilence_end: 5.70007";

describe("alineación de subtítulos a la voz (silencedetect)", () => {
  it("convierte los silencios en tramos de habla, en orden y sin traslapes", () => {
    const habla = parsearSilencios(SALIDA_REAL, 15.07);
    expect(habla).toHaveLength(4);
    expect(habla[0].desde).toBe(0);
    expect(habla[0].hasta).toBeCloseTo(1.36, 1);
    expect(habla[3].desde).toBeCloseTo(5.7, 1);
    expect(habla[3].hasta).toBeCloseTo(15.07, 2);
    for (let i = 1; i < habla.length; i++) {
      expect(habla[i].desde).toBeGreaterThanOrEqual(habla[i - 1].hasta);
    }
  });

  it("un silencio al arranque retrasa el primer renglón hasta que la voz empieza", () => {
    const habla = parsearSilencios("silence_start: 0\nsilence_end: 2.5", 15);
    expect(habla[0].desde).toBeCloseTo(2.5, 2);
    const subs = alinearSubtitulos(armarSubtitulos("Hola. Qué bonito día hoy.", 15), habla);
    expect(subs[0].desde).toBeCloseTo(2.5, 2);
  });

  it("un silencio sin cierre (al final del archivo) apaga los subtítulos ahí", () => {
    const habla = parsearSilencios("silence_start: 11.2", 15);
    expect(habla).toEqual([{ desde: 0, hasta: 11.2 }]);
    const subs = alinearSubtitulos(armarSubtitulos("Hola. Adiós y gracias.", 15), habla);
    expect(subs[subs.length - 1].hasta).toBeCloseTo(11.2, 1);
  });

  it("sin silencios detectados todo el audio es habla (cae al reparto de siempre)", () => {
    expect(parsearSilencios("", 12)).toEqual([{ desde: 0, hasta: 12 }]);
  });

  it("alinea los renglones dentro del habla, monotónicos y sin encoger de más", () => {
    const habla = parsearSilencios(SALIDA_REAL, 15.07);
    const subs = alinearSubtitulos(
      armarSubtitulos(
        "¡Fernando! Ven para acá ahora mismo. Está demasiado bonita. Mira el corcho y la correa. No se avienta, se presume.",
        15.07,
      ),
      habla,
    );
    expect(subs.length).toBeGreaterThan(3);
    // El primero arranca con la voz (no antes) y el último acaba con ella.
    expect(subs[0].desde).toBe(0);
    expect(subs[subs.length - 1].hasta).toBeCloseTo(15.07, 1);
    for (let i = 0; i < subs.length; i++) {
      expect(subs[i].hasta).toBeGreaterThan(subs[i].desde);
      if (i > 0) expect(subs[i].desde).toBeGreaterThanOrEqual(subs[i - 1].desde);
      // Cada inicio cae DENTRO de un tramo con voz (o en su borde).
      const dentro = habla.some(
        (h) => subs[i].desde >= h.desde - 0.01 && subs[i].desde <= h.hasta + 0.01,
      );
      expect(dentro).toBe(true);
    }
  });

  it("con habla vacía o demasiado corta no toca los subtítulos", () => {
    const subs = armarSubtitulos("Hola. Adiós.", 10);
    expect(alinearSubtitulos(subs, [])).toEqual(subs);
    expect(alinearSubtitulos(subs, [{ desde: 0, hasta: 0.3 }])).toEqual(subs);
  });
});
