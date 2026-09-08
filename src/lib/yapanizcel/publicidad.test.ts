import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeliClient } from "../meli/client";
import { resolverAdvertiser, traerAnunciosAds, type AnuncioAds } from "../servicios/publicidad";
import { guardarCacheYz, leerCacheYz } from "./cache";
import { clienteDeCuenta, type CuentaYz } from "./cuenta";
import { adsPorDisenoCacheado } from "./publicidad";

vi.mock("./cache", () => ({
  leerCacheYz: vi.fn(),
  guardarCacheYz: vi.fn(),
}));

vi.mock("./cuenta", () => ({
  clienteDeCuenta: vi.fn(),
}));

vi.mock("../supabase/server", () => ({
  clienteAdmin: vi.fn(() => ({})),
}));

vi.mock("../servicios/publicidad", () => ({
  resolverAdvertiser: vi.fn(),
  traerAnunciosAds: vi.fn(),
}));

vi.mock("./db", () => ({
  hoyMx: vi.fn(() => "2026-09-08"),
  todo: vi.fn(() => Promise.resolve([])),
}));

const { leerCacheYz: leerCacheReal } = await vi.importActual<typeof import("./cache")>("./cache");
const leerCache = vi.mocked(leerCacheYz);
const guardarCache = vi.mocked(guardarCacheYz);
const conectarCuenta = vi.mocked(clienteDeCuenta);
const resolverPublicidad = vi.mocked(resolverAdvertiser);
const traerPublicidad = vi.mocked(traerAnunciosAds);
const cuenta = { id: "cuenta", site_id: "MLM" } as CuentaYz;
const rango = { desde: "2026-08-01", hasta: "2026-08-31" };

function dbConCache(datos: unknown, generadoEn: string) {
  const consulta: any = {
    select: vi.fn(() => consulta),
    eq: vi.fn(() => consulta),
    maybeSingle: vi.fn(async () => ({
      data: { datos, vigente: true, generado_en: generadoEn },
      error: null,
    })),
  };
  return { from: vi.fn(() => consulta) };
}

function anuncioSinAmarre(itemId: string, gasto: number): AnuncioAds {
  return {
    itemId,
    gasto,
    clicks: 0,
    impresiones: 0,
    unidadesAds: 0,
    ventaAds: 0,
    estado: null,
    campanaId: null,
    titulo: null,
  };
}

