import { describe, expect, it } from "vitest";
import {
  agruparErrores,
  agruparPorModelo,
  clavePaquete,
  codigoDeOrden,
  esDeUnModelo,
  necesitaFranja,
  numerarPaquetes,
  numerosPreparados,
  parsearCodigoDeOrden,
  partirSku,
  renglonesDeEtiqueta,
  textoDeEtiqueta,
} from "./despacho";

describe("partirSku", () => {
  it("separa modelo, color y talla, con el color de varias palabras", () => {
    expect(partirSku("GT135-DK BROWN-26")).toEqual({ modelo: "GT135", color: "DK BROWN", talla: "26" });
  });
  it("ignora el sufijo de país", () => {
    expect(partirSku("GT114-BEIGE-23-MX")).toEqual({ modelo: "GT114", color: "BEIGE", talla: "23" });
  });
  it("no truena con un SKU raro", () => {
    expect(partirSku("LOQUESEA")).toEqual({ modelo: "LOQUESEA", color: "", talla: "" });
  });
});

const paq = (orderId: string, sku: string, pares = 1) => ({
  orderId,
  packageId: `pk-${orderId}`,
  destinatario: null,
  pares: [{ sku, pares }],
});

describe("numerarPaquetes", () => {
  it("ordena por modelo, color y talla numérica, y numera desde 1", () => {
    const n = numerarPaquetes([
      paq("a", "GT150-CAMEL-27"),
      paq("b", "GT114-BLK-25-MX"),
      paq("c", "GT114-BEIGE-9"),
      paq("d", "GT114-BEIGE-23"),
    ]);
    expect(n.map((p) => `${p.numero}:${p.pares[0].sku}`)).toEqual([
      "1:GT114-BEIGE-9",
      "2:GT114-BEIGE-23",
      "3:GT114-BLK-25-MX",
      "4:GT150-CAMEL-27",
    ]);
  });

  it("la talla 9 va antes que la 23 (numérica, no alfabética)", () => {
    const n = numerarPaquetes([paq("a", "X-C-23"), paq("b", "X-C-9")]);
    expect(n[0].pares[0].sku).toBe("X-C-9");
  });

  it("dos pedidos iguales quedan en orden estable por id", () => {
    const n = numerarPaquetes([paq("z", "X-C-1"), paq("a", "X-C-1")]);
    expect(n.map((p) => p.orderId)).toEqual(["a", "z"]);
  });
});

describe("textoDeEtiqueta", () => {
  it("lleva el número y el SKU; con dos pares, la cantidad", () => {
    const [p] = numerarPaquetes([
      { orderId: "a", packageId: "pk", destinatario: null, pares: [{ sku: "GT135-DK BROWN-26", pares: 2 }] },
    ]);
    expect(textoDeEtiqueta(p)).toBe("#1 · GT135-DK BROWN-26 ×2");
  });
});

describe("agruparPorModelo", () => {
  it("junta los paquetes consecutivos del mismo modelo y suma pares", () => {
    const g = agruparPorModelo(
      numerarPaquetes([paq("a", "GT114-BEIGE-23"), paq("b", "GT114-BLK-25", 2), paq("c", "GT150-CAMEL-27")]),
    );
    expect(g.map((x) => [x.modelo, x.pares, x.paquetes.length])).toEqual([
      ["GT114", 3, 2],
      ["GT150", 1, 1],
    ]);
  });
});

describe("renglonesDeEtiqueta", () => {
  it("un paquete con dos productos da dos renglones, cada uno con su FNSKU; sin FNSKU va el código de hoja", () => {
    const [p] = numerarPaquetes([
      {
        orderId: "o", packageId: "pk", destinatario: null,
        pares: [
          { sku: "GT134-NAVY-24-MX", pares: 1, fnsku: "X004KYMZZB" },
          { sku: "GT134-NAVY-RED-24-MX", pares: 2, fnsku: null },
        ],
      },
    ]);
    expect(renglonesDeEtiqueta(p, 5)).toEqual([
      { sku: "GT134-NAVY-24-MX", pares: 1, texto: "#1 · GT134-NAVY-24-MX", codigo: "X004KYMZZB", esHoja: false },
      { sku: "GT134-NAVY-RED-24-MX", pares: 2, texto: "GT134-NAVY-RED-24-MX ×2", codigo: "TT5-1", esHoja: true },
    ]);
  });
});

