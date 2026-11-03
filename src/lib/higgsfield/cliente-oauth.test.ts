import { afterEach, describe, expect, it } from "vitest";
import {
  RUTA_CALLBACK,
  RUTA_CLIENTE,
  clientIdDelErp,
  codigoPegado,
  documentoCliente,
  dominiosDelErp,
} from "./cliente-oauth";

const ENV_ORIGINAL = process.env.VERCEL_PROJECT_PRODUCTION_URL;

afterEach(() => {
  if (ENV_ORIGINAL === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  else process.env.VERCEL_PROJECT_PRODUCTION_URL = ENV_ORIGINAL;
});

describe("cliente-oauth (Client ID Metadata Document)", () => {
  it("el dominio de producción de Vercel manda y es el canónico", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "meli-erp-full-getac.vercel.app";
    expect(dominiosDelErp()[0]).toBe("meli-erp-full-getac.vercel.app");
    expect(clientIdDelErp()).toBe(
      `https://meli-erp-full-getac.vercel.app${RUTA_CLIENTE}`,
    );
  });

  it("sin la variable (local), cae al dominio conocido", () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(dominiosDelErp()[0]).toBe("meli-erp-full.vercel.app");
  });

  it("el client_id del documento ES su propia URL (lo exige la especificación)", () => {
    const doc = documentoCliente();
    expect(doc.client_id).toBe(clientIdDelErp());
    expect(doc.token_endpoint_auth_method).toBe("none");
    expect(doc.grant_types).toEqual(["authorization_code", "refresh_token"]);
  });

  it("los redirect_uris cubren todos los dominios del ERP y el loopback local", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "meli-erp-full-getac.vercel.app";
    const uris = documentoCliente().redirect_uris as string[];
    for (const d of dominiosDelErp()) {
      expect(uris).toContain(`https://${d}${RUTA_CALLBACK}`);
    }
    expect(uris).toContain(`http://localhost:3000${RUTA_CALLBACK}`);
    // Sin repetidos: un alias duplicado en la lista es ruido para Higgsfield.
    expect(new Set(uris).size).toBe(uris.length);
  });
});

describe("codigoPegado", () => {
  it("lee la dirección completa de la página que no cargó", () => {
    expect(
      codigoPegado(
        "  http://localhost:3000/api/higgsfield/callback?code=abc123&state=xyz  ",
      ),
    ).toEqual({ code: "abc123", state: "xyz" });
  });

  it("acepta solo los parámetros, con o sin signo de interrogación", () => {
    expect(codigoPegado("?code=a&state=b")).toEqual({ code: "a", state: "b" });
    expect(codigoPegado("code=a&state=b")).toEqual({ code: "a", state: "b" });
  });

  it("sin code o sin state no hay canje", () => {
    expect(codigoPegado("http://localhost:3000/x?code=a")).toBeNull();
    expect(codigoPegado("hola")).toBeNull();
    expect(codigoPegado("")).toBeNull();
  });
});
