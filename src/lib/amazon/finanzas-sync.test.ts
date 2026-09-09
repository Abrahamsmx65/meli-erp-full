import { describe, expect, it, vi } from "vitest";
import { elegirGrupo, periodosDeGrupo, sincronizarFinanzas } from "./finanzas-sync";

const ahora = Date.parse("2026-09-09T18:00:00Z");
const grupo = (x: Partial<Parameters<typeof elegirGrupo>[0][number]>) => ({
  grupo_id: "g",
  inicio: "2026-08-01T00:00:00Z",
  fin: "2026-08-15T00:00:00Z",
  estado: "Closed",
  transferencia: "Succeeded",
  total_original: 100,
  moneda: "MXN",
  paginas: 0,
  eventos: 0,
  sin_clasificar: 0,
  suma_eventos: null,
  completo: false,
  cuadra: null,
  token_siguiente: null,
  leido_en: null,
  ...x,
});

describe("elegirGrupo", () => {
  it("primero el grupo a medias, luego el cerrado más reciente sin leer, y el abierto solo cuando le toca", () => {
    const aMedias = grupo({ grupo_id: "m", token_siguiente: "tok", inicio: "2026-06-01T00:00:00Z" });
    const viejo = grupo({ grupo_id: "v", inicio: "2026-07-01T00:00:00Z" });
    const reciente = grupo({ grupo_id: "r", inicio: "2026-08-20T00:00:00Z" });
    const abierto = grupo({ grupo_id: "a", estado: "Open", fin: null, total_original: null, inicio: "2026-09-07T00:00:00Z" });
    expect(elegirGrupo([viejo, reciente, abierto, aMedias], ahora)?.grupo_id).toBe("m");
    expect(elegirGrupo([viejo, reciente, abierto], ahora)?.grupo_id).toBe("r");
    expect(elegirGrupo([abierto], ahora)?.grupo_id).toBe("a");
    expect(elegirGrupo([{ ...abierto, leido_en: new Date(ahora - 10 * 60_000).toISOString() }], ahora)).toBeNull();
    expect(elegirGrupo([{ ...abierto, leido_en: new Date(ahora - 2 * 3_600_000).toISOString() }], ahora)?.grupo_id).toBe("a");
  });

  it("ignora los grupos en otra moneda (USD/CAD de otros sitios)", () => {
    expect(elegirGrupo([grupo({ moneda: "USD" }), grupo({ grupo_id: "ok", moneda: "MXN", completo: true })], ahora)).toBeNull();
  });
});

