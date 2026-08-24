import { describe, expect, it } from "vitest";
import {
  enCaminoDesdePendientes,
  envioDeBloque,
  expandirFilaMeli,
  type PendientesIndusther,
} from "./industher-pendientes";
import { indexarCatalogo } from "../etiquetas/resolver";

// Un envío EXACTAMENTE como lo publica el bloque `pendingShipments`
// (radiografía del explorador, 2026-08-24): reference puede venir vacía,
// la fecha es occurredOn, boxes/pairs son planos, `products` es un CONTEO
// y los renglones viven en `lines`.
const envioApi = {
  id: "827ee2eb-1359-4910-9b2e-4c517b591f54",
  warehouse: { id: "3ad2219c", code: "ENVIOPACK", name: "EnvioPack" },
  reference: "",
  destination: "MERCADO LIBRE",
  occurredOn: "2026-08-24",
  boxes: 83,
  pairs: 2214,
  products: 18,
  lines: [
    {
      sku: "RT04-GT110-NAVY-28",
      orderNumber: "RT04",
      model: "GT110",
      color: "NAVY",
      size: "28",
      container: "RT04",
      boxes: 1,
      pairsPerBox: 30,
      pairs: 30,
    },
    {
      sku: "IN10099-GT114-PINK",
      orderNumber: "IN10099",
      model: "GT114",
      color: "PINK",
      size: "Corrida",
      container: "S244",
      boxes: 10,
      pairsPerBox: 24,
      pairs: 240,
    },
  ],
};

const indice = indexarCatalogo([
  { sku: "GT110-NAVY-28" },
  { sku: "GT114-PINK-23" },
  { sku: "GT114-PINK-24" },
]);

const corridas = [
  { pedido: "IN10099", modelo: "GT114", color: "PINK", tallas: { "23": 10, "24": 14 } },
];

describe("envíos pendientes del bloque pendingShipments (forma real)", () => {
  it("normaliza destino, fecha, totales y los renglones de `lines`", () => {
    const e = envioDeBloque(envioApi)!;
    expect(e.destino).toBe("MERCADO LIBRE");
    expect(e.fecha).toBe("2026-08-24");
    expect(e.cajas).toBe(83);
    expect(e.pares).toBe(2214);
    expect(e.filas).toHaveLength(2);
    expect(e.filas[1]).toMatchObject({
      sku: "IN10099-GT114-PINK",
      pedido: "IN10099",
      talla: "Corrida",
      cajas: 10,
      paresPorCaja: 24,
      cantidad: 240,
    });
  });

  it("sin referencia usa el id interno, y el destino MERCADO LIBRE lo marca de MELI", () => {
    const e = envioDeBloque(envioApi)!;
    expect(e.id).toBe("827ee2eb-1359-4910-9b2e-4c517b591f54");
    expect(e.esMeli).toBe(true);
  });

  it("con referencia, esa manda como ID y la regla 7/8 refuerza", () => {
    const e = envioDeBloque({ ...envioApi, reference: "74940544", destination: "" })!;
    expect(e.id).toBe("74940544");
    expect(e.esMeli).toBe(true);
    const otro = envioDeBloque({ ...envioApi, reference: "5000123", destination: "AMAZON" })!;
    expect(otro.esMeli).toBe(false);
  });

  it("`products` numérico no truena: los renglones salen de `lines`", () => {
    const e = envioDeBloque({ ...envioApi, lines: undefined })!;
    expect(e.filas).toHaveLength(0);
    expect(e.pares).toBe(2214);
  });
});

describe("expansión de filas a SKU de MELI", () => {
  const e = envioDeBloque(envioApi)!;

  it("una fila de talla real amarra directo", () => {
    expect(expandirFilaMeli(e.filas[0], indice, corridas)).toEqual([
      { sku: "GT110-NAVY-28", cantidad: 30 },
    ]);
  });

  it("una fila de CORRIDA se reparte con la corrida real del pedido", () => {
    expect(expandirFilaMeli(e.filas[1], indice, corridas)).toEqual([
      { sku: "GT114-PINK-23", cantidad: 100 },
      { sku: "GT114-PINK-24", cantidad: 140 },
    ]);
  });

  it("una corrida desconocida no se reparte: nada de inventar", () => {
    const sinCorrida = expandirFilaMeli(e.filas[1], indice, []);
    expect(sinCorrida).toEqual([]);
  });

  it("el en-camino a Full suma por talla y respeta tachados", () => {
    const tachado = { ...envioDeBloque(envioApi)!, omitido: true };
    const p: PendientesIndusther = { envios: [e, tachado], error: null };
    const porSku = enCaminoDesdePendientes(p, indice, corridas);
    expect(porSku.get("GT110-NAVY-28")).toBe(30);
    expect(porSku.get("GT114-PINK-24")).toBe(140);
    expect([...porSku.values()].reduce((a, b) => a + b, 0)).toBe(270);
  });
});
