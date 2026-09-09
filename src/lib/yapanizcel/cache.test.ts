import { describe, expect, it, vi } from "vitest";
import { conCacheYz, leerCacheYz, leerCacheYzGuardado } from "./cache";

function dbConRespuesta(respuesta: unknown) {
  const cadena: any = {};
  for (const metodo of ["select", "eq"]) cadena[metodo] = vi.fn(() => cadena);
  cadena.maybeSingle = vi.fn(async () => respuesta);
  return { from: vi.fn(() => cadena) } as any;
}

describe("lecturas de yz_cache", () => {
  it.each([
    {
      code: "PGRST205",
      message: "Could not find the table 'public.yz_cache' in the schema cache",
    },
    { code: "42P01", message: 'relation "yz_cache" does not exist' },
  ])("trata una tabla legacy ausente como caché ausente: $code", async (error) => {
    const db = dbConRespuesta({ data: null, error });

    await expect(leerCacheYzGuardado(db, "cuenta", "clave")).resolves.toEqual({ estado: "ausente" });
  });

  it.each([
    { code: "42501", message: "permission denied for table yz_cache" },
    { code: "57014", message: "canceling statement due to statement timeout" },
    { message: "TypeError: fetch failed" },
  ])("distingue y hace observable un fallo real: $message", async (error) => {
    const db = dbConRespuesta({ data: null, error });
    const resultado = await leerCacheYz(db, "cuenta", "clave");

    expect(resultado.estado).toBe("fallo");
    if (resultado.estado === "fallo") expect(resultado.error.message).toContain(error.message);
  });

  it("recalcula explícitamente cuando la tabla legacy no existe", async () => {
    const db = dbConRespuesta({
      data: null,
      error: { code: "42P01", message: 'relation "yz_cache" does not exist' },
    });
    const calcular = vi.fn(async () => ({ total: 12 }));
    (db.from as any)
      .mockImplementationOnce(() => {
        const cadena: any = {};
        for (const metodo of ["select", "eq"]) cadena[metodo] = vi.fn(() => cadena);
        cadena.maybeSingle = vi.fn(async () => ({
          data: null,
          error: { code: "42P01", message: 'relation "yz_cache" does not exist' },
        }));
        return cadena;
      })
      .mockImplementationOnce(() => ({
        upsert: vi.fn(async () => ({
          error: { code: "42P01", message: 'relation "yz_cache" does not exist' },
        })),
      }));

    await expect(conCacheYz(db, "cuenta", "clave", calcular)).resolves.toEqual({ total: 12 });
    expect(calcular).toHaveBeenCalledOnce();
  });

  it.each([
    { code: "42501", message: "permission denied for table yz_cache" },
    { code: "57014", message: "statement timeout" },
  ])("no recalcula cuando la lectura falló: $message", async (error) => {
    const db = dbConRespuesta({ data: null, error });
    const calcular = vi.fn(async () => ({ total: 12 }));

    await expect(conCacheYz(db, "cuenta", "clave", calcular)).rejects.toThrow(error.message);
    expect(calcular).not.toHaveBeenCalled();
  });
});