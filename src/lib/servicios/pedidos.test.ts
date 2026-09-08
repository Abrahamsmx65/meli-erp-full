import { describe, expect, it } from "vitest";
import { listarPedidos } from "./pedidos";
import { listarContenedores } from "./contenedores";

/**
 * Base falsa que se porta como PostgREST de verdad: cualquier lectura SIN
 * .range() regresa a lo más 1,000 filas SIN avisar (el tope de Supabase).
 * Así la prueba reproduce el recorte silencioso: el código que no pagina
 * pierde filas aquí igual que en producción.
 */
function dbConTope(tablas: Record<string, unknown[]>) {
  return {
    from(tabla: string) {
      const filas = (tablas[tabla] ?? []) as Record<string, unknown>[];
      const estado = {
        head: false,
        rango: null as null | [number, number],
        filtros: [] as ((f: Record<string, unknown>) => boolean)[],
        orden: [] as string[],
      };
      const q: {
        select: (cols: string, opts?: { head?: boolean }) => typeof q;
        eq: (col: string, val: unknown) => typeof q;
        neq: (col: string, val: unknown) => typeof q;
        in: (col: string, vals: unknown[]) => typeof q;
        order: (col: string) => typeof q;
        range: (a: number, b: number) => typeof q;
        then: (res: (r: unknown) => unknown) => unknown;
      } = {
        select(_cols, opts) {
          if (opts?.head) estado.head = true;
          return q;
        },
        eq(col, val) {
          estado.filtros.push((f) => f[col] === val);
          return q;
        },
        neq(col, val) {
          estado.filtros.push((f) => f[col] !== val);
          return q;
        },
        in(col, vals) {
          const s = new Set(vals);
          estado.filtros.push((f) => s.has(f[col]));
          return q;
        },
        order(col) {
          estado.orden.push(col);
          return q;
        },
        range(a, b) {
          estado.rango = [a, b];
          return q;
        },
        then(res) {
          let r = filas.filter((f) => estado.filtros.every((fn) => fn(f)));
          for (const col of [...estado.orden].reverse()) {
            r = [...r].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
          }
          if (estado.head) return res({ count: r.length, data: null, error: null });
          // El tope de PostgREST: sin range, corta en 1,000 filas calladito.
          r = estado.rango ? r.slice(estado.rango[0], estado.rango[1] + 1) : r.slice(0, 1000);
          return res({ data: r, error: null });
        },
      };
      return q;
    },
  } as never;
}

const relleno = (n: number) => String(n).padStart(6, "0");

