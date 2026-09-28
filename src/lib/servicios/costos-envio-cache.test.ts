import { describe, expect, it, vi } from "vitest";
import {
  CLAVE_ENVIO_REAL,
  EDAD_ENVIO_REAL_MS,
  armarRevision,
  leerEnviosRealesConEstado,
  type VarianteEnvio,
} from "./costos-envio";

/**
 * El 28-sep-2026 el RPC de ventas reales se cancelaba por tiempo desde la app
 * y `leerEnviosReales` devolvía un mapa vacío sin decir nada: la pantalla
 * caía al simulador y el GT229 volvía a salir con «4 cobran de más». Ahora
 * el resultado vive masticado en `app_cache`, se sirve aunque el RPC falle,
 * y un fallo se declara.
 */
const FILA = {
  sku: "GT229-TAB-24",
  ordenes: 4,
  unidades: 4,
  mediana: "67.6",
  comparables: 4,
  ordenes_de_mas: 0,
  pagado_de_mas: "0",
  de_mas_por_venta: "0",
  ultimos: [
    { fecha: "2026-09-27", total: 222.25, envio: 67.6, normal: 67.6, hermanas: 12 },
    { fecha: "2026-09-26", total: 222.25, envio: 67.6, normal: 67.6, hermanas: 12 },
  ],
};

function dbFalso(opts: {
  guardado?: { datos: unknown; vigente: boolean; generado_en: string } | null;
  rpc: () => Promise<{ data: unknown; error: unknown }>;
}) {
  const upserts: Record<string, unknown>[] = [];
  const rpc = vi.fn(opts.rpc);
  const db = {
    rpc,
    from: (tabla: string) => {
      if (tabla !== "app_cache") throw new Error(`tabla inesperada ${tabla}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.guardado ?? null, error: null }),
            }),
          }),
        }),
        upsert: async (fila: Record<string, unknown>) => {
          upserts.push(fila);
          return { error: null };
        },
      };
    },
  };
  return { db: db as never, rpc, upserts };
}

const variante = (sku: string, costo: number): VarianteEnvio => ({
  sku,
  itemId: "MLM1",
  inventoryId: null,
  modelo: "GT229",
  color: "TAB",
  talla: sku.split("-")[2],
  medida: { alto: costo > 76 ? 25 : 10, ancho: 24, largo: 28, peso: 500 },
  fuente: "MEASUREMENT",
  medidaVendedor: null,
  precio: 341,
  tipoPublicacion: "gold_special",
  envioGratis: true,
  estado: "active",
  costo,
  costoNormal: 76,
  pesoFacturable: null,
});

describe("ventas reales masticadas en app_cache", () => {
  it("sin renglón guardado pregunta el RPC, lo guarda y dice de cuándo es", async () => {
    const { db, rpc, upserts } = dbFalso({ rpc: async () => ({ data: [FILA], error: null }) });
    const r = await leerEnviosRealesConEstado(db, "cuenta");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(r.reales.get("GT229-TAB-24")?.comparables).toBe(4);
    expect(r.estado.aviso).toBeNull();
    expect(r.estado.skus).toBe(1);
    expect(r.estado.generadoEn).toBeTruthy();
    expect(upserts).toHaveLength(1);
    expect(upserts[0].clave).toBe(CLAVE_ENVIO_REAL);
    expect(upserts[0].vigente).toBe(true);
  });

  it("con renglón fresco NO pregunta el RPC: la pantalla lee un renglón", async () => {
    const { db, rpc } = dbFalso({
      guardado: {
        datos: { filas: [FILA], desde: "2026-07-30T00:00:00Z" },
        vigente: true,
        generado_en: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
      rpc: async () => {
        throw new Error("no se debía preguntar");
      },
    });
    const r = await leerEnviosRealesConEstado(db, "cuenta");
    expect(rpc).not.toHaveBeenCalled();
    expect(r.reales.size).toBe(1);
    expect(r.estado.aviso).toBeNull();
  });

  it("con renglón viejo y el RPC caído sirve lo guardado y lo declara", async () => {
    const hace2h = new Date(Date.now() - EDAD_ENVIO_REAL_MS - 3_600_000).toISOString();
    const { db, rpc } = dbFalso({
      guardado: { datos: { filas: [FILA], desde: "2026-07-30T00:00:00Z" }, vigente: true, generado_en: hace2h },
      rpc: async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } }),
    });
    const r = await leerEnviosRealesConEstado(db, "cuenta");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(r.reales.size).toBe(1);
    expect(r.estado.generadoEn).toBe(hace2h);
    expect(r.estado.aviso).toMatch(/statement timeout/);
    expect(r.estado.aviso).toMatch(/última lectura/);
  });

  it("sin nada guardado y el RPC caído, la revisión sale del simulador y LO DICE", async () => {
    const { db } = dbFalso({
      rpc: async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } }),
    });
    const r = await leerEnviosRealesConEstado(db, "cuenta");
    expect(r.reales.size).toBe(0);
    expect(r.estado.generadoEn).toBeNull();
    expect(r.estado.aviso).toMatch(/solo del simulador/);
    // Y la revisión con ese mapa vacío señala por el simulador, sin ventas.
    const [m] = armarRevision([variante("GT229-TAB-24", 152), variante("GT229-TAB-25", 76), variante("GT229-TAB-26", 76)], r.reales);
    expect(m.malas.map((v) => v.sku)).toEqual(["GT229-TAB-24"]);
    expect(m.malas[0].conVentas).toBe(false);
  });

  it("con las ventas reales leídas, el GT229 que paga lo mismo que sus hermanas NO se señala", async () => {
    const { db } = dbFalso({ rpc: async () => ({ data: [FILA], error: null }) });
    const r = await leerEnviosRealesConEstado(db, "cuenta");
    const [m] = armarRevision([variante("GT229-TAB-24", 152), variante("GT229-TAB-25", 76), variante("GT229-TAB-26", 76)], r.reales);
    expect(m.malas).toEqual([]);
  });
});