describe("código de orden", () => {
  it("el número de pedido va tal cual y se reconoce por sus 18 dígitos", () => {
    expect(codigoDeOrden("585899174098143165")).toBe("585899174098143165");
    expect(parsearCodigoDeOrden("585899174098143165")).toBe("585899174098143165");
    expect(parsearCodigoDeOrden("X004KYMZZ1")).toBeNull();
    expect(parsearCodigoDeOrden("TT8-12")).toBeNull();
  });
});

const mezcla = (orderId: string, skus: [string, number][]) => ({
  orderId,
  packageId: `pk-${orderId}`,
  destinatario: null,
  pares: skus.map(([sku, pares]) => ({ sku, pares })),
});

describe("esDeUnModelo", () => {
  it("una pieza sola, dos pares del mismo zapato y dos tallas del mismo modelo son UN modelo", () => {
    expect(esDeUnModelo(mezcla("a", [["GT114-BEIGE-23", 1]]))).toBe(true);
    expect(esDeUnModelo(mezcla("b", [["GT114-BEIGE-23", 2]]))).toBe(true);
    expect(esDeUnModelo(mezcla("c", [["GT114-BEIGE-23", 1], ["GT114-BLK-25", 1]]))).toBe(true);
  });
  it("dos modelos distintos son revuelto", () => {
    expect(esDeUnModelo(mezcla("d", [["GT114-BEIGE-23", 1], ["GT135-DK BROWN-26", 1]]))).toBe(false);
  });
});

describe("numerarPaquetes: primero un modelo, luego lo revuelto", () => {
  it("los revueltos se van al final aunque su modelo vaya antes en el alfabeto", () => {
    const n = numerarPaquetes([
      mezcla("revuelto", [["GT114-BEIGE-23", 1], ["GT135-DK BROWN-26", 1]]),
      paq("solo", "GT150-CAMEL-27"),
      paq("dos", "GT114-BLK-25"),
    ], "un-modelo");
    expect(n.map((p) => [p.numero, p.orderId, p.revuelto])).toEqual([
      [1, "dos", false],
      [2, "solo", false],
      [3, "revuelto", true],
    ]);
  });

  it("dentro de cada bloque se sigue caminando la bodega: modelo, color, talla", () => {
    const n = numerarPaquetes([
      mezcla("r2", [["GT150-CAMEL-27", 1], ["GT114-BEIGE-23", 1]]),
      mezcla("r1", [["GT114-BEIGE-23", 1], ["GT229-BLK-25", 1]]),
      paq("s2", "GT150-CAMEL-27"),
      paq("s1", "GT114-BEIGE-9"),
    ], "un-modelo");
    expect(n.map((p) => p.orderId)).toEqual(["s1", "s2", "r1", "r2"]);
  });

  it("un paquete de varios pares del mismo modelo sigue contando como un modelo", () => {
    const n = numerarPaquetes([
      mezcla("revuelto", [["GT114-BEIGE-23", 1], ["GT229-BLK-25", 1]]),
      mezcla("gt114x2", [["GT114-BEIGE-23", 2]]),
    ], "un-modelo");
    expect(n[0].orderId).toBe("gt114x2");
    expect(n[0].revuelto).toBe(false);
  });

  it("un corte VIEJO (orden de bodega) no se renumera: el revuelto se queda donde iba", () => {
    // Sus hojas ya están impresas y a medio preparar; cambiarle los números
    // dejaría el papel de la mesa sin cuadrar.
    const paquetes = [
      mezcla("revuelto", [["GT114-BEIGE-23", 1], ["GT135-DK BROWN-26", 1]]),
      paq("solo", "GT150-CAMEL-27"),
      paq("dos", "GT114-BLK-25"),
    ];
    expect(numerarPaquetes(paquetes).map((p) => p.orderId)).toEqual(["revuelto", "dos", "solo"]);
    expect(numerarPaquetes(paquetes, "bodega").map((p) => p.orderId)).toEqual(["revuelto", "dos", "solo"]);
  });
});