describe("listarPedidos con más de 1,000 filas", () => {
  it("suma TODAS las líneas aunque PostgREST corte en 1,000", async () => {
    // 1,500 líneas en el pedido A y 30 en el B: sin paginar, el tope de
    // 1,000 se comería 530 líneas y la lista reportaría menos pares.
    const lineas = [
      ...Array.from({ length: 1500 }, (_, i) => ({
        id: `la-${relleno(i)}`,
        pedido_id: "pa",
        modelo: `GT${100 + (i % 7)}`,
        cajas: 1,
        pares: 12,
      })),
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `lb-${relleno(i)}`,
        pedido_id: "pb",
        modelo: "GT200",
        cajas: 2,
        pares: 24,
      })),
    ];

    const db = dbConTope({
      pedidos: [
        { id: "pa", pedido: "IN10001", proveedor: null, fecha_pi: null, estado: "creado", creado_en: "2026-01-02", account_id: "cuenta" },
        { id: "pb", pedido: "IN10002", proveedor: null, fecha_pi: null, estado: "creado", creado_en: "2026-01-01", account_id: "cuenta" },
      ],
      pedido_lineas: lineas,
      contenedores: [],
      contenedor_lineas: [],
    });

    const res = await listarPedidos(db, "cuenta");
    const pa = res.find((p) => p.pedido === "IN10001")!;
    const pb = res.find((p) => p.pedido === "IN10002")!;

    expect(pa.cajas).toBe(1500);
    expect(pa.pares).toBe(1500 * 12);
    expect(pa.modelos).toBe(7);
    expect(pb.cajas).toBe(60);
    expect(pb.pares).toBe(720);
  });

  it("cuenta las cajas de más de 1,000 contenedores", async () => {
    const contenedores = Array.from({ length: 1050 }, (_, i) => ({
      id: `c-${relleno(i)}`,
      account_id: "cuenta",
      numero: `S${i}-2026`,
      estado: "en_transito",
      fecha_llegada_est: null,
    }));

    const db = dbConTope({
      pedidos: [
        { id: "pa", pedido: "IN10001", proveedor: null, fecha_pi: null, estado: "creado", creado_en: "2026-01-02", account_id: "cuenta" },
      ],
      pedido_lineas: [{ id: "l1", pedido_id: "pa", modelo: "GT100", cajas: 1050, pares: 12600 }],
      contenedores,
      contenedor_lineas: contenedores.map((c, i) => ({
        id: `cl-${relleno(i)}`,
        contenedor_id: c.id,
        pedido_linea_id: "l1",
        cajas: 1,
      })),
    });

    const res = await listarPedidos(db, "cuenta");
    expect(res[0].contenedores).toHaveLength(1050);
    expect(res[0].cajasAsignadas).toBe(1050);
  });

  it("no pierde amarres cuando UN contenedor pasa de 1,000 renglones (el embed los cortaba sin avisar)", async () => {
    // El tope db-max-rows también aplica a los recursos embebidos y ahí ni
    // siquiera hay HTTP 206: por eso contenedor_lineas se lee directo.
    const lineas = Array.from({ length: 1200 }, (_, i) => ({
      id: `l-${relleno(i)}`,
      pedido_id: "pa",
      modelo: "GT100",
      cajas: 1,
      pares: 12,
    }));

    const db = dbConTope({
      pedidos: [
        { id: "pa", pedido: "IN10001", proveedor: null, fecha_pi: null, estado: "creado", creado_en: "2026-01-02", account_id: "cuenta" },
      ],
      pedido_lineas: lineas,
      contenedores: [
        { id: "c1", account_id: "cuenta", numero: "S1-2026", estado: "en_transito", fecha_llegada_est: null },
      ],
      contenedor_lineas: lineas.map((l, i) => ({
        id: `cl-${relleno(i)}`,
        contenedor_id: "c1",
        pedido_linea_id: l.id,
        cajas: 1,
      })),
    });

    const res = await listarPedidos(db, "cuenta");
    expect(res[0].cajasAsignadas).toBe(1200);
    expect(res[0].contenedores[0].cajas).toBe(1200);
  });
});

describe("listarContenedores con más de 1,000 líneas amarradas", () => {
  it("amarra cada contenedor con su pedido por tandas de ids", async () => {
    // 1,200 pedido_lineas repartidas en 3 contenedores: el .in() de un solo
    // jalón habría pasado de 1,000 ids (URL kilométrica y tope de filas), y
    // el embed habría cortado los renglones sin avisar.
    const lineas = Array.from({ length: 1200 }, (_, i) => ({
      id: `l-${relleno(i)}`,
      pedido_id: i < 600 ? "pa" : "pb",
      modelo: "GT100",
      cajas: 1,
      pares: 12,
    }));
    const contenedores = [0, 1, 2].map((c) => ({
      id: `c${c}`,
      account_id: "cuenta",
      numero: `S${c}-2026`,
      numero_naviera: null,
      naviera: null,
      fecha_salida: null,
      fecha_llegada_est: `2026-0${c + 1}-01`,
      fecha_llegada_real: null,
      almacen_destino: null,
      estado: "en_transito",
      notas: null,
    }));
    const contenedor_lineas = lineas.map((l, i) => ({
      id: `cl-${relleno(i)}`,
      contenedor_id: `c${Math.floor(i / 400)}`,
      pedido_linea_id: l.id,
      cajas: 1,
    }));

    const db = dbConTope({
      contenedores,
      contenedor_lineas,
      pedido_lineas: lineas,
      pedidos: [
        { id: "pa", pedido: "IN10001" },
        { id: "pb", pedido: "IN10002" },
      ],
    });

    const res = await listarContenedores(db, "cuenta");
    expect(res.map((c) => c.numero)).toEqual(["S0-2026", "S1-2026", "S2-2026"]);
    // Cada caja quedó amarrada a SU pedido: nada se perdió en el corte.
    expect(res.reduce((a, c) => a + c.cajas, 0)).toBe(1200);
    const porPedido = new Map<string, number>();
    for (const c of res) for (const p of c.pedidos) porPedido.set(p.pedido, (porPedido.get(p.pedido) ?? 0) + p.cajas);
    expect(porPedido.get("IN10001")).toBe(600);
    expect(porPedido.get("IN10002")).toBe(600);
  });
});
