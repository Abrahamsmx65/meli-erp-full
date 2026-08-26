import { describe, expect, it } from "vitest";
import {
  archivosSubtitulos,
  armarSubtitulos,
  escaparDrawtext,
  filtrosSubtitulos,
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