describe("agruparPorModelo con revueltos", () => {
  it("los revueltos van en su propia sección al final, no con el modelo de su primer par", () => {
    const g = agruparPorModelo(
      numerarPaquetes([
        paq("a", "GT114-BEIGE-23"),
        mezcla("r", [["GT114-BLK-25", 1], ["GT150-CAMEL-27", 2]]),
        paq("b", "GT150-CAMEL-27"),
      ], "un-modelo"),
      "un-modelo",
    );
    expect(g.map((x) => [x.modelo, x.pares, x.paquetes.length, x.revuelto])).toEqual([
      ["GT114", 1, 1, false],
      ["GT150", 1, 1, false],
      ["Revueltos", 3, 1, true],
    ]);
  });

  it("en un corte viejo no hay sección de revueltos: la lista sale como se imprimió", () => {
    const paquetes = [
      paq("a", "GT114-BEIGE-23"),
      mezcla("r", [["GT114-BLK-25", 1], ["GT150-CAMEL-27", 2]]),
      paq("b", "GT150-CAMEL-27"),
    ];
    const g = agruparPorModelo(numerarPaquetes(paquetes));
    expect(g.map((x) => [x.modelo, x.paquetes.length, x.revuelto])).toEqual([
      ["GT114", 2, false],
      ["GT150", 1, false],
    ]);
  });
});

describe("numerosPreparados", () => {
  const numerados = numerarPaquetes([
    paq("a", "GT114-BEIGE-23"),
    paq("b", "GT150-CAMEL-27"),
    mezcla("c", [["GT114-BLK-25", 1], ["GT229-BLK-25", 1]]),
  ], "un-modelo");

  it("la constancia se sigue por pedido + paquete, así que cambiar el orden no la pierde", () => {
    expect(numerosPreparados(numerados, [clavePaquete({ orderId: "c", packageId: "pk-c" })])).toEqual([3]);
    expect(numerosPreparados(numerados, ["a|pk-a", "b|pk-b"])).toEqual([1, 2]);
  });

  it("un pedido de un solo paquete se reconoce aunque el id del paquete no cuadre", () => {
    // Se preparó cuando TikTok todavía no daba el id del paquete.
    expect(numerosPreparados(numerados, ["a|"])).toEqual([1]);
  });

  it("lo que no es de este corte no cuenta", () => {
    expect(numerosPreparados(numerados, ["zzz|pk-zzz"])).toEqual([]);
  });
});

describe("agruparErrores", () => {
  it("el mismo error con distinto número de paquete es UN renglón con sus pedidos", () => {
    const g = agruparErrores([
      { orderId: "586046124374394129", error: "Sin horario: TikTok Shop 36009003 en /fulfillment/202309/packages/1211045315452896529/handover_time_slots: Internal error." },
      { orderId: "586055135307793947", error: "Sin horario: TikTok Shop 36009003 en /fulfillment/202309/packages/1211038810720994843/handover_time_slots: Internal error." },
      { orderId: "586039688287127464", error: "Se acabó el tiempo; entra al siguiente corte." },
      { orderId: "586055636979910433", error: "Se acabó el tiempo; entra al siguiente corte." },
      { orderId: "586055774151673724", error: "Se acabó el tiempo; entra al siguiente corte." },
      { orderId: "", error: "TikTok no dio horario de recolección para 52 paquetes: salieron como recolección sin hora fija." },
    ]);
    expect(g.map((x) => [x.pedidos.length, x.mensaje])).toEqual([
      [3, "Se acabó el tiempo; entra al siguiente corte."],
      [2, "Sin horario: TikTok Shop 36009003 en /fulfillment/202309/packages/N/handover_time_slots: Internal error."],
      [0, "TikTok no dio horario de recolección para 52 paquetes: salieron como recolección sin hora fija."],
    ]);
    expect(g[1].ejemplo).toContain("1211045315452896529");
  });
});

