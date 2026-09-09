import { describe, expect, it, vi } from "vitest";
import { sincronizarEconomia } from "./economia";

describe("sincronizarEconomia", () => {
  it("pide únicamente el primer bloque histórico que la base detectó incompleto", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const estado = {
      select: () => estado,
      eq: () => estado,
      maybeSingle: vi.fn().mockResolvedValue({
        data: { cursor_ts: "2026-09-01T00:00:00.000Z", datos: {} },
      }),
    };
    const admin = {
      from: vi.fn((tabla: string) => tabla === "amazon_sync_estado"
        ? { ...estado, upsert }
        : { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }),
      rpc: vi.fn().mockResolvedValue({
        data: [{ desde: "2026-07-01", hasta: "2026-08-31" }],
        error: null,
      }),
    };
    const llamar = vi.fn().mockResolvedValue({ queryId: "consulta-1" });
    const cliente = {
      cuenta: {
        accountId: "cuenta-1",
        marketplaceId: "A1AM78C64UM0Y8",
      },
      llamar,
    };

    const resultado = await sincronizarEconomia(admin, cliente as never);

    expect(resultado).toMatchObject({
      estado: "solicitado",
      desde: "2026-07-01",
      hasta: "2026-07-31",
    });
    expect(llamar).toHaveBeenCalledWith(
      "POST",
      "/dataKiosk/2023-11-15/queries",
      "createQuery",
      expect.objectContaining({
        cuerpo: {
          query: expect.stringContaining('startDate: "2026-07-01"'),
        },
      }),
    );
    expect(llamar.mock.calls[0][3].cuerpo.query).toContain('endDate: "2026-07-31"');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      account_id: "cuenta-1",
      datos: expect.objectContaining({ desde: "2026-07-01", hasta: "2026-07-31" }),
    }));
  });

  it("no omite un hueco histórico de un solo día", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const estado = {
      select: () => estado,
      eq: () => estado,
      maybeSingle: vi.fn().mockResolvedValue({
        data: { cursor_ts: "2026-09-01T00:00:00.000Z", datos: {} },
      }),
    };
    const admin = {
      from: vi.fn((tabla: string) => tabla === "amazon_sync_estado"
        ? { ...estado, upsert }
        : { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }),
      rpc: vi.fn().mockResolvedValue({
        data: [{ desde: "2026-07-09", hasta: "2026-07-09" }],
        error: null,
      }),
    };
    const llamar = vi.fn().mockResolvedValue({ queryId: "consulta-2" });
    const cliente = {
      cuenta: {
        accountId: "cuenta-1",
        marketplaceId: "A1AM78C64UM0Y8",
      },
      llamar,
    };

    const resultado = await sincronizarEconomia(admin, cliente as never);

    expect(resultado).toMatchObject({
      estado: "solicitado",
      desde: "2026-07-09",
      hasta: "2026-07-09",
    });
    expect(llamar.mock.calls[0][3].cuerpo.query).toContain('startDate: "2026-07-09"');
    expect(llamar.mock.calls[0][3].cuerpo.query).toContain('endDate: "2026-07-09"');
  });

  it("continúa después de un intervalo ya descargado aunque siga sin cuadrar", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const estado = {
      select: () => estado,
      eq: () => estado,
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          cursor_ts: "2026-09-01T00:00:00.000Z",
          datos: { revisadoHasta: "2026-07-31" },
        },
      }),
    };
    const admin = {
      from: vi.fn((tabla: string) => tabla === "amazon_sync_estado"
        ? { ...estado, upsert }
        : { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }),
      rpc: vi.fn().mockResolvedValue({
        data: [{ desde: "2026-08-01", hasta: "2026-08-31" }],
        error: null,
      }),
    };
    const llamar = vi.fn().mockResolvedValue({ queryId: "consulta-3" });
    const cliente = {
      cuenta: { accountId: "cuenta-1", marketplaceId: "A1AM78C64UM0Y8" },
      llamar,
    };

    const resultado = await sincronizarEconomia(admin, cliente as never);

    expect(admin.rpc).toHaveBeenCalledWith("amazon_economia_hueco", {
      p_account: "cuenta-1",
      p_desde: "2026-08-01",
      p_hasta: expect.any(String),
    });
    expect(resultado).toMatchObject({
      estado: "solicitado",
      desde: "2026-08-01",
      hasta: "2026-08-31",
    });
  });

  it("rechaza un documento malformado sin reemplazar ni avanzar el estado", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const estado = {
      select: () => estado,
      eq: () => estado,
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          cursor_ts: "2026-09-01T00:00:00.000Z",
          datos: {
            queryId: "consulta-pendiente",
            desde: "2026-07-01",
            hasta: "2026-07-31",
            pedidoEn: "2026-09-01T01:00:00.000Z",
          },
        },
      }),
    };
    const admin = {
      from: vi.fn(() => ({ ...estado, upsert })),
      rpc: vi.fn(),
    };
    const llamar = vi.fn(async (_metodo: string, ruta: string) =>
      ruta.includes("/documents/")
        ? { documentUrl: "https://documento.test/economia" }
        : { processingStatus: "DONE", dataDocumentId: "documento-1" },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("{json roto").buffer,
    }));
    const cliente = {
      cuenta: { accountId: "cuenta-1", marketplaceId: "A1AM78C64UM0Y8" },
      llamar,
    };

    try {
      const resultado = await sincronizarEconomia(admin, cliente as never);
      expect(resultado).toMatchObject({ estado: "error" });
      expect(admin.rpc).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
        datos: expect.objectContaining({
          queryId: "consulta-pendiente",
          fallosDocumento: 1,
        }),
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retira una consulta DONE inutilizable después de tres intentos sin avanzar cobertura", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const estado = {
      select: () => estado,
      eq: () => estado,
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          cursor_ts: "2026-09-01T00:00:00.000Z",
          datos: {
            queryId: "consulta-pendiente",
            desde: "2026-07-01",
            hasta: "2026-07-31",
            pedidoEn: "2026-09-01T01:00:00.000Z",
            fallosDocumento: 2,
          },
        },
      }),
    };
    const admin = {
      from: vi.fn(() => ({ ...estado, upsert })),
      rpc: vi.fn(),
    };
    const cliente = {
      cuenta: { accountId: "cuenta-1", marketplaceId: "A1AM78C64UM0Y8" },
      llamar: vi.fn().mockResolvedValue({ processingStatus: "DONE" }),
    };

    const resultado = await sincronizarEconomia(admin, cliente as never);

    expect(resultado).toMatchObject({ estado: "reintentar" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ datos: {} }));
  });

  it("rechaza una fila sin neto financiero válido antes de reemplazar datos", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const estado = {
      select: () => estado,
      eq: () => estado,
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          datos: {
            queryId: "consulta-pendiente",
            desde: "2026-07-01",
            hasta: "2026-07-31",
            pedidoEn: "2026-09-01T01:00:00.000Z",
          },
        },
      }),
    };
    const admin = {
      from: vi.fn(() => ({ ...estado, upsert })),
      rpc: vi.fn(),
    };
    const llamar = vi.fn(async (_metodo: string, ruta: string) =>
      ruta.includes("/documents/")
        ? { documentUrl: "https://documento.test/economia" }
        : { processingStatus: "DONE", dataDocumentId: "documento-1" },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
        msku: "A",
        startDate: "2026-07-09",
        sales: { netUnitsSold: 1, orderedProductSales: { amount: 100 } },
        netProceeds: {},
      })).buffer,
    }));
    const cliente = {
      cuenta: { accountId: "cuenta-1", marketplaceId: "A1AM78C64UM0Y8" },
      llamar,
    };

    try {
      const resultado = await sincronizarEconomia(admin, cliente as never);
      expect(resultado).toMatchObject({ estado: "error" });
      expect(admin.rpc).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("una recarga prioritaria no salta huecos anteriores del descubrimiento secuencial", async () => {
    const upsertEstado = vi.fn().mockResolvedValue({ error: null });
    const estado = {
      select: () => estado,
      eq: () => estado,
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          datos: {
            queryId: "consulta-recarga",
            desde: "2026-08-01",
            hasta: "2026-08-31",
            pedidoEn: "2026-09-01T01:00:00.000Z",
            revisadoHasta: "2026-06-30",
            recargaDesde: "2026-08-01",
            recargaHasta: "2026-08-31",
          },
        },
      }),
    };
    const actualizarRecarga = {
      eq: vi.fn(() => actualizarRecarga),
    };
    const admin = {
      from: vi.fn((tabla: string) => tabla === "amazon_sync_estado"
        ? { ...estado, upsert: upsertEstado }
        : { update: vi.fn(() => actualizarRecarga) }),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    };
    const llamar = vi.fn(async (_metodo: string, ruta: string) =>
      ruta.includes("/documents/")
        ? { documentUrl: "https://documento.test/economia" }
        : { processingStatus: "DONE", dataDocumentId: "documento-1" },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
        msku: "A",
        startDate: "2026-08-09",
        sales: { netUnitsSold: 1, orderedProductSales: { amount: 100 } },
        fees: [],
        ads: [],
        netProceeds: { total: { amount: 100 } },
      })).buffer,
    }));
    const cliente = {
      cuenta: { accountId: "cuenta-1", marketplaceId: "A1AM78C64UM0Y8" },
      llamar,
    };

    try {
      const resultado = await sincronizarEconomia(admin, cliente as never);
      expect(resultado).toMatchObject({ estado: "cargado" });
      expect(upsertEstado).toHaveBeenLastCalledWith(expect.objectContaining({
        datos: { revisadoHasta: "2026-06-30" },
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cuenta un fallo de descarga DONE y retira la consulta al tercer intento", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const estado = {
      select: () => estado,
      eq: () => estado,
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          datos: {
            queryId: "consulta-pendiente",
            desde: "2026-07-01",
            hasta: "2026-07-31",
            pedidoEn: "2026-09-01T01:00:00.000Z",
            fallosDocumento: 2,
          },
        },
      }),
    };
    const admin = {
      from: vi.fn(() => ({ ...estado, upsert })),
      rpc: vi.fn(),
    };
    const llamar = vi.fn(async (_metodo: string, ruta: string) =>
      ruta.includes("/documents/")
        ? {}
        : { processingStatus: "DONE", dataDocumentId: "documento-1" },
    );
    const cliente = {
      cuenta: { accountId: "cuenta-1", marketplaceId: "A1AM78C64UM0Y8" },
      llamar,
    };

    const resultado = await sincronizarEconomia(admin, cliente as never);

    expect(resultado).toMatchObject({ estado: "reintentar" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ datos: {} }));
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("una consulta heredada en vuelo no oculta un hueco histórico anterior", async () => {
    let filaEstado: any = {
      cursor_ts: "2026-08-01T00:00:00.000Z",
      datos: {
        queryId: "consulta-legacy",
        desde: "2026-08-15",
        hasta: "2026-08-31",
        pedidoEn: "2026-08-31T01:00:00.000Z",
      },
    };
    const upsertEstado = vi.fn(async (fila: any) => {
      filaEstado = { cursor_ts: fila.cursor_ts ?? filaEstado.cursor_ts, datos: fila.datos };
      return { error: null };
    });
    const estado = {
      select: () => estado,
      eq: () => estado,
      maybeSingle: vi.fn(async () => ({ data: filaEstado })),
    };
    const colaVacia = {
      select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
    };
    const admin = {
      from: vi.fn((tabla: string) => tabla === "amazon_sync_estado"
        ? { ...estado, upsert: upsertEstado }
        : colaVacia),
      rpc: vi.fn(async (nombre: string) => nombre === "reemplazar_amazon_economia"
        ? { error: null }
        : { data: [{ desde: "2026-07-01", hasta: "2026-07-09" }], error: null }),
    };
    const llamar = vi.fn(async (metodo: string, ruta: string) => {
      if (ruta.includes("/documents/")) return { documentUrl: "https://documento.test/economia" };
      if (metodo === "GET") return { processingStatus: "DONE", dataDocumentId: "documento-legacy" };
      return { queryId: "consulta-julio" };
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
        msku: "A",
        startDate: "2026-08-20",
        sales: { netUnitsSold: 1, orderedProductSales: { amount: 100 } },
        fees: [],
        ads: [],
        netProceeds: { total: { amount: 100 } },
      })).buffer,
    }));
    const cliente = {
      cuenta: { accountId: "cuenta-1", marketplaceId: "A1AM78C64UM0Y8" },
      llamar,
    };

    try {
      expect(await sincronizarEconomia(admin, cliente as never)).toMatchObject({ estado: "cargado" });
      expect(filaEstado.datos).toEqual({});

      const siguiente = await sincronizarEconomia(admin, cliente as never);
      expect(siguiente).toMatchObject({
        estado: "solicitado",
        desde: "2026-07-01",
        hasta: "2026-07-09",
      });
      expect(admin.rpc).toHaveBeenCalledWith("amazon_economia_hueco", {
        p_account: "cuenta-1",
        p_desde: null,
        p_hasta: expect.any(String),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});