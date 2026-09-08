import { describe, expect, it } from "vitest";
import { enviosActivos, enviosParaPantalla, sumarEnCamino, type EnvioRegistrado } from "./envios-registrados";
import type { StockFull } from "../engine/types";

const dia = 86_400_000;
const hace = (dias: number) => new Date(Date.now() - dias * dia).toISOString();

/**
 * Base falsa mínima para envios_full: sirve lecturas y APUNTA cada UPDATE,
 * para poder afirmar que la pantalla no escribe y que el fondo sí caduca.
 */
function dbEnvios(filas: Record<string, unknown>[], cajas: Record<string, unknown>[] = []) {
  const updates: { cambios: Record<string, unknown>; filtros: [string, string, unknown][] }[] = [];
  const db = {
    from(tabla: string) {
      const tablas: Record<string, Record<string, unknown>[]> = {
        envios_full: filas,
        envio_cajas: cajas,
      };
      const propias = tablas[tabla];
      if (!propias) throw new Error(`tabla inesperada: ${tabla}`);
      const estado = {
        filtros: [] as ((f: Record<string, unknown>) => boolean)[],
        update: null as Record<string, unknown> | null,
        rastro: [] as [string, string, unknown][],
        head: false,
        rango: null as null | [number, number],
      };
      const q = {
        select(_cols?: string, opts?: { head?: boolean }) {
          if (opts?.head) estado.head = true;
          return q;
        },
        update(cambios: Record<string, unknown>) {
          estado.update = cambios;
          return q;
        },
        eq(col: string, val: unknown) {
          estado.rastro.push(["eq", col, val]);
          estado.filtros.push((f) => f[col] === val);
          return q;
        },
        in(col: string, vals: unknown[]) {
          const s = new Set(vals);
          estado.filtros.push((f) => s.has(f[col]));
          return q;
        },
        lt(col: string, val: string) {
          estado.rastro.push(["lt", col, val]);
          estado.filtros.push((f) => String(f[col]) < val);
          return q;
        },
        gte(col: string, val: string) {
          estado.filtros.push((f) => String(f[col]) >= val);
          return q;
        },
        order() {
          return q;
        },
        range(a: number, b: number) {
          estado.rango = [a, b];
          return q;
        },
        then(res: (r: unknown) => unknown) {
          let elegidas = propias.filter((f) => estado.filtros.every((fn) => fn(f)));
          if (estado.update) {
            updates.push({ cambios: estado.update, filtros: estado.rastro });
            for (const f of elegidas) Object.assign(f, estado.update);
            return res({ error: null });
          }
          if (estado.head) return res({ count: elegidas.length, data: null, error: null });
          if (estado.rango) elegidas = elegidas.slice(estado.rango[0], estado.rango[1] + 1);
          return res({ data: elegidas, error: null });
        },
      };
      return q;
    },
  };
  return { db: db as never, updates };
}

const envio = (id: string, estado: string, hacedias: number): Record<string, unknown> => ({
  id,
  account_id: "cuenta",
  folio: null,
  bodegas: ["Caseshop"],
  cajas: 3,
  pares: 36,
  enviado_en: hace(hacedias),
  estado,
});

describe("enviosParaPantalla es SOLO lectura", () => {
  it("no escribe nada y aún así pinta caducado el que pasó del plazo", async () => {
    const { db, updates } = dbEnvios([
      envio("fresco", "enviado", 2),
      envio("pasado", "enviado", 9), // el fondo aún no lo marca
      envio("viejo", "caducado", 40), // caducado hace más de 30 días: fuera
      envio("reciente", "caducado", 10),
    ]);

    const lista = await enviosParaPantalla(db, "cuenta");

    expect(updates).toHaveLength(0); // un GET no debe escribir
    const porId = new Map(lista.map((e) => [e.id, e.estado]));
    expect(porId.get("fresco")).toBe("enviado");
    expect(porId.get("pasado")).toBe("caducado"); // el dato manda, no el UPDATE
    expect(porId.get("reciente")).toBe("caducado");
    expect(porId.has("viejo")).toBe(false);
    // La pantalla no baja el detalle por caja (payload), pero los totales de
    // cabecera siguen completos.
    expect(lista.every((e) => e.detalleCajas.length === 0)).toBe(true);
    expect(lista.reduce((a, e) => a + e.pares, 0)).toBe(36 * 3);
  });
});

describe("enviosActivos (el fondo) sí caduca y alimenta el plan", () => {
  it("marca caducado en la base lo que pasó del plazo y regresa solo los enviados", async () => {
    const { db, updates } = dbEnvios([envio("fresco", "enviado", 2), envio("pasado", "enviado", 9)]);

    const activos = await enviosActivos(db, "cuenta");

    expect(updates).toHaveLength(1);
    expect(updates[0].cambios.estado).toBe("caducado");
    expect(activos.map((e) => e.id)).toEqual(["fresco"]);
  });
});

describe("sumarEnCamino no cambia de cuentas", () => {
  it("toma el MÁXIMO contra lo que MELI ya reporta, nunca suma doble", () => {
    const stock: StockFull[] = [
      { sku: "GT110-NAVY-26-MX", disponible: 10, enTransferencia: 20, noDisponible: 0, total: 30 },
      { sku: "GT110-NAVY-27-MX", disponible: 5, enTransferencia: 0, noDisponible: 0, total: 5 },
    ];
    const envios: EnvioRegistrado[] = [
      {
        id: "e1",
        folio: null,
        bodegas: [],
        cajas: 2,
        pares: 36,
        enviadoEn: hace(1),
        estado: "enviado",
        detalleCajas: [
          {
            cajaCodigo: "c1",
            almacen: "Caseshop",
            skuCaja: null,
            pedido: null,
            cantidad: 1,
            pares: 36,
            detalle: [
              { sku: "GT110-NAVY-26-MX", talla: "26", paresTotales: 12 }, // MELI ya trae 20: gana MELI
              { sku: "GT110-NAVY-27-MX", talla: "27", paresTotales: 24 }, // MELI trae 0: gana el registro
            ],
          },
        ],
      },
    ];

    const res = sumarEnCamino(stock, envios);
    const porSku = new Map(res.map((s) => [s.sku, s]));
    expect(porSku.get("GT110-NAVY-26-MX")!.enTransferencia).toBe(20);
    expect(porSku.get("GT110-NAVY-26-MX")!.total).toBe(30);
    expect(porSku.get("GT110-NAVY-27-MX")!.enTransferencia).toBe(24);
    expect(porSku.get("GT110-NAVY-27-MX")!.total).toBe(29);
  });
});