describe("publicidad cacheada", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("propaga un fallo de lectura sin conectar la cuenta ni llamar a MELI", async () => {
    const fallo = new Error("statement timeout");
    leerCache.mockResolvedValue({ estado: "fallo", error: fallo });
    const db = { from: vi.fn() };

    await expect(adsPorDisenoCacheado(db as any, cuenta, "2026-08", rango)).rejects.toBe(fallo);
    expect(conectarCuenta).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("la ausencia real conserva el comportamiento de primer cálculo", async () => {
    leerCache.mockResolvedValue({ estado: "ausente" });
    conectarCuenta.mockRejectedValue(new Error("inicio de llamada externa"));
    const db = { from: vi.fn() };

    await expect(adsPorDisenoCacheado(db as any, cuenta, "2026-08", rango)).resolves.toMatchObject({
      error: "inicio de llamada externa",
    });
    expect(conectarCuenta).toHaveBeenCalledOnce();
  });

  it("comparte un solo recálculo entre solicitudes simultáneas de la misma cuenta y periodo", async () => {
    let liberarPublicidad!: (anuncios: []) => void;
    const publicidadPendiente = new Promise<[]>((resolve) => {
      liberarPublicidad = resolve;
    });
    const cliente = { get: vi.fn() };
    const advertiser = { advertiserId: "advertiser", siteId: "MLM" };
    const db = { from: vi.fn() };
    leerCache.mockResolvedValue({ estado: "ausente" });
    conectarCuenta.mockResolvedValue(cliente as any);
    resolverPublicidad.mockResolvedValue(advertiser);
    traerPublicidad.mockReturnValue(publicidadPendiente);

    const primera = adsPorDisenoCacheado(db as any, cuenta, "2026-09", rango);
    const segunda = adsPorDisenoCacheado(db as any, cuenta, "2026-09", rango);
    await vi.waitFor(() => expect(traerPublicidad).toHaveBeenCalledOnce());
    liberarPublicidad([]);

    const [resultadoPrimero, resultadoSegundo] = await Promise.all([primera, segunda]);

    expect(leerCache).toHaveBeenCalledOnce();
    expect(conectarCuenta).toHaveBeenCalledOnce();
    expect(resolverPublicidad).toHaveBeenCalledOnce();
    expect(traerPublicidad).toHaveBeenCalledOnce();
    expect(guardarCache).toHaveBeenCalledOnce();
    expect(resultadoSegundo).toBe(resultadoPrimero);
  });

  it("mantiene aislados los recálculos simultáneos de cuentas distintas para el mismo periodo", async () => {
    const cuentaA = { id: "cuenta-a", site_id: "MLM" } as CuentaYz;
    const cuentaB = { id: "cuenta-b", site_id: "MLA" } as CuentaYz;
    const clienteA = { cuenta: cuentaA.id } as unknown as MeliClient;
    const clienteB = { cuenta: cuentaB.id } as unknown as MeliClient;
    const advertiserA = { advertiserId: "advertiser-a", siteId: cuentaA.site_id };
    const advertiserB = { advertiserId: "advertiser-b", siteId: cuentaB.site_id };
    let liberarCuentaA!: (anuncios: AnuncioAds[]) => void;
    let liberarCuentaB!: (anuncios: AnuncioAds[]) => void;
    const publicidadCuentaA = new Promise<AnuncioAds[]>((resolve) => {
      liberarCuentaA = resolve;
    });
    const publicidadCuentaB = new Promise<AnuncioAds[]>((resolve) => {
      liberarCuentaB = resolve;
    });
    const db = { from: vi.fn() };
    leerCache.mockResolvedValue({ estado: "ausente" });
    conectarCuenta.mockImplementation(async (_admin, cuentaId) =>
      cuentaId === cuentaA.id ? clienteA : clienteB,
    );
    resolverPublicidad.mockImplementation(async (cliente) =>
      cliente === clienteA ? advertiserA : advertiserB,
    );
    traerPublicidad.mockImplementation((cliente) =>
      cliente === clienteA ? publicidadCuentaA : publicidadCuentaB,
    );

    let terminoA = false;
    const solicitudA = adsPorDisenoCacheado(db as any, cuentaA, "2026-09", rango).then((resultado) => {
      terminoA = true;
      return resultado;
    });
    const solicitudB = adsPorDisenoCacheado(db as any, cuentaB, "2026-09", rango);
    await vi.waitFor(() => expect(traerPublicidad).toHaveBeenCalledTimes(2));

    liberarCuentaB([anuncioSinAmarre("sin-amarre-b", 22)]);
    await expect(solicitudB).resolves.toMatchObject({ sinAmarre: 22, error: null });
    expect(terminoA).toBe(false);
    expect(guardarCache).toHaveBeenCalledWith(
      db,
      cuentaB.id,
      "ads:2026-09",
      expect.objectContaining({ sinAmarre: 22 }),
      expect.any(Number),
    );

    liberarCuentaA([anuncioSinAmarre("sin-amarre-a", 11)]);
    await expect(solicitudA).resolves.toMatchObject({ sinAmarre: 11, error: null });

    expect(leerCache).toHaveBeenCalledTimes(2);
    expect(leerCache).toHaveBeenCalledWith(db, cuentaA.id, "ads:2026-09", 3_600_000);
    expect(leerCache).toHaveBeenCalledWith(db, cuentaB.id, "ads:2026-09", 3_600_000);
    expect(conectarCuenta).toHaveBeenCalledTimes(2);
    expect(resolverPublicidad).toHaveBeenCalledWith(clienteA, cuentaA.site_id);
    expect(resolverPublicidad).toHaveBeenCalledWith(clienteB, cuentaB.site_id);
    expect(traerPublicidad).toHaveBeenCalledWith(clienteA, advertiserA, rango);
    expect(traerPublicidad).toHaveBeenCalledWith(clienteB, advertiserB, rango);
    expect(guardarCache).toHaveBeenCalledTimes(2);
    expect(guardarCache).toHaveBeenCalledWith(
      db,
      cuentaA.id,
      "ads:2026-09",
      expect.objectContaining({ sinAmarre: 11 }),
      expect.any(Number),
    );
  });

  it("descarta una operación compartida fallida y permite que la siguiente solicitud vuelva a leer la caché", async () => {
    const fallo = new Error("statement timeout");
    const recuperado = { porDiseno: new Map([["RECUPERADO", 90]]), sinAmarre: 0, error: null };
    leerCache
      .mockResolvedValueOnce({ estado: "fallo", error: fallo })
      .mockResolvedValueOnce({ estado: "encontrado", valor: recuperado });
    const db = { from: vi.fn() };

    const primera = adsPorDisenoCacheado(db as any, cuenta, "2026-08", rango);
    const compartida = adsPorDisenoCacheado(db as any, cuenta, "2026-08", rango);

    await expect(primera).rejects.toBe(fallo);
    await expect(compartida).rejects.toBe(fallo);
    expect(leerCache).toHaveBeenCalledOnce();

    await expect(adsPorDisenoCacheado(db as any, cuenta, "2026-08", rango)).resolves.toBe(recuperado);
    expect(leerCache).toHaveBeenCalledTimes(2);
    expect(conectarCuenta).not.toHaveBeenCalled();
  });

  it("vuelve a consultar y guardar la publicidad cuando la caché del mes actual superó una hora", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T18:00:00.000Z"));
    const cliente = { get: vi.fn() };
    const advertiser = { advertiserId: "advertiser", siteId: "MLM" };
    const db = dbConCache(
      { porDiseno: { __tipo: "map", v: [["VIEJO", 80]] }, sinAmarre: 0, error: null },
      "2026-09-08T16:59:59.999Z",
    );
    leerCache.mockImplementation(leerCacheReal);
    conectarCuenta.mockResolvedValue(cliente as any);
    resolverPublicidad.mockResolvedValue(advertiser);
    traerPublicidad.mockResolvedValue([]);

    const resultado = await adsPorDisenoCacheado(
      db as any,
      cuenta,
      "2026-09",
      { desde: "2026-09-01", hasta: "2026-09-30" },
    );

    expect(leerCache).toHaveBeenCalledWith(db, cuenta.id, "ads:2026-09", 3_600_000);
    expect(resolverPublicidad).toHaveBeenCalledWith(cliente, cuenta.site_id);
    expect(traerPublicidad).toHaveBeenCalledWith(
      cliente,
      advertiser,
      { desde: "2026-09-01", hasta: "2026-09-30" },
    );
    expect(guardarCache).toHaveBeenCalledWith(
      db,
      cuenta.id,
      "ads:2026-09",
      resultado,
      expect.any(Number),
    );
  });

  it("reutiliza la caché todavía fresca del mes actual sin consultar ni volver a guardar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T18:00:00.000Z"));
    const guardado = { porDiseno: new Map([["A", 125]]), sinAmarre: 20, error: null };
    const db = dbConCache(
      { porDiseno: { __tipo: "map", v: [["A", 125]] }, sinAmarre: 20, error: null },
      "2026-09-08T17:00:00.001Z",
    );
    leerCache.mockImplementation(leerCacheReal);

    await expect(
      adsPorDisenoCacheado(
        db as any,
        cuenta,
        "2026-09",
        { desde: "2026-09-01", hasta: "2026-09-30" },
      ),
    ).resolves.toEqual(guardado);

    expect(leerCache).toHaveBeenCalledWith(db, cuenta.id, "ads:2026-09", 3_600_000);
    expect(conectarCuenta).not.toHaveBeenCalled();
    expect(resolverPublicidad).not.toHaveBeenCalled();
    expect(traerPublicidad).not.toHaveBeenCalled();
    expect(guardarCache).not.toHaveBeenCalled();
  });

  it("reutiliza la caché del mes actual al cumplir exactamente una hora", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T18:00:00.000Z"));
    const guardado = { porDiseno: new Map([["A", 125]]), sinAmarre: 20, error: null };
    const db = dbConCache(
      { porDiseno: { __tipo: "map", v: [["A", 125]] }, sinAmarre: 20, error: null },
      "2026-09-08T17:00:00.000Z",
    );
    leerCache.mockImplementation(leerCacheReal);

    await expect(
      adsPorDisenoCacheado(
        db as any,
        cuenta,
        "2026-09",
        { desde: "2026-09-01", hasta: "2026-09-30" },
      ),
    ).resolves.toEqual(guardado);

    expect(leerCache).toHaveBeenCalledWith(db, cuenta.id, "ads:2026-09", 3_600_000);
    expect(conectarCuenta).not.toHaveBeenCalled();
    expect(resolverPublicidad).not.toHaveBeenCalled();
    expect(traerPublicidad).not.toHaveBeenCalled();
    expect(guardarCache).not.toHaveBeenCalled();
  });

  it("reutiliza la caché vigente de un mes cerrado sin consultar ni volver a guardar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T18:00:00.000Z"));
    const guardado = { porDiseno: new Map([["A", 125]]), sinAmarre: 20, error: null };
    const db = dbConCache(
      { porDiseno: { __tipo: "map", v: [["A", 125]] }, sinAmarre: 20, error: null },
      "2026-08-31T23:59:59.000Z",
    );
    leerCache.mockImplementation(leerCacheReal);

    await expect(adsPorDisenoCacheado(db as any, cuenta, "2026-08", rango)).resolves.toEqual(guardado);

    expect(leerCache).toHaveBeenCalledWith(db, cuenta.id, "ads:2026-08", undefined);
    expect(conectarCuenta).not.toHaveBeenCalled();
    expect(resolverPublicidad).not.toHaveBeenCalled();
    expect(traerPublicidad).not.toHaveBeenCalled();
    expect(guardarCache).not.toHaveBeenCalled();
  });
});