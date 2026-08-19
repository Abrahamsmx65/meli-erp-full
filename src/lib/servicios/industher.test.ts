/**
 * El API de Industher todavía no enseña su forma real (solo hemos visto el
 * error de llave inválida), así que estas pruebas fijan el CONTRATO del
 * normalizador: qué formas acepta, qué sinónimos reconoce y qué hace cuando
 * falta un dato. Cuando el API conteste de verdad, la vista previa de
 * /importar dirá si algún campo quedó fuera y aquí se agrega el caso.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  descargarInventarioIndusther,
  extraerLista,
  normalizarInventario,
} from "./industher";

describe("extraerLista", () => {
  it("acepta la lista directamente en la raíz", () => {
    expect(extraerLista([{ sku: "A" }])).toEqual([{ sku: "A" }]);
  });

  it("encuentra la lista envuelta en claves conocidas", () => {
    expect(extraerLista({ inventario: [{ sku: "A" }] })).toEqual([{ sku: "A" }]);
    expect(extraerLista({ data: [{ sku: "A" }] })).toEqual([{ sku: "A" }]);
    expect(extraerLista({ total: 1, existencias: [{ sku: "A" }] })).toEqual([{ sku: "A" }]);
  });

  it("como última red, toma la primera lista de objetos que haya", () => {
    expect(extraerLista({ pagina: 1, cosas: [{ sku: "A" }] })).toEqual([{ sku: "A" }]);
  });

  it("truena con un mensaje claro si no hay lista", () => {
    expect(() => extraerLista({ error: "API Key inválida o ausente." })).toThrow(
      /No encontré una lista/,
    );
  });
});

describe("normalizarInventario", () => {
  it("lee renglones con los nombres del reporte de Excel", () => {
    const r = normalizarInventario([
      {
        "Almacén": "Industher",
        "Código almacén": "IND-01",
        SKU: "P123-GT107-CAMEL",
        "N-Pedido": "P123",
        Modelo: "GT107",
        Color: "CAMEL",
        Talla: "CORRIDA",
        Contenedor: "CT-9",
        "Cajas físicas": 10,
        "Cajas apartadas": 2,
        "En camino": 1,
        "Cajas disponibles": 8,
        "Pares por caja": 12,
      },
    ]);

    expect(r.filas).toHaveLength(1);
    const f = r.filas[0];
    expect(f.almacen).toBe("Industher");
    expect(f.codigoAlmacen).toBe("IND-01");
    expect(f.skuCaja).toBe("P123-GT107-CAMEL");
    expect(f.pedido).toBe("P123");
    expect(f.talla).toBe("CORRIDA");
    expect(f.cajasFisicas).toBe(10);
    expect(f.cajasDisponibles).toBe(8);
    expect(f.paresPorCaja).toBe(12);
    expect(r.almacenes).toEqual(["Industher"]);
  });

  it("reconoce sinónimos en camelCase y números que vienen como texto", () => {
    const r = normalizarInventario({
      inventario: [
        {
          bodega: "Industher",
          codigo: "P200-GT110-NAVY",
          numeroPedido: "P200",
          estilo: "GT110",
          color: "NAVY",
          talla: 26,
          cajasDisponibles: "15",
          paresPorCaja: "18",
        },
      ],
    });

    const f = r.filas[0];
    expect(f.almacen).toBe("Industher");
    expect(f.skuCaja).toBe("P200-GT110-NAVY");
    expect(f.pedido).toBe("P200");
    expect(f.modelo).toBe("GT110");
    expect(f.talla).toBe("26");
    expect(f.cajasDisponibles).toBe(15);
    expect(f.paresPorCaja).toBe(18);
    expect(r.camposDetectados.almacen).toBe("bodega");
    expect(r.camposDetectados.modelo).toBe("estilo");
  });

  it("deduce cajas disponibles de físicas menos apartadas si no vienen", () => {
    const r = normalizarInventario([
      { sku: "A", modelo: "GT1", talla: "25", cajas_fisicas: 10, cajas_apartadas: 3 },
    ]);
    expect(r.filas[0].cajasDisponibles).toBe(7);
  });

  it("arma el SKU de caja como PEDIDO-MODELO-COLOR si el API no lo manda", () => {
    const r = normalizarInventario([
      { pedido: "P300", modelo: "GT500", color: "BLACK", talla: "CORRIDA", cajas: 4 },
    ]);
    expect(r.filas[0].skuCaja).toBe("P300-GT500-BLACK");
  });

  it("sin campo de talla, todo se guarda como CORRIDA y se avisa", () => {
    const r = normalizarInventario([{ sku: "A", modelo: "GT1", cajas_disponibles: 4 }]);
    expect(r.filas[0].talla).toBe("CORRIDA");
    expect(r.avisos.some((a) => a.includes("CORRIDA"))).toBe(true);
  });

  it("asume el almacén Industher cuando el API no trae almacén", () => {
    const r = normalizarInventario([{ sku: "A", modelo: "GT1", talla: "25", cajas: 4 }]);
    expect(r.filas[0].almacen).toBe("Industher");
    expect(r.almacenes).toEqual(["Industher"]);
  });

  it("fusiona renglones repetidos sumando cajas, en vez de tronar el upsert", () => {
    const r = normalizarInventario([
      { sku: "A", modelo: "GT1", talla: "CORRIDA", cajas_disponibles: 4, cajas_fisicas: 5 },
      { sku: "A", modelo: "GT1", talla: "CORRIDA", cajas_disponibles: 2, cajas_fisicas: 2 },
    ]);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].cajasDisponibles).toBe(6);
    expect(r.filas[0].cajasFisicas).toBe(7);
    expect(r.avisos.some((a) => a.includes("repetidos"))).toBe(true);
  });

  it("reporta los campos del API que no reconoció, para poder auditarlos", () => {
    const r = normalizarInventario([
      { sku: "A", modelo: "GT1", talla: "25", cajas: 4, ubicacion_rack: "R-12" },
    ]);
    expect(r.camposIgnorados).toContain("ubicacion_rack");
  });

  it("salta renglones sin SKU ni modelo y lo avisa", () => {
    const r = normalizarInventario([
      { sku: "A", modelo: "GT1", talla: "25", cajas: 4 },
      { sku: "", modelo: "", talla: "25", cajas: 9 },
    ]);
    expect(r.filas).toHaveLength(1);
    expect(r.avisos.some((a) => a.includes("saltaron"))).toBe(true);
  });

  it("truena con mensaje claro si no hay ni SKU ni modelo en la respuesta", () => {
    expect(() => normalizarInventario([{ cantidad: 5, ubicacion: "R1" }])).toThrow(
      /ni SKU ni MODELO/,
    );
  });

  it("truena con mensaje claro si no hay ninguna columna de cajas", () => {
    expect(() => normalizarInventario([{ sku: "A", modelo: "GT1", talla: "25" }])).toThrow(
      /no trae cajas/,
    );
  });

  it("una lista vacía no truena: regresa cero filas con aviso", () => {
    const r = normalizarInventario([]);
    expect(r.filas).toHaveLength(0);
    expect(r.avisos.some((a) => a.includes("vacía"))).toBe(true);
  });

  it("entiende la respuesta real de Industher: campos en inglés con cajas y pares", () => {
    const r = normalizarInventario([
      {
        sku: "P400-GT200-BLACK",
        warehouse: "Industher",
        model: "GT200",
        color: "BLACK",
        size: "CORRIDA",
        container: "CT-11",
        physicalBoxes: 5,
        reservedBoxes: 1,
        availableBoxes: 4,
        boxesInTransit: 2,
        physicalPairs: 60,
        reservedPairs: 12,
        availablePairs: 48,
        pairsInTransit: 24,
      },
    ]);

    const f = r.filas[0];
    expect(f.almacen).toBe("Industher");
    expect(f.modelo).toBe("GT200");
    expect(f.contenedor).toBe("CT-11");
    expect(f.cajasFisicas).toBe(5);
    expect(f.cajasApartadas).toBe(1);
    expect(f.cajasDisponibles).toBe(4);
    expect(f.enCamino).toBe(2);
    // 60 pares físicos ÷ 5 cajas físicas = 12 pares por caja
    expect(f.paresPorCaja).toBe(12);
    expect(r.avisos.some((a) => a.includes("derivaron"))).toBe(true);
    expect(r.camposIgnorados).toEqual([]);
  });

  it("si los pares no dividen exacto entre las cajas, redondea y avisa", () => {
    const r = normalizarInventario([
      { sku: "A", model: "GT1", size: "25", physicalBoxes: 5, physicalPairs: 61 },
    ]);
    expect(r.filas[0].paresPorCaja).toBe(12);
    expect(r.avisos.some((a) => a.includes("no dividen exacto"))).toBe(true);
  });

  it("lee la respuesta REAL del API (captura del 2026-08-19): objetos anidados", () => {
    // Copiado tal cual de la respuesta real con limit=1.
    const respuesta = {
      generatedAt: "2026-08-19T19:21:18.434Z",
      readOnly: true,
      filters: { sku: null, warehouse: null, model: null, color: null, container: null },
      pagination: { total: 527, limit: 1, offset: 0, returned: 1, hasMore: true },
      totals: {
        physicalBoxes: 8548,
        reservedBoxes: 165,
        availableBoxes: 8383,
        inTransitBoxes: 0,
        physicalPairs: 253986,
        reservedPairs: 4920,
        availablePairs: 249066,
        inTransitPairs: 0,
      },
      inventory: [
        {
          warehouse: {
            id: "bb847ade-26e9-4de8-b6b2-11cea01fd3a5",
            code: "CASESHOP",
            name: "Caseshop",
          },
          sku: "IN10001-GT152-BLK",
          orderNumber: "IN10001",
          model: "GT152",
          color: "BLK",
          size: "Corrida",
          container: "CASESHOP",
          boxes: { physical: 2, reserved: 0, available: 2, inTransit: 0 },
          pairsPerBox: 24,
          pairs: { physical: 48, reserved: 0, available: 48, inTransit: 0 },
        },
      ],
    };

    const r = normalizarInventario(respuesta);
    expect(r.filas).toHaveLength(1);

    const f = r.filas[0];
    expect(f.almacen).toBe("Caseshop");
    expect(f.codigoAlmacen).toBe("CASESHOP");
    expect(f.skuCaja).toBe("IN10001-GT152-BLK");
    expect(f.pedido).toBe("IN10001");
    expect(f.modelo).toBe("GT152");
    expect(f.color).toBe("BLK");
    expect(f.talla).toBe("CORRIDA");
    expect(f.contenedor).toBe("CASESHOP");
    expect(f.cajasFisicas).toBe(2);
    expect(f.cajasApartadas).toBe(0);
    expect(f.cajasDisponibles).toBe(2);
    expect(f.enCamino).toBe(0);
    expect(f.paresPorCaja).toBe(24);
    expect(f.paresDisponibles).toBe(48);
    expect(r.almacenes).toEqual(["Caseshop"]);
    // Lo único sin mapear debe ser el id interno del almacén.
    expect(r.camposIgnorados).toEqual(["warehouse.id"]);
    expect(r.avisos).toEqual([]);
  });

  it("el pares por caja directo le gana a la derivación", () => {
    const r = normalizarInventario([
      {
        sku: "A",
        model: "GT1",
        size: "25",
        physicalBoxes: 5,
        physicalPairs: 60,
        pairsPerBox: 18,
      },
    ]);
    expect(r.filas[0].paresPorCaja).toBe(18);
  });
});

describe("descargarInventarioIndusther (paginación)", () => {
  const fila = (i: number) => ({ sku: `S${i}`, model: "GT1", availableBoxes: 1 });

  beforeEach(() => {
    vi.stubEnv("INDUSTHER_API_KEY", "llave-de-prueba");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("pagina con limit y offset hasta que una página venga incompleta", async () => {
    const llamadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        llamadas.push(String(url));
        expect(new Headers(init.headers).get("x-api-key")).toBe("llave-de-prueba");
        const offset = Number(new URL(String(url)).searchParams.get("offset"));
        const pagina =
          offset === 0
            ? Array.from({ length: 1000 }, (_, i) => fila(i))
            : [fila(1000), fila(1001)];
        return new Response(JSON.stringify({ inventario: pagina }), { status: 200 });
      }),
    );

    const r = await descargarInventarioIndusther();
    expect(r.lista).toHaveLength(1002);
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]).toContain("limit=1000");
    expect(llamadas[0]).toContain("offset=0");
    expect(llamadas[1]).toContain("offset=1000");
  });

  it("respeta pagination.hasMore aunque las páginas vengan de menos de mil", async () => {
    const llamadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        llamadas.push(String(url));
        const offset = Number(new URL(String(url)).searchParams.get("offset"));
        const cuerpo =
          offset === 0
            ? {
                pagination: { total: 527, returned: 300, hasMore: true },
                inventory: Array.from({ length: 300 }, (_, i) => fila(i)),
              }
            : {
                pagination: { total: 527, returned: 227, hasMore: false },
                inventory: Array.from({ length: 227 }, (_, i) => fila(300 + i)),
              };
        return new Response(JSON.stringify(cuerpo), { status: 200 });
      }),
    );

    const r = await descargarInventarioIndusther();
    expect(r.lista).toHaveLength(527);
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1]).toContain("offset=300");
  });

  it("si el API ignora el offset, corta y avisa en vez de duplicar inventario", async () => {
    const mismaPagina = Array.from({ length: 1000 }, (_, i) => fila(i));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(mismaPagina), { status: 200 })),
    );

    const r = await descargarInventarioIndusther();
    expect(r.lista).toHaveLength(1000);
    expect(r.avisos.some((a) => a.includes("offset"))).toBe(true);
  });

  it("propaga el mensaje de error del API (llave inválida)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "API Key inválida o ausente." }), {
            status: 401,
          }),
      ),
    );

    await expect(descargarInventarioIndusther()).rejects.toThrow(
      /API Key inválida o ausente/,
    );
  });

  it("sin INDUSTHER_API_KEY truena con instrucción clara, sin llamar al API", async () => {
    vi.stubEnv("INDUSTHER_API_KEY", "");
    const espia = vi.fn();
    vi.stubGlobal("fetch", espia);

    await expect(descargarInventarioIndusther()).rejects.toThrow(/INDUSTHER_API_KEY/);
    expect(espia).not.toHaveBeenCalled();
  });
});