/** Un Supabase de mentira: tablas en memoria con lo justo para la ingesta. */
function adminFalso(gruposIniciales: ReturnType<typeof grupo>[]) {
  // Lista de grupos recién refrescada: la ingesta no vuelve a pedirla a Amazon.
  const grupos = new Map(gruposIniciales.map((g) => [g.grupo_id, { ...g, account_id: "cta", actualizado_en: new Date().toISOString() }]));
  const eventos = new Map<string, any>();
  const consulta = (tabla: string) => {
    const filtros: Record<string, unknown> = {};
    const q: any = {
      select: () => q,
      eq: (k: string, v: unknown) => ((filtros[k] = v), q),
      order: () => q,
      then: (res: (x: unknown) => void) => {
        if (tabla === "amazon_finanzas_grupos") res({ data: [...grupos.values()], error: null });
        else res({ data: [], error: null });
      },
      upsert: (filas: any[]) => {
        for (const f of filas) {
          if (tabla === "amazon_finanzas_grupos") grupos.set(f.grupo_id, { ...(grupos.get(f.grupo_id) ?? {}), ...f });
          else eventos.set(f.clave, f);
        }
        return Promise.resolve({ error: null });
      },
      update: (cambios: any) => ({
        eq: (_k: string, _v: unknown) => ({
          eq: (_k2: string, id: string) => {
            const g = grupos.get(id);
            if (g) Object.assign(g, cambios);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    return q;
  };
  return {
    from: (tabla: string) => consulta(tabla),
    rpc: (_nombre: string, args: { p_grupo: string }) => {
      const del = [...eventos.values()].filter((e) => e.grupo_id === args.p_grupo);
      return Promise.resolve({ data: [{ suma: del.reduce((s, e) => s + (e.monto ?? 0), 0), eventos: del.length, sin_clasificar: del.filter((e) => !e.clasificado).length }], error: null });
    },
    grupos,
    eventos,
  };
}

const m = (CurrencyAmount: number) => ({ CurrencyCode: "MXN", CurrencyAmount });
const envio = (orden: string, principal: number, comision: number) => ({
  AmazonOrderId: orden,
  PostedDate: "2026-08-10T10:00:00Z",
  ShipmentItemList: [{ SellerSKU: "GT128-24-BLK-MX", QuantityShipped: 1, ItemChargeList: [{ ChargeType: "Principal", ChargeAmount: m(principal) }], ItemFeeList: [{ FeeType: "Commission", FeeAmount: m(comision) }] }],
});

describe("sincronizarFinanzas", () => {
  it("lee un grupo cerrado por páginas, guarda cada evento con su clave y lo cierra cuadrado contra el total", async () => {
    // 90 + 90 − 58 + 168 = 290: el total del grupo.
    const admin = adminFalso([grupo({ grupo_id: "g1", total_original: 290 })]);
    const paginas = [
      { payload: { FinancialEvents: { ShipmentEventList: [envio("A", 100, -10), envio("B", 100, -10)], ProductAdsPaymentEventList: [{ postedDate: "2026-08-11T00:00:00Z", transactionType: "CHARGE", invoiceId: "F1", baseValue: m(-50), taxValue: m(-8), transactionValue: m(-58) }] }, NextToken: "p2" } },
      { payload: { FinancialEvents: { ShipmentEventList: [envio("C", 200, -32)] } } },
    ];
    const llamadas: string[] = [];
    const cliente: any = {
      cuenta: { accountId: "cta" },
      msRestantes: () => 100_000,
      llamar: vi.fn(async (_m: string, ruta: string, _op: string, opts: any) => {
        llamadas.push(`${ruta}?${opts.params.NextToken ?? "inicio"}`);
        return paginas.shift() ?? null;
      }),
    };
    const r = await sincronizarFinanzas(admin, cliente);
    expect(llamadas).toEqual(["/finances/v0/financialEventGroups/g1/financialEvents?inicio", "/finances/v0/financialEventGroups/g1/financialEvents?p2"]);
    expect(r).toMatchObject({ estado: "al_dia", paginas: 2, eventos: 4, gruposLeidos: ["g1"], pendientes: 0, descuadrados: [] });
    expect(admin.eventos.size).toBe(4);
    const g1 = admin.grupos.get("g1")!;
    expect(g1).toMatchObject({ completo: true, cuadra: true, suma_eventos: 290, eventos: 4, token_siguiente: null });
    const ads = [...admin.eventos.values()].find((e) => e.lista === "ProductAdsPaymentEventList");
    expect(ads).toMatchObject({ monto: -58, base: -50, impuesto: -8, descripcion: "CHARGE F1", renglones: null });
    const venta = [...admin.eventos.values()].find((e) => e.amazon_order_id === "C");
    expect(venta).toMatchObject({ principal: 200, comision: -32, monto: 168, unidades: 1 });
    expect(venta.renglones[0]).toMatchObject({ sku: "GT128-24-BLK-MX", neto: 168 });
  });

  it("si se acaba el plazo a media lectura, guarda el token y deja el grupo pendiente", async () => {
    const admin = adminFalso([grupo({ grupo_id: "g1", total_original: 300 })]);
    let restante = 100_000;
    const cliente: any = {
      cuenta: { accountId: "cta" },
      msRestantes: () => restante,
      llamar: vi.fn(async () => {
        restante = 10_000; // después de la primera página ya no hay plazo
        return { payload: { FinancialEvents: { ShipmentEventList: [envio("A", 100, -10)] }, NextToken: "p2" } };
      }),
    };
    const r = await sincronizarFinanzas(admin, cliente);
    expect(r).toMatchObject({ estado: "sin_plazo", paginas: 1, eventos: 1, pendientes: 1 });
    expect(admin.grupos.get("g1")).toMatchObject({ completo: false, token_siguiente: "p2", paginas: 1 });
  });

  it("un grupo cerrado cuya suma no da el total queda marcado como descuadrado", async () => {
    const admin = adminFalso([grupo({ grupo_id: "g1", total_original: 999 })]);
    const cliente: any = {
      cuenta: { accountId: "cta" },
      msRestantes: () => 100_000,
      llamar: vi.fn(async () => ({ payload: { FinancialEvents: { ShipmentEventList: [envio("A", 100, -10)] } } })),
    };
    const r = await sincronizarFinanzas(admin, cliente);
    expect(r.descuadrados).toEqual(["g1"]);
    expect(r.aviso).toMatch(/no da el total/);
    expect(admin.grupos.get("g1")).toMatchObject({ completo: true, cuadra: false, suma_eventos: 90 });
  });
});

describe("periodosDeGrupo", () => {
  it("cubre del mes de inicio al de fin, y hasta hoy si el grupo sigue abierto", () => {
    expect(periodosDeGrupo("2026-06-28T02:32:00Z", "2026-07-10T13:20:59Z")).toEqual(["2026-06", "2026-07"]);
    expect(periodosDeGrupo("2026-09-07T18:19:41Z", null, new Date("2026-09-09T18:00:00Z"))).toEqual(["2026-09"]);
    expect(periodosDeGrupo(null, null)).toEqual([]);
  });
});
