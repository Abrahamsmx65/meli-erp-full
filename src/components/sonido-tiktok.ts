/**
 * La bocina de las estaciones de TikTok (preparar y contar): pitidos
 * sintetizados y voz en español del propio navegador. Solo corre en el
 * navegador; en el servidor nadie la llama.
 */

/**
 * Pitidos sin archivos: agudo si bien —uno por par: dos pares, dos
 * pitidos, para que se oiga cuántos van en la caja—, grave y doble si mal.
 */
export function pitar(bien: boolean, veces = 1) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const tono = (f: number, t0: number, dur: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime + t0);
      o.start(ctx.currentTime + t0);
      o.stop(ctx.currentTime + t0 + dur);
    };
    if (bien) {
      const n = Math.min(Math.max(1, veces), 6);
      for (let i = 0; i < n; i++) tono(1200, i * 0.16, 0.09);
    } else {
      tono(300, 0, 0.15);
      tono(300, 0.2, 0.15);
    }
  } catch {
    /* sin audio, sin drama */
  }
}

/**
 * La bocina dice cuántos pares y de qué, con la voz en español del propio
 * navegador. Corta lo que estuviera diciendo: el siguiente escaneo manda.
 */
export function hablar(texto: string) {
  try {
    const s = window.speechSynthesis;
    if (!s) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = "es-MX";
    const voz = s.getVoices().find((v) => v.lang.toLowerCase().startsWith("es-mx")) ??
      s.getVoices().find((v) => v.lang.toLowerCase().startsWith("es"));
    if (voz) u.voice = voz;
    u.rate = 1.05;
    s.speak(u);
  } catch {
    /* sin voz, sin drama */
  }
}