describe("necesitaFranja", () => {
  it("J&T deja espacio abajo: sin franja", () => {
    expect(necesitaFranja("J&T MX")).toBe(false);
    expect(necesitaFranja("J&T Express")).toBe(false);
    expect(necesitaFranja("JT MX")).toBe(false);
  });
  it("Cainiao llena la hoja hasta abajo: con franja", () => {
    expect(necesitaFranja("Cainiao MX L2L ")).toBe(true);
  });
  it("una paquetería que no se conoce, o ninguna, lleva franja: encimarse cuesta más", () => {
    expect(necesitaFranja("Estafeta")).toBe(true);
    expect(necesitaFranja(null)).toBe(true);
    expect(necesitaFranja("")).toBe(true);
  });
});

describe("faltantesDePaquetes", () => {
  it("un paquete cancelado después del corte conserva su número pero no falta ni cuenta en el total", async () => {
    const { faltantesDePaquetes } = await import("./despacho");
    const paquetes: any[] = [
      { numero: 1, orderId: "a", cancelado: false },
      { numero: 2, orderId: "b", cancelado: true },
      { numero: 3, orderId: "c" },
    ];
    const r = faltantesDePaquetes(paquetes, new Set([1]));
    expect(r.faltantes.map((p) => p.numero)).toEqual([3]);
    expect(r.cancelados).toBe(1);
    expect(r.total).toBe(2);
  });

  it("uno que ya se fue con el repartidor sin escanearse está resuelto: cuenta en el total, no falta", async () => {
    const { faltantesDePaquetes, yaSeEnvio } = await import("./despacho");
    const paquetes: any[] = [
      { numero: 1, orderId: "a", enviado: true },
      { numero: 2, orderId: "b", enviado: true },
      { numero: 3, orderId: "c" },
    ];
    const r = faltantesDePaquetes(paquetes, new Set([2]));
    expect(r.faltantes.map((p) => p.numero)).toEqual([3]);
    expect(r.enviados).toBe(1);
    expect(r.total).toBe(3);
    expect(yaSeEnvio("IN_TRANSIT")).toBe(true);
    expect(yaSeEnvio("DELIVERED")).toBe(true);
    expect(yaSeEnvio("AWAITING_COLLECTION")).toBe(false);
    expect(yaSeEnvio("CANCELLED")).toBe(false);
  });
});

describe("cambiosDeRelectura", () => {
  it("dice qué pedidos dejaron de faltar: los que pasaron a enviados o a cancelados", async () => {
    const { cambiosDeRelectura } = await import("./despacho");
    const antes = [
      { orderId: "a", estado: "AWAITING_COLLECTION" },
      { orderId: "b", estado: "AWAITING_COLLECTION" },
      { orderId: "c", estado: "AWAITING_SHIPMENT" },
      { orderId: "d", estado: "IN_TRANSIT" },
      { orderId: "e", estado: "AWAITING_COLLECTION" },
    ];
    const despues = new Map<string, string | null>([
      ["a", "IN_TRANSIT"],
      ["b", "CANCELLED"],
      ["c", "AWAITING_COLLECTION"],
      ["d", "DELIVERED"],
    ]);
    const r = cambiosDeRelectura(antes, despues);
    expect(r.enviados).toEqual(["a"]);
    expect(r.cancelados).toEqual(["b"]);
  });
});
