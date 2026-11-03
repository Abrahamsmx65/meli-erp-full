import { afterEach, describe, expect, it } from "vitest";
import {
  RUTA_CALLBACK,
  RUTA_CLIENTE,
  clientIdDelErp,
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
