/**
 * El API de Industher todavía no enseña su forma real (solo hemos visto el
 * error de llave inválida), así que estas pruebas fijan el CONTRATO del
 * normalizador: qué formas acepta, qué sinónimos reconoce y qué hace cuando
 * falta un dato. Cuando el API conteste de verdad, la vista previa de
 * /importar dirá si algún campo quedó fuera y aquí se agrega el caso.
 */
import { describe, expect, it } from "vitest";
import { extraerLista, normalizarInventario } from "./industher";

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
});
