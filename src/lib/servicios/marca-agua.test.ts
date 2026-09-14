import { describe, expect, it } from "vitest";
import {
  archivosSubtitulos,
  armarSubtitulos,
  comandoMedirVoz,
  escaparDrawtext,
  filtrosSubtitulos,
  oracionesDelGuion,
  tramosDeVoz,
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

  it("agrupa los renglones por oración (la unidad que pausa la voz)", () => {
    const oraciones = oracionesDelGuion("Hola, qué tal. ¿Ya viste estas sandalias de corcho tan bonitas? Sí.");
    expect(oraciones.length).toBe(3);
    expect(oraciones[0]).toEqual(["Hola", "qué tal."]);
    expect(oraciones[2]).toEqual(["Sí."]);
    for (const r of oraciones.flat()) expect(r.length).toBeLessThanOrEqual(26);
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
    const subs = armarSubtitulos("Hola. Qué bonitas sandalias de corcho.", 10);
    const filtros = filtrosSubtitulos(subs);
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
    const archivos = archivosSubtitulos(subs);
    expect(archivos.length).toBe(filtros.length);
    expect(archivos[0]).toMatch(/^printf "%s" ".+" > \/tmp\/sub0\.txt$/);
  });

  it("sin guion no hay filtros y con espacios tampoco", () => {
    expect(armarSubtitulos("", 15)).toEqual([]);
    expect(armarSubtitulos("   ", 15)).toEqual([]);
  });
});

describe("sincronía con la voz (tramos medidos con silencedetect)", () => {
  // Voz de 9 s en un video de 15 s: arranca en 1.2, pausa en 5.0–5.6 y
  // se calla en 9.4. Repartir el guion sobre los 15 s lo dejaba desfasado.
  const SALIDA =
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/medir.bin':\n" +
    "  Duration: 00:00:09.84, start: 0.000000, bitrate: 128 kb/s\n" +
    "[silencedetect @ 0x1] silence_start: 0\n" +
    "[silencedetect @ 0x1] silence_end: 1.2 | silence_duration: 1.2\n" +
    "[silencedetect @ 0x1] silence_start: 5.0\n" +
    "[silencedetect @ 0x1] silence_end: 5.6 | silence_duration: 0.6\n" +
    "[silencedetect @ 0x1] silence_start: 9.4\n" +
    "LISTO_MEDIR";

  it("lee los tramos de voz como el complemento de los silencios", () => {
    expect(tramosDeVoz(SALIDA, 15)).toEqual([
      { desde: 1.2, hasta: 5 },
      { desde: 5.6, hasta: 9.4 },
    ]);
  });

  it("un audio sin silencios es un solo tramo, y sin duración no hay medida", () => {
    expect(tramosDeVoz("Duration: 00:00:07.50, start: 0", 15)).toEqual([{ desde: 0, hasta: 7.5 }]);
    // La pista no puede durar más que el video.
    expect(tramosDeVoz("Duration: 00:00:20.00", 15)).toEqual([{ desde: 0, hasta: 15 }]);
    expect(tramosDeVoz("ffmpeg: error abriendo el archivo", 15)).toBeNull();
    // Un blip de menos de 0.15 s no es voz.
    const conBlip =
      "Duration: 00:00:05.00\nsilence_start: 0\nsilence_end: 2.0\nsilence_start: 2.1\nsilence_end: 3.0";
    expect(tramosDeVoz(conBlip, 5)).toEqual([{ desde: 3, hasta: 5 }]);
  });

  it("con tantas oraciones como tramos, cada oración cae en su tramo", () => {
    const tramos = tramosDeVoz(SALIDA, 15)!;
    const subs = armarSubtitulos(
      "Mira estas sandalias de corcho tan bonitas. No se avientan, se presumen.",
      15,
      tramos,
    );
    // Nada antes de que la voz arranque ni después de que se calle.
    expect(subs[0].desde).toBeCloseTo(1.1, 2);
    expect(subs[subs.length - 1].hasta).toBeCloseTo(9.7, 2);
    // La primera oración vive en el primer tramo; la segunda, en el segundo.
    const primera = subs.filter((s) => /sandalias|corcho|Mira/.test(s.texto));
    const segunda = subs.filter((s) => /avientan|presumen/.test(s.texto));
    for (const s of primera) expect(s.hasta).toBeLessThanOrEqual(5.5);
    // (se adelanta 0.1 s a la voz para que el ojo alcance a leer)
    for (const s of segunda) expect(s.desde).toBeGreaterThanOrEqual(5.5);
    // Ningún renglón vive en la pausa.
    for (const s of subs) expect(s.desde < 5.0 || s.desde >= 5.5).toBe(true);
    for (let i = 1; i < subs.length; i++) expect(subs[i].desde).toBeGreaterThanOrEqual(subs[i - 1].hasta);
  });

  it("si no cuadran oraciones y tramos, el guion se reparte sobre la voz saltando silencios", () => {
    const tramos = tramosDeVoz(SALIDA, 15)!;
    const subs = armarSubtitulos(GUION, 15, tramos); // 6 oraciones, 2 tramos
    expect(subs[0].desde).toBeCloseTo(1.1, 2);
    expect(subs[subs.length - 1].hasta).toBeCloseTo(9.7, 2);
    for (const s of subs) {
      expect(s.hasta).toBeGreaterThan(s.desde);
      // Ningún renglón ARRANCA dentro del silencio.
      expect(s.desde < 5.0 || s.desde >= 5.5).toBe(true);
    }
    // Los renglones se reparten entre los dos tramos, no todos en uno.
    expect(subs.some((s) => s.hasta <= 5.0)).toBe(true);
    expect(subs.some((s) => s.desde >= 5.6)).toBe(true);
  });

  it("sin tramos (no se pudo medir) reparte parejo como antes", () => {
    expect(armarSubtitulos(GUION, 15, null)).toEqual(armarSubtitulos(GUION, 15));
    expect(armarSubtitulos(GUION, 15, [])).toEqual(armarSubtitulos(GUION, 15));
  });

  it("el comando mide la pista filtrada a banda de voz y avisa que terminó", () => {
    const cmd = comandoMedirVoz("https://cdn/voz.m4a");
    expect(cmd).toContain("silencedetect");
    expect(cmd).toContain("highpass");
    expect(cmd).toContain("-f null -");
    expect(cmd).toMatch(/LISTO_MEDIR$/);
  });
});
