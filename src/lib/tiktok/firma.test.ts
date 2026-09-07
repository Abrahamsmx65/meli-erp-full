import { describe, expect, it } from "vitest";
import { cadenaAFirmar, firmar, timestamp } from "./firma";

describe("cadenaAFirmar", () => {
  it("arma la cadena como la pide TikTok: secreto + ruta + params ordenados + cuerpo + secreto", () => {
    const cadena = cadenaAFirmar(
      "/product/202309/products/search",
      { app_key: "6a", timestamp: 1700000000, shop_cipher: "ROW_x" },
      '{"status":"ALL"}',
      "SECRETO",
    );
    expect(cadena).toBe(
      "SECRETO/product/202309/products/search" +
        "app_key6ashop_cipherROW_xtimestamp1700000000" +
        '{"status":"ALL"}' +
        "SECRETO",
    );
  });

  it("deja fuera sign y access_token", () => {
    const cadena = cadenaAFirmar(
      "/x",
      { app_key: "k", sign: "vieja", access_token: "tok", timestamp: 1 },
      "",
      "S",
    );
    expect(cadena).toBe("S/xapp_keyktimestamp1S");
    expect(cadena).not.toContain("tok");
    expect(cadena).not.toContain("vieja");
  });

  it("el orden de los parámetros no depende del orden en que se pasaron", () => {
    const a = cadenaAFirmar("/x", { zzz: 1, aaa: 2, mmm: 3 }, "", "S");
    const b = cadenaAFirmar("/x", { mmm: 3, aaa: 2, zzz: 1 }, "", "S");
    expect(a).toBe(b);
    expect(a).toBe("S/xaaa2mmm3zzz1S");
  });

  it("ignora los parámetros vacíos en vez de firmar 'undefined'", () => {
    expect(cadenaAFirmar("/x", { a: "1", b: undefined }, "", "S")).toBe("S/xa1S");
  });
});

describe("firmar", () => {
  it("da un HMAC-SHA256 hexadecimal estable", () => {
    const f = firmar("/x", { app_key: "k", timestamp: 1 }, "", "S");
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(f).toBe(firmar("/x", { timestamp: 1, app_key: "k" }, "", "S"));
  });

  it("cambia si cambia el cuerpo", () => {
    const a = firmar("/x", { app_key: "k" }, '{"q":1}', "S");
    const b = firmar("/x", { app_key: "k" }, '{"q":2}', "S");
    expect(a).not.toBe(b);
  });
});

describe("timestamp", () => {
  it("va en segundos, no en milisegundos", () => {
    expect(timestamp(1_700_000_000_500)).toBe(1_700_000_000);
  });
});

describe("firma de webhook", () => {
  it("es HMAC-SHA256 de app_key + cuerpo, con el app_secret", async () => {
    const { firmaDeWebhook, firmaValida } = await import("./firma");
    const f = firmaDeWebhook("KEY", '{"type":1}', "SECRET");
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(firmaValida(f, f)).toBe(true);
    expect(firmaValida(f.slice(0, -1) + "0", f)).toBe(false);
    expect(firmaValida(null, f)).toBe(false);
    // Cambiar un byte del cuerpo cambia la firma.
    expect(firmaDeWebhook("KEY", '{"type":2}', "SECRET")).not.toBe(f);
  });
});
