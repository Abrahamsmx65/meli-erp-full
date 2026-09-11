import { describe, expect, it } from "vitest";
import { resumirCuerpoHtml } from "./client";

/** La página que contestó Akamai en el corte #17 (11-sep-2026). */
const PAGINA_503 =
  "<HTML><HEAD> <TITLE>Service Unavailable</TITLE> </HEAD><BODY> " +
  "<H1>Service Unavailable - Zero size object</H1> The server is temporarily " +
  "unable to service your request. Please try again later.<P> " +
  "Reference&#32;&#35;15&#46;6c83017&#46;1789141109&#46;3ddd8dc4 <P>" +
  "https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;15&#46;6c83017</P> </BODY></HTML>";

describe("el error del borde se deja legible", () => {
  it("quita las etiquetas y deja el motivo", () => {
    const r = resumirCuerpoHtml(PAGINA_503, 503);
    expect(r).toContain("Service Unavailable - Zero size object");
    expect(r).not.toContain("<");
    expect(r.length).toBeLessThanOrEqual(180);
  });

  it("traduce las entidades numéricas (la referencia de Akamai)", () => {
    expect(resumirCuerpoHtml("Reference&#32;&#35;15", 503)).toBe("Reference #15");
  });

  it("un cuerpo vacío lo dice con su código", () => {
    expect(resumirCuerpoHtml("", 502)).toBe("El servidor contestó 502 sin cuerpo.");
    expect(resumirCuerpoHtml("   ", 502)).toBe("El servidor contestó 502 sin cuerpo.");
  });
});

describe("un 503 del borde SÍ se reintenta", () => {
  const tienda = {
    accountId: "c",
    shopId: "1",
    shopCipher: "cipher",
    warehouseId: "w",
    accessToken: "tok",
    refreshToken: "ref",
    // Lejos en el futuro: no toca renovar, la prueba no habla con TikTok.
    expiraEn: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const app = { appKey: "k", appSecret: "s" };

  function fingirFetch(respuestas: { status: number; cuerpo: string }[]) {
    let i = 0;
    const llamadas: string[] = [];
    (globalThis as any).fetch = async (url: URL) => {
      llamadas.push(String(url));
      const r = respuestas[Math.min(i++, respuestas.length - 1)];
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.cuerpo } as any;
    };
    return llamadas;
  }

  it("la página de Akamai ya no se lanza en el primer intento", async () => {
    const { Cliente } = await import("./client");
    const llamadas = fingirFetch([
      { status: 503, cuerpo: PAGINA_503 },
      { status: 200, cuerpo: JSON.stringify({ code: 0, data: { ok: true } }) },
    ]);
    // Plazo corto para que la espera del reintento no alargue la prueba.
    const c = new Cliente(app as any, tienda as any, Date.now() + 40_000);
    const r = await c.llamar("POST", "/fulfillment/202309/packages/1/ship", { cuerpo: {} });
    expect(r).toEqual({ ok: true });
    expect(llamadas).toHaveLength(2);
  }, 20_000);

  it("si el borde no se compone, el error dice el motivo sin el HTML", async () => {
    const { Cliente, ErrorTikTok } = await import("./client");
    fingirFetch([{ status: 503, cuerpo: PAGINA_503 }]);
    const c = new Cliente(app as any, tienda as any, Date.now() + 12_000);
    // Con el plazo corto, el reintento no cabe y se rinde declarando.
    const err = await c.llamar("POST", "/x/ship", { cuerpo: {} }).catch((e) => e);
    if (err instanceof ErrorTikTok) {
      expect(err.codigo).toBe(503);
      expect(err.message).toContain("Service Unavailable - Zero size object");
      expect(err.message).not.toContain("<HTML>");
    } else {
      // Sin plazo para reintentar devuelve null: quien llama lo retoma después.
      expect(err).toBeNull();
    }
  }, 20_000);
});
