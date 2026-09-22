/**
 * Contra la Proforma Invoice REAL de la fábrica (IN10151, formato .xls de 2011).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aplicarOverridesProforma,
  colorDeProforma,
  importarProforma,
  tallaDeEncabezado,
  type Proforma,
} from "./proforma";

const buf = readFileSync(join(process.cwd(), "fixtures", "PEDIDO_IN10151.xls"));

describe("piezas sueltas del lector", () => {
  it("saca el color en inglés de los tres idiomas", () => {
    expect(colorDeProforma("BLK 黑 NEGRO")).toBe("BLK");
    expect(colorDeProforma("NAVY 深藍 AZUL MARINO")).toBe("NAVY");
    expect(colorDeProforma("GREY 灰GRIS")).toBe("GREY");
    expect(colorDeProforma("BROWN")).toBe("BROWN");
    expect(colorDeProforma("M BROWN -RED")).toBe("M BROWN-RED");
    expect(colorDeProforma("M  BROWN      ")).toBe("M BROWN");
  });

  it("lee la talla mexicana del encabezado", () => {
    expect(tallaDeEncabezado("25MX=39")).toBe("25");
    expect(tallaDeEncabezado("30MX=45")).toBe("30");
    expect(tallaDeEncabezado("26")).toBe("26");
    expect(tallaDeEncabezado("259.74mm")).toBeNull();
    expect(tallaDeEncabezado("PER CTN")).toBeNull();
  });
});

describe("Proforma Invoice real (.xls)", () => {
  it("lee el número de pedido", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    expect(p.pedido).toBe("IN10151");
  });

  it("detecta las tallas de la corrida", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    expect(p.tallasDetectadas).toEqual(["25", "26", "27", "28", "29", "30"]);
  });

  it("lee los 6 renglones con sus modelos y colores", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    expect(p.lineas).toHaveLength(6);
    expect(p.lineas.map((l) => l.modelo)).toEqual([
      "GT104-1", "GT104-2", "GT104-3", "GT104-4", "GT104-6", "GT104-7",
    ]);
    expect(p.lineas.map((l) => l.color)).toEqual([
      "BLK", "GREY", "RED", "NAVY", "BROWN", "BLK",
    ]);
  });

  it("la corrida de cada renglón suma sus pares por caja", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    for (const l of p.lineas) {
      const suma = Object.values(l.tallas).reduce((a, b) => a + b, 0);
      expect(suma).toBe(l.paresPorCaja);
      expect(l.cuadra).toBe(true);
    }
  });

  it("saca la corrida correcta del primer renglón", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    const gt1041 = p.lineas.find((l) => l.modelo === "GT104-1")!;
    expect(gt1041.tallas).toEqual({ "25": 3, "26": 6, "27": 15, "28": 12, "29": 12 });
    expect(gt1041.paresPorCaja).toBe(48);
    expect(gt1041.cajas).toBe(70);
    expect(gt1041.pares).toBe(3360);
  });

  it("los totales cuadran con el pie del archivo", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    expect(p.totales.cajas).toBe(380);
    expect(p.totales.pares).toBe(18240);
  });

  it("cajas × pares por caja = pares, en cada renglón", async () => {
    const p = await importarProforma(buf, { nombre: "IN10151 GT104.xls" });
    for (const l of p.lineas) {
      expect(l.cajas * l.paresPorCaja).toBe(l.pares);
    }
  });
});

describe("ajustes del usuario al confirmar (aplicarOverridesProforma)", () => {
  // Los números son los del pedido REAL IN10121 (GT114 BEIGE): las columnas
  // de talla traen CAJAS de una sola talla, CTNS dice 300 y PRS 7,200, así
  // que cada caja trae 7200 / 300 = 24 pares.
  function proformaCajasCompletas(): Proforma {
    return {
      pedido: "IN10121",
      proveedor: "CHAOZHOU YINGYUAN SHOES CO., LTD.",
      lineas: [
        {
          modelo: "GT114",
          color: "BEIGE",
          colorCrudo: "BEIGE",
          descripcion: "",
          tallas: { "23": 46, "24": 88, "25": 96, "26": 53, "27": 17 },
          paresPorCaja: 300,
          cajas: 300,
          pares: 7200,
          precioUnitario: null,
          cuadra: false,
          unitalla: null,
        },
      ],
      totales: { cajas: 300, pares: 7200, importe: null },
      tallasDetectadas: ["23", "24", "25", "26", "27"],
      avisos: [],
    };
  }

  it("caja completa: parte el renglón en una línea unitalla por talla con PRS ÷ CTNS pares por caja", () => {
    const p = proformaCajasCompletas();
    aplicarOverridesProforma(p, [{ indice: 0, esCajaCompleta: true }]);

    expect(p.lineas).toHaveLength(5);
    for (const l of p.lineas) {
      expect(l.unitalla).not.toBeNull();
      expect(l.paresPorCaja).toBe(24);
    }
    const t23 = p.lineas.find((l) => l.unitalla === "23")!;
    expect(t23.cajas).toBe(46);
    expect(t23.pares).toBe(46 * 24);
    expect(t23.tallas).toEqual({ "23": 46 });

    // Los totales no cambian: eran los correctos desde el archivo.
    expect(p.totales.cajas).toBe(300);
    expect(p.totales.pares).toBe(7200);
  });

  it("rechaza cajas completas si PRS no es múltiplo de CTNS, con el detalle", () => {
    const p = proformaCajasCompletas();
    p.lineas[0].pares = 7201;
    p.totales.pares = 7201;
    expect(() => aplicarOverridesProforma(p, [{ indice: 0, esCajaCompleta: true }])).toThrow(
      /7201 pares no es múltiplo de 300 cajas/,
    );
  });

  it("rechaza cajas completas si las tallas no suman las cajas del archivo", () => {
    const p = proformaCajasCompletas();
    p.lineas[0].tallas = { "23": 46, "24": 88 };
    expect(() => aplicarOverridesProforma(p, [{ indice: 0, esCajaCompleta: true }])).toThrow(
      /suman 134 cajas pero CTNS dice 300/,
    );
  });

  it("edita modelo y color en mayúsculas sin tocar los números", () => {
    const p = proformaCajasCompletas();
    aplicarOverridesProforma(p, [{ indice: 0, modelo: "gt114-a", color: "Beige Claro" }]);
    expect(p.lineas[0].modelo).toBe("GT114-A");
    expect(p.lineas[0].color).toBe("BEIGE CLARO");
    expect(p.lineas[0].colorCrudo).toBe("Beige Claro");
    expect(p.lineas[0].cajas).toBe(300);
    expect(p.lineas[0].pares).toBe(7200);
  });

  it("una línea que el archivo ya trae como unitalla no se vuelve a partir", () => {
    const p = proformaCajasCompletas();
    p.lineas[0].unitalla = "23";
    p.lineas[0].tallas = { "23": 300 };
    aplicarOverridesProforma(p, [{ indice: 0, esCajaCompleta: true }]);
    expect(p.lineas).toHaveLength(1);
    expect(p.lineas[0].paresPorCaja).toBe(300);
  });
});
