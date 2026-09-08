import { describe, expect, it, vi } from "vitest";
import { conCacheApp, leerCacheApp } from "./cache-app";

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