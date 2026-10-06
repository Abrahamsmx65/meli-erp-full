import { describe, expect, it, vi } from "vitest";
import { MeliError } from "../meli/client";
import {
  cargosGuardados,
  cierreDelPeriodoMs,
  clasificarCargo,
  continuarCargosCon,
  extraerCargos,
  leidoAntesDeCerrar,
  necesitaRelecturaPorTotal,
  sincronizarCargosCon,
  type AlmacenCargos,
  type ProgresoCargos,
} from "./cargos-meli";

describe("clasificarCargo", () => {
  it("separa lo de Full de lo que ya va en el neto", () => {
    expect(clasificarCargo("Almacenamiento Full")).toBe("full");
    expect(clasificarCargo("Cargo por almacenamiento prolongado")).toBe("full");
    expect(clasificarCargo("Retiro de stock")).toBe("full");
    expect(clasificarCargo("Comisión por venta")).toBe("venta");
    expect(clasificarCargo("Costo de envío")).toBe("venta");
    expect(clasificarCargo("Product Ads")).toBe("publicidad");
    expect(clasificarCargo("Pago recibido")).toBe("pago");
    expect(clasificarCargo("Bonificación")).toBe("bonificacion");
    expect(clasificarCargo("Servicio raro")).toBe("otro");
  });

  it("reconoce los códigos de la factura de MELI México", () => {
    expect(clasificarCargo("CHARGE CFWA Cargo por servicio de almacenamiento Full")).toBe("full");
    expect(clasificarCargo("CHARGE CFCB Cargo por servicio de colecta Full")).toBe("full");
    expect(clasificarCargo("CHARGE CFPB Cargo por incumplimiento en Envíos Full")).toBe("full");
    expect(clasificarCargo("CHARGE CFF Cargo por envíos de Mercado Libre")).toBe("venta");
    expect(clasificarCargo("CHARGE CV Cargo por venta")).toBe("venta");
    expect(clasificarCargo("CHARGE PADS Cargo por campaña de publicidad de Product Ads")).toBe("publicidad");
    expect(clasificarCargo("BONUS BFF Anulación del cargo por envíos de Mercado Libre")).toBe("bonificacion");
    expect(clasificarCargo("CHARGE CDSD Cargo por devolución")).toBe("otro");
    expect(clasificarCargo("CHARGE CESM Cargo por mantenimiento de Mi página")).toBe("otro");
  });
});

describe("cargosGuardados", () => {
  it("propaga una falla de Supabase en vez de devolver cargos cero", async () => {
    const db = {
      from: () => ({
        select: (_columnas: string, opciones?: { head?: boolean }) => {
          const q: any = {
            eq: () => q,
            order: () => q,
            range: () => q,
            then: (resolver: (valor: unknown) => unknown) =>
              Promise.resolve({
                data: null,
                error: { message: opciones?.head ? "permission denied" : "permission denied" },
                count: null,
              }).then(resolver),
          };
          return q;
        },
      }),
    } as any;

    await expect(cargosGuardados(db, "meli-1", "2026-08")).rejects.toThrow(
      "meli_cargos: permission denied",
    );
  });
});

describe("extraerCargos", () => {
  it("lee el formato charge_info del API de facturación", () => {
    const crudo = {
      results: [
        {
          charge_info: {
            detail_id: 991,
            detail_type: "Almacenamiento Full",
            detail_sub_type: "Mensual",
            transaction_detail: "Almacenamiento agosto",
            detail_amount: "123.45",
            creation_date_time: "2026-08-31T10:00:00.000-06:00",
          },
        },
        { charge_info: { detail_id: 992, detail_type: "Comisión por venta", detail_amount: 30 } },
        { charge_info: { detail_type: "Sin monto" } },
      ],
    };
    const cargos = extraerCargos(crudo, "2026-08");
    expect(cargos).toHaveLength(2);
    expect(cargos[0]).toMatchObject({
      detalleId: "991",
      periodo: "2026-08",
      fecha: "2026-08-31",
      tipo: "Almacenamiento Full",
      subtipo: "Mensual",
      descripcion: "Almacenamiento agosto",
      monto: 123.45,
      clase: "full",
    });
    expect(cargos[1]).toMatchObject({ detalleId: "992", clase: "venta", monto: 30, fecha: null });
  });

  it("acepta renglones planos y les inventa un id estable si no traen", () => {
    const cargos = extraerCargos([{ type: "Servicio", amount: 10, date_created: "2026-08-02" }], "2026-08");
    expect(cargos[0]).toMatchObject({ tipo: "Servicio", monto: 10, fecha: "2026-08-02", clase: "otro" });
    expect(cargos[0].detalleId).toBe("2026-08:0:Servicio:10");
  });
});

describe("cargosGuardados", () => {
  it("propaga un error de lectura en vez de reportar cero cargos", async () => {
    const q: any = {
      eq: () => q,
      order: () => q,
      range: () => Promise.resolve({ data: null, error: { message: "lectura caída" } }),
    };
    const db = {
      from: () => ({
        select: () => q,
      }),
    } as any;

    await expect(cargosGuardados(db, "cuenta", "2026-08")).rejects.toThrow(
      "meli_cargos: lectura caída",
    );
  });
});

describe("claveDePeriodo", () => {
  it("toma la clave del periodo que empieza en el mes pedido", async () => {
    const { claveDePeriodo } = await import("./cargos-meli");
    const crudo = {
      results: [
        { period: { key: "2026-08-01T00:00:00.000-04:00", date_from: "2026-08-01T00:00:00.000-04:00", date_to: "2026-08-31T23:59:59.000-04:00" } },
        { period: { key: "2026-09-01T00:00:00.000-04:00", date_from: "2026-09-01T00:00:00.000-04:00" } },
      ],
    };
    expect(claveDePeriodo(crudo, "2026-09")).toEqual({
      clave: "2026-09-01T00:00:00.000-04:00",
      claves: ["2026-08-01T00:00:00.000-04:00", "2026-09-01T00:00:00.000-04:00"],
    });
    expect(claveDePeriodo(crudo, "2026-07").clave).toBeNull();
  });

  it("acepta claves numéricas amarrando por date_from, y listas planas", async () => {
    const { claveDePeriodo } = await import("./cargos-meli");
    expect(claveDePeriodo({ results: [{ key: 4471, date_from: "2026-09-01" }] }, "2026-09")).toEqual({ clave: "4471", claves: ["4471"] });
    expect(claveDePeriodo([{ period: { key: "SEP-2026-09" } }], "2026-09").clave).toBe("SEP-2026-09");
    expect(claveDePeriodo(null, "2026-09")).toEqual({ clave: null, claves: [] });
  });
});

describe("extraerResumen", () => {
  it("saca montos con nombre y nunca los cuenta como gasto si no se reconocen", async () => {
    const { extraerResumen } = await import("./cargos-meli");
    const filas = extraerResumen(
      {
        summary: { charges_amount: 1000.5, bonus_amount: -20 },
        charges: [
          { type: "Almacenamiento Full", amount: 300 },
          { type: "Comisión por venta", amount: 600 },
        ],
      },
      "2026-08",
    );
    const porTipo = new Map(filas.map((f) => [f.tipo, f]));
    expect(porTipo.get("Almacenamiento Full")).toMatchObject({ clase: "full", monto: 300, subtipo: "resumen" });
    expect(porTipo.get("Comisión por venta")).toMatchObject({ clase: "venta", monto: 600 });
    expect(porTipo.get("summary.charges_amount")).toMatchObject({ clase: "resumen", monto: 1000.5 });
    expect(filas.every((f) => f.clase !== "otro")).toBe(true);
    expect(new Set(filas.map((f) => f.detalleId)).size).toBe(filas.length);
  });
});

describe("partición de la lectura", () => {
  it("arma los días del periodo y los parámetros de cada filtro", async () => {
    const { diasDelPeriodo, paramsDeParticion, cursoresDe, SUBTIPOS_INTERES } = await import("./cargos-meli");
    expect(diasDelPeriodo("2026-02")).toHaveLength(28);
    expect(diasDelPeriodo("2026-08")[30]).toBe("2026-08-31");
    expect(paramsDeParticion({ modo: "dia", param: "date_from" }, "2026-08-03")).toEqual({ date_from: "2026-08-03", date_to: "2026-08-03" });
    expect(paramsDeParticion({ modo: "dia", param: "creation_date_from" }, "2026-08-03")).toEqual({
      creation_date_from: "2026-08-03T00:00:00.000-06:00",
      creation_date_to: "2026-08-03T23:59:59.999-06:00",
    });
    expect(paramsDeParticion({ modo: "subtipo", param: "detail_sub_type" }, "CFWA")).toEqual({ detail_sub_type: "CFWA" });
    expect(paramsDeParticion({ modo: "ninguna" }, "")).toEqual({});
    expect(cursoresDe({ modo: "subtipo", param: "x" }, "2026-08")).toEqual(SUBTIPOS_INTERES);
    expect(cursoresDe({ modo: "ninguna" }, "2026-08")).toEqual([""]);
  });
});

/** Un Supabase de mentira: la tabla de cargos en memoria. */
function adminFalso() {
  const filas = new Map<string, any>();
  let borrados = 0;
  const admin: any = {
    from: () => ({
      delete: () => ({ eq: () => ({ eq: () => { borrados++; filas.clear(); return Promise.resolve({ error: null }); } }) }),
      upsert: (fs: any[]) => { for (const f of fs) filas.set(f.detalle_id, f); return Promise.resolve({ error: null }); },
      select: () => {
        const q: any = { eq: () => q, order: () => q, range: (a: number, b: number) => Promise.resolve({ data: [...filas.values()].slice(a, b + 1), error: null }) };
        return q;
      },
    }),
  };
  return { admin, filas, borrados: () => borrados };
}

const PARAMS_DIA = ["date_from", "from", "date_created_from", "creation_date_from"];
const renglon = (id: string) => ({ charge_info: { detail_id: id, detail_type: "Almacenamiento Full", detail_amount: 10 } });

/**
 * Un MELI de mentira para un periodo de 74,059 renglones: sin filtro,
 * topa en 10 mil (422); con el filtro de día que `acepta`, cada día trae 2
 * renglones; cualquier otro filtro es «parámetro desconocido» (422).
 * La paginación por id (`from_id`) la rechaza con 422, salvo que se le dé
 * `porId`: entonces contesta páginas con `last_id` sobre `porId.total`
 * renglones numerados.
 */
function clienteFalso(acepta: string, porId?: { total: number }) {
  const llamadas: { ruta: string; params: Record<string, any> }[] = [];
  const cliente: any = {
    get: async (ruta: string, params: Record<string, any>) => {
      llamadas.push({ ruta, params });
      if (ruta.endsWith("/summary")) return {};
      if (params.from_id != null) {
        if (!porId) throw new MeliError("MELI 422: from_id no es un parámetro válido", 422);
        const desde = Number(params.from_id);
        const ids = Array.from({ length: porId.total }, (_, i) => i + 1).filter((id) => id > desde).slice(0, params.limit);
        // MELI cuenta el total DESDE from_id, no el del periodo.
        return { results: ids.map((id) => renglon(String(id))), last_id: ids.at(-1) ?? desde, total: porId.total - desde };
      }
      const filtro = PARAMS_DIA.find((p) => params[p] != null);
      if (filtro) {
        if (filtro !== acepta) throw new MeliError("MELI 422: parámetro desconocido", 422);
        const dia = String(params[filtro]).slice(0, 10);
        return { results: [renglon(`${dia}-a`), renglon(`${dia}-b`)].slice(0, params.limit), total: 2 };
      }
      if (params.offset + params.limit > 10_000) throw new MeliError("MELI 422: The sum of the offset and the limit cannot exceed 10_000.", 422);
      return { results: [], total: 74_059 };
    },
  };
  return { cliente, llamadas };
}

function almacenFalso(cliente: any, progresos: Record<string, Partial<ProgresoCargos>>) {
  const guardados: any[] = [];
  const almacen: AlmacenCargos = {
    cliente,
    tabla: "meli_cargos",
    dormir: async () => {},
    leerProgreso: async (periodo) => ({
      periodo, clave: `${periodo}-01`, offset: 0, total: null, completo: true, actualizadoEn: "2026-10-06T00:00:00Z",
      particion: null, cursor: null, offsetParticion: 0, sondeados: [],
      ...(progresos[periodo] ?? {}),
    }),
    guardarProgreso: async (p, extra) => {
      guardados.push({ ...p, ...extra });
      progresos[p.periodo] = { ...p, actualizadoEn: new Date().toISOString() };
    },
    pendientes: async () => [],
  };
  return { almacen, guardados };
}

const AGOSTO_ATORADO: Partial<ProgresoCargos> = { offset: 9_900, total: 74_059, completo: false, particion: { modo: "ninguna" }, cursor: "", offsetParticion: 9_900 };

describe("un periodo de más de 10 mil renglones se parte ANTES de pedir la página que MELI rechaza", () => {
  it("agosto 2026 atorado en 9,900: sondea el filtro, lo encuentra y lee el mes por día", async () => {
    const { admin, filas } = adminFalso();
    const { cliente, llamadas } = clienteFalso("date_from");
    const { almacen, guardados } = almacenFalso(cliente, { "2026-08": { ...AGOSTO_ATORADO } });
    const r = await sincronizarCargosCon(admin, "cta", "2026-08", almacen, Date.now() + 600_000);
    // Nunca se pidió la página que pasa del tope.
    expect(llamadas.some((l) => !PARAMS_DIA.some((p) => l.params[p] != null) && l.params.offset >= 9_900)).toBe(false);
    expect(r.error).toBeNull();
    expect(r.completo).toBe(true);
    expect(filas.size).toBe(62); // 31 días × 2 renglones
    expect(guardados.some((g) => g.particion?.modo === "dia" && g.particion?.param === "date_from")).toBe(true);
    expect(guardados.at(-1).avisos).toContain("Periodo partido por dia (date_from).");
  });

  it("si el plazo no alcanza para sondear los ocho filtros, lo descartado se recuerda y el siguiente latido sigue ahí", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
      const { admin } = adminFalso();
      const { cliente, llamadas } = clienteFalso("from");
      const { almacen, guardados } = almacenFalso(cliente, { "2026-08": { ...AGOSTO_ATORADO } });
      almacen.dormir = async (ms) => {
        vi.setSystemTime(Date.now() + ms);
      };
      // 20 s: cabe UNA sonda (12.5 s de cuota) y no la segunda.
      const r1 = await sincronizarCargosCon(admin, "cta", "2026-08", almacen, Date.now() + 20_000);
      expect(r1.completo).toBe(false);
      expect(r1.error).toContain("1 de 8 filtros descartados");
      expect(guardados.at(-1).sondeados).toEqual(["dia:date_from"]);
      expect(guardados.at(-1).offset).toBe(9_900);

      llamadas.length = 0;
      const r2 = await sincronizarCargosCon(admin, "cta", "2026-08", almacen, Date.now() + 3_600_000);
      // La segunda vuelta no vuelve a probar date_from: arranca en `from`.
      const sondas = llamadas.filter((l) => l.params.limit === 1);
      expect(sondas[0].params.from).toBeDefined();
      expect(sondas[0].params.date_from).toBeUndefined();
      expect(r2.completo).toBe(true);
      expect(r2.cargos).toBe(62);
    } finally {
      vi.useRealTimers();
    }
  });

  it("si MELI no acepta ningún filtro, se declara y se cierra con los 10 mil leídos (no se vuelve a pedir cada latido)", async () => {
    const { admin } = adminFalso();
    const { cliente } = clienteFalso("ninguno");
    const { almacen, guardados } = almacenFalso(cliente, { "2026-08": { ...AGOSTO_ATORADO } });
    const r = await sincronizarCargosCon(admin, "cta", "2026-08", almacen, Date.now() + 600_000);
    expect(r.completo).toBe(true);
    expect(r.error).toContain("no aceptó ningún filtro");
    expect(guardados.at(-1).completo).toBe(true);
  });
});

describe("la lectura por id (from_id / last_id): sin tope de 10 mil", () => {
  it("lee 2,500 renglones en tres páginas de 1,000 sin usar offset ni partir el periodo", async () => {
    const { admin, filas } = adminFalso();
    const { cliente, llamadas } = clienteFalso("ninguno", { total: 2_500 });
    const { almacen, guardados } = almacenFalso(cliente, { "2026-08": { completo: false, offset: 0, total: null } });
    const r = await sincronizarCargosCon(admin, "cta", "2026-08", almacen, Date.now() + 600_000);
    expect(r.completo).toBe(true);
    expect(r.error).toBeNull();
    expect(filas.size).toBe(2_500);
    const detalles = llamadas.filter((l) => l.ruta.endsWith("/details"));
    expect(detalles.map((l) => l.params.from_id)).toEqual([0, 1000, 2000]);
    expect(detalles.every((l) => l.params.offset == null && l.params.limit === 1000 && l.params.sort_by === "ID")).toBe(true);
    expect(guardados.at(-1)).toMatchObject({ modo: "id", completo: true, offset: 2_500, total: 2_500 });
  });

  it("si se acaba el plazo, guarda el last_id y el siguiente latido sigue desde ahí", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
      const { admin, filas } = adminFalso();
      const { cliente, llamadas } = clienteFalso("ninguno", { total: 2_500 });
      const { almacen, guardados } = almacenFalso(cliente, { "2026-08": { completo: false, offset: 0, total: null } });
      almacen.dormir = async (ms) => {
        vi.setSystemTime(Date.now() + ms);
      };
      // 10 s: cabe UNA página (la espera de cuota es de 12.5 s).
      const r1 = await sincronizarCargosCon(admin, "cta", "2026-08", almacen, Date.now() + 10_000);
      expect(r1.completo).toBe(false);
      expect(guardados.at(-1)).toMatchObject({ modo: "id", desdeId: 1000, offset: 1_000 });

      llamadas.length = 0;
      const r2 = await sincronizarCargosCon(admin, "cta", "2026-08", almacen, Date.now() + 600_000);
      expect(llamadas.filter((l) => l.ruta.endsWith("/details"))[0].params.from_id).toBe(1000);
      expect(r2.completo).toBe(true);
      expect(filas.size).toBe(2_500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("agosto 2026 «completo» con 9,900 de 74,059 por offset se relee por id en el fondo; leído por id corto no se insiste", async () => {
    const { admin } = adminFalso();
    const { cliente } = clienteFalso("ninguno", { total: 1_500 });
    const hoyMx = new Date(Date.now() - 6 * 3_600_000);
    const actual = hoyMx.toISOString().slice(0, 7);
    const anterior = new Date(Date.UTC(hoyMx.getUTCFullYear(), hoyMx.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const dosAtras = new Date(Date.UTC(hoyMx.getUTCFullYear(), hoyMx.getUTCMonth() - 2, 1)).toISOString().slice(0, 7);
    const alDia = { completo: true, offset: 100, total: 100, modo: "id" as const, actualizadoEn: new Date().toISOString() };
    const { almacen, guardados } = almacenFalso(cliente, {
      [actual]: alDia,
      [anterior]: alDia,
      [dosAtras]: { completo: true, offset: 9_900, total: 74_059, modo: null, actualizadoEn: new Date().toISOString() },
    });
    const r = await continuarCargosCon(admin, "cta", almacen, Date.now() + 600_000);
    expect(r).not.toBeNull();
    expect(guardados[0].periodo).toBe(dosAtras);
    expect(guardados.at(-1)).toMatchObject({ periodo: dosAtras, modo: "id", completo: true, offset: 1_500 });

    expect(necesitaRelecturaPorTotal({ completo: true, offset: 9_900, total: 74_059, modo: "offset" })).toBe(false);
    expect(necesitaRelecturaPorTotal({ completo: true, offset: 9_900, total: 74_059, modo: null })).toBe(true);
    expect(necesitaRelecturaPorTotal({ completo: false, offset: 9_900, total: 74_059, modo: null })).toBe(false);
  });

  it("si MELI rechaza from_id, se cae a la lectura por offset y lo anota", async () => {
    const { admin, filas } = adminFalso();
    const { cliente, llamadas } = clienteFalso("date_from");
    const { almacen, guardados } = almacenFalso(cliente, { "2026-08": { ...AGOSTO_ATORADO } });
    const r = await sincronizarCargosCon(admin, "cta", "2026-08", almacen, Date.now() + 600_000);
    expect(llamadas.filter((l) => l.params.from_id != null)).toHaveLength(1);
    expect(r.completo).toBe(true);
    expect(filas.size).toBe(62);
    expect(guardados.at(-1).modo).toBe("offset");
    expect(guardados.at(-1).avisos.some((a: string) => a.startsWith("MELI no aceptó la paginación por id"))).toBe(true);
  });
});

describe("un mes dado por completo con el mes todavía abierto se relee solo", () => {
  const hoyMx = new Date(Date.now() - 6 * 3_600_000);
  const actual = hoyMx.toISOString().slice(0, 7);
  const anterior = new Date(Date.UTC(hoyMx.getUTCFullYear(), hoyMx.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  /** El mes en curso recién leído: no le toca todavía. */
  const actualAlDia: Partial<ProgresoCargos> = { completo: true, offset: 100, total: 100, actualizadoEn: new Date().toISOString() };

  it("septiembre leído el día 7 se vuelve a leer, sin tirar lo guardado", async () => {
    const { admin, borrados } = adminFalso();
    const { cliente } = clienteFalso("date_from");
    const { almacen, guardados } = almacenFalso(cliente, {
      [anterior]: { completo: true, offset: 9_132, total: 9_132, actualizadoEn: `${anterior}-07T14:33:25Z` },
      [actual]: actualAlDia,
    });
    const r = await continuarCargosCon(admin, "cta", almacen, Date.now() + 600_000);
    expect(r).not.toBeNull();
    expect(guardados[0].periodo).toBe(anterior);
    expect(borrados()).toBe(0);
    expect(guardados.at(-1).completo).toBe(true);
  });

  it("un mes anterior leído después de cerrar ya no se toca", async () => {
    const { admin } = adminFalso();
    const { cliente, llamadas } = clienteFalso("date_from");
    const { almacen } = almacenFalso(cliente, {
      [anterior]: { completo: true, offset: 70_000, total: 70_000, actualizadoEn: new Date().toISOString() },
      [actual]: actualAlDia,
    });
    const r = await continuarCargosCon(admin, "cta", almacen, Date.now() + 600_000);
    expect(r).toBeNull();
    expect(llamadas).toEqual([]);
  });

  it("el mes en curso se relee cada 12 horas aunque esté «completo»", async () => {
    const { admin } = adminFalso();
    const { cliente } = clienteFalso("date_from");
    const { almacen, guardados } = almacenFalso(cliente, {
      [anterior]: { completo: true, offset: 70_000, total: 70_000, actualizadoEn: new Date().toISOString() },
      [actual]: { ...actualAlDia, actualizadoEn: new Date(Date.now() - 13 * 3_600_000).toISOString() },
    });
    const r = await continuarCargosCon(admin, "cta", almacen, Date.now() + 600_000);
    expect(r).not.toBeNull();
    expect(guardados[0].periodo).toBe(actual);
  });

  it("el cierre del periodo es el primer día del mes siguiente a las 0:00 de México", async () => {
    expect(cierreDelPeriodoMs("2026-09")).toBe(Date.UTC(2026, 9, 1, 6));
    expect(leidoAntesDeCerrar({ actualizadoEn: "2026-09-30T23:59:00-06:00" }, "2026-09")).toBe(true);
    expect(leidoAntesDeCerrar({ actualizadoEn: "2026-10-01T00:01:00-06:00" }, "2026-09")).toBe(false);
    expect(leidoAntesDeCerrar({ actualizadoEn: null }, "2026-09")).toBe(true);
  });
});

describe("la facturación de los meses viejos se pide sola", () => {
  it("recorre del mes anterior hacia atrás hasta el primer mes con venta, sin pasarse", async () => {
    const { mesesHaciaAtras, PRIMER_PERIODO_FACTURACION } = await import("./cargos-meli");
    expect(mesesHaciaAtras("2026-09", "2026-05")).toEqual(["2026-08", "2026-07", "2026-06", "2026-05"]);
    expect(mesesHaciaAtras("2026-01", "2025-11")).toEqual(["2025-12", "2025-11"]);
    expect(mesesHaciaAtras("2026-05", "2026-05")).toEqual([]);
    expect(PRIMER_PERIODO_FACTURACION).toBe("2026-05");
  });
});
