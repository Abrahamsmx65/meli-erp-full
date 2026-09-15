import { describe, expect, it, vi } from "vitest";
import {
  ErrorOperacionCacheApp,
  conCacheApp,
  guardarCacheApp,
  invalidarApp,
  leerCacheApp,
} from "./cache-app";

function dbConRespuesta(respuesta: unknown) {
  const cadena: any = {};
  for (const metodo of ["select", "eq"]) cadena[metodo] = vi.fn(() => cadena);
  cadena.maybeSingle = vi.fn(async () => respuesta);
  return { from: vi.fn(() => cadena) } as any;
}

describe("leerCacheApp", () => {
  it("trata una tabla legacy ausente como caché ausente", async () => {
    const db = dbConRespuesta({
      data: null,
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.app_cache' in the schema cache",
      },
    });

    await expect(leerCacheApp(db, "cuenta", "clave")).resolves.toEqual({ estado: "ausente" });
  });

  it.each([
    { code: "42501", message: "permission denied for table app_cache" },
    { code: "57014", message: "canceling statement due to statement timeout" },
    { message: "TypeError: fetch failed" },
  ])("distingue y hace observable un fallo real: $message", async (error) => {
    const db = dbConRespuesta({ data: null, error });
    const resultado = await leerCacheApp(db, "cuenta", "clave");

    expect(resultado.estado).toBe("fallo");
    if (resultado.estado === "fallo") {
      expect(resultado.error.message).toContain(error.message);
    }
  });

  it("el llamador recalcula explícitamente cuando la tabla legacy no existe", async () => {
    const db = dbConRespuesta({
      data: null,
      error: {
        code: "42P01",
        message: 'relation "app_cache" does not exist',
      },
    });
    const calcular = vi.fn(async () => ({ total: 12 }));
    // El guardado no es parte de esta prueba: una instalación legacy tampoco
    // tiene dónde persistirlo.
    (db.from as any).mockImplementationOnce(() => {
      const cadena: any = {};
      for (const metodo of ["select", "eq"]) cadena[metodo] = vi.fn(() => cadena);
      cadena.maybeSingle = vi.fn(async () => ({
        data: null,
        error: { code: "42P01", message: 'relation "app_cache" does not exist' },
      }));
      return cadena;
    }).mockImplementationOnce(() => ({
      upsert: vi.fn(async () => ({
        error: { code: "42P01", message: 'relation "app_cache" does not exist' },
      })),
    }));

    await expect(conCacheApp(db, "cuenta", "clave", 60_000, calcular)).resolves.toEqual({ total: 12 });
    expect(calcular).toHaveBeenCalledOnce();
  });

  it("el llamador no recalcula cuando la lectura falló realmente", async () => {
    const db = dbConRespuesta({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });
    const calcular = vi.fn(async () => ({ total: 12 }));

    await expect(conCacheApp(db, "cuenta", "clave", 60_000, calcular)).rejects.toThrow("statement timeout");
    expect(calcular).not.toHaveBeenCalled();
  });
});

function dbParaEscritura(respuesta: unknown) {
  const cadena: any = {};
  for (const metodo of ["update", "eq", "in", "like"]) cadena[metodo] = vi.fn(() => cadena);
  cadena.upsert = vi.fn(async () => respuesta);
  cadena.then = (resolve: (valor: unknown) => unknown) => Promise.resolve(respuesta).then(resolve);
  return { from: vi.fn(() => cadena) } as any;
}

describe("escrituras de app_cache", () => {
  it.each(["guardar", "invalidar"] as const)(
    "conserva compatibilidad al %s cuando falta la tabla legacy",
    async (operacion) => {
      const db = dbParaEscritura({
        error: { code: "42P01", message: 'relation "app_cache" does not exist' },
      });

      const promesa =
        operacion === "guardar"
          ? guardarCacheApp(db, "cuenta", "clave", { total: 1 }, 10)
          : invalidarApp(db, "cuenta", "motivo", { prefijo: "contenido:" });
      await expect(promesa).resolves.toBeUndefined();
    },
  );

  it.each([
    ["permisos", { code: "42501", message: "permission denied for table app_cache" }],
    ["timeout", { code: "57014", message: "canceling statement due to statement timeout" }],
    ["red", new TypeError("fetch failed")],
  ] as const)("clasifica fallos reales al guardar: %s", async (tipo, error) => {
    const db = dbParaEscritura(
      error instanceof Error ? Promise.reject(error) : { error },
    );

    const fallo = await guardarCacheApp(db, "cuenta", "clave", {}, 1).catch((e) => e);
    expect(fallo).toBeInstanceOf(ErrorOperacionCacheApp);
    expect(fallo).toMatchObject({ operacion: "guardar", tipo });
  });

  it.each([
    ["permisos", { code: "42501", message: "permission denied for table app_cache" }],
    ["timeout", { code: "57014", message: "statement timeout" }],
    ["red", { message: "network connection failed" }],
  ] as const)("clasifica fallos reales al invalidar: %s", async (tipo, error) => {
    const db = dbParaEscritura({ error });

    const fallo = await invalidarApp(db, "cuenta", "motivo").catch((e) => e);
    expect(fallo).toBeInstanceOf(ErrorOperacionCacheApp);
    expect(fallo).toMatchObject({ operacion: "invalidar", tipo });
  });
});
