import { describe, expect, it } from "vitest";
import { numerarPaquetes, codigoDeHoja, parsearCodigoDeHoja, codigoDeEtiqueta } from "./despacho";
import { avanzar, darPorBueno, estadoInicial, fraseDeCompletado, fraseParaVoz, pedidoHablado } from "./preparar";

const paquetes = numerarPaquetes([
  { orderId: "a", packageId: "pa", destinatario: null, pares: [{ sku: "GT114-BEIGE-23", pares: 1, fnsku: "X001AAA" }] },
  { orderId: "b", packageId: "pb", destinatario: null, pares: [{ sku: "GT114-BLK-25", pares: 2, fnsku: "X001BBB" }] },
  { orderId: "c", packageId: "pc", destinatario: null, pares: [{ sku: "GT150-CAMEL-27", pares: 1, fnsku: null }] },
  { orderId: "d", packageId: "pd", destinatario: null, pares: [{ sku: "GT114-BEIGE-23", pares: 1, fnsku: "X001AAA" }] },
  {
    orderId: "e", packageId: "pe", destinatario: null,
    pares: [{ sku: "GT160-NAVY-24", pares: 1, fnsku: "X001EEE" }, { sku: "GT160-NAVY-25", pares: 1, fnsku: null }],
  },
]);
// Orden esperado: #1 a (BEIGE-23), #2 d (BEIGE-23), #3 b (BLK-25 ×2), #4 c (GT150), #5 e (GT160)
const paquetesConOrden = numerarPaquetes([
  { orderId: "585899174098143100", packageId: "pa", destinatario: null, pares: [{ sku: "GT114-BEIGE-23", pares: 1, fnsku: "X001AAA" }] },
  { orderId: "585899174098143165", packageId: "pd", destinatario: null, pares: [{ sku: "GT114-BEIGE-23", pares: 1, fnsku: "X001AAA" }] },
]);
const CORTE = 7;
const nadie = new Set<number>();

describe("códigos", () => {
  it("hoja va y viene; etiqueta = FNSKU, o código de hoja si no hay", () => {
    expect(codigoDeHoja(7, 12)).toBe("TT7-12");
    expect(parsearCodigoDeHoja("tt7-12")).toEqual({ corte: 7, numero: 12 });
    expect(codigoDeEtiqueta(paquetes[0], CORTE)).toBe("X001AAA");
    expect(codigoDeEtiqueta(paquetes[3], CORTE)).toBe("TT7-4");
  });
});

describe("empezar por la etiqueta (lo normal)", () => {
  it("la etiqueta elige el SIGUIENTE paquete sin preparar con ese producto, y pita por par", () => {
    let e = avanzar(estadoInicial(), "X001AAA", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.paquete?.numero).toBe(1);
    expect(e.pitidos).toBe(1);
    e = avanzar(e, "X001AAA", CORTE, paquetes, nadie);
    expect(e.paso).toBe("listo");
    // Con el #1 preparado, la misma etiqueta va al #2.
    const e2 = avanzar(estadoInicial(), "X001AAA", CORTE, paquetes, new Set([1]));
    expect(e2.paquete?.numero).toBe(2);
  });

  it("dos pares: dos pitidos al identificar y dos escaneos de producto", () => {
    let e = avanzar(estadoInicial(), "X001BBB", CORTE, paquetes, nadie);
    expect(e.paquete?.numero).toBe(3);
    expect(e.pitidos).toBe(2);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.indicacion).toMatch(/faltan 1 par/);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("listo");
    expect(e.escaneos).toEqual(["X001BBB", "X001BBB", "X001BBB"]);
  });

  it("si ya se prepararon todos los de ese producto, lo dice", () => {
    const e = avanzar(estadoInicial(), "X001AAA", CORTE, paquetes, new Set([1, 2]));
    expect(e.error).toMatch(/ya están preparados/);
  });

  it("un código que no es de nada avisa sin avanzar", () => {
    const e = avanzar(estadoInicial(), "ZZZ", CORTE, paquetes, nadie);
    expect(e.paso).toBe("inicio");
    expect(e.error).toMatch(/no es código de producto, pedido ni renglón/);
  });
});

describe("empezar por el pedido (la hoja) es el camino principal", () => {
  it("número de pedido → producto → listo, con el paquete EXACTO aunque haya otros iguales", () => {
    // a y d llevan el mismo producto; escanear el pedido "d" tiene que ir al #2, no al #1
    let e = avanzar(estadoInicial(), "585899174098143165", CORTE, paquetesConOrden, nadie);
    expect(e.paso).toBe("producto");
    expect(e.paquete?.orderId).toBe("585899174098143165");
    expect(e.pitidos).toBe(1);
    e = avanzar(e, "X001AAA", CORTE, paquetesConOrden, nadie);
    expect(e.paso).toBe("listo");
  });

  it("un pedido que no está en el corte, o ya preparado, no entra", () => {
    expect(avanzar(estadoInicial(), "999999999999999999", CORTE, paquetesConOrden, nadie).error).toMatch(/no está en este corte/);
    const num = paquetesConOrden.find((p) => p.orderId === "585899174098143165")!.numero;
    expect(avanzar(estadoInicial(), "585899174098143165", CORTE, paquetesConOrden, new Set([num])).error).toMatch(/ya está preparado/);
  });

  it("hoja (TTn-m) → producto → listo", () => {
    let e = avanzar(estadoInicial(), "TT7-3", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.pitidos).toBe(2);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("listo");
  });

  it("un producto de otro paquete no avanza", () => {
    let e = avanzar(estadoInicial(), "TT7-1", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.error).toMatch(/no va en el #1/);
  });

  it("hoja de otro corte, ya preparada o inexistente, no entra", () => {
    expect(avanzar(estadoInicial(), "TT6-1", CORTE, paquetes, nadie).error).toMatch(/corte #6/);
    expect(avanzar(estadoInicial(), "TT7-1", CORTE, paquetes, new Set([1])).error).toMatch(/ya está preparado/);
    expect(avanzar(estadoInicial(), "TT7-99", CORTE, paquetes, nadie).error).toMatch(/No hay renglón/);
  });
});

describe("lo que no debe pasar en el producto", () => {
  it("un producto equivocado no avanza", () => {
    let e = avanzar(estadoInicial(), "X001AAA", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.error).toMatch(/no va en el #1/);
  });

  it("escanear un tercer par cuando eran dos, no pasa", () => {
    let e = avanzar(estadoInicial(), "X001BBB", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    e = avanzar(e, "X001BBB", CORTE, paquetes, nadie);
    expect(e.paso).toBe("listo");
    const otra = avanzar(e, "X001BBB", CORTE, paquetes, new Set([3]));
    expect(otra.error).toMatch(/ya están preparados/);
  });
});

describe("sin FNSKU: solo lo cierra 'Dar por bueno'", () => {
  it("paquete entero sin FNSKU: hoja y el botón", () => {
    let e = avanzar(estadoInicial(), "TT7-4", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.indicacion).toMatch(/Dar por bueno/);
    // El escáner no puede cerrarlo.
    const intento = avanzar(e, "LOQUESEA", CORTE, paquetes, nadie);
    expect(intento.error).toBeTruthy();
    e = darPorBueno(e);
    expect(e.paso).toBe("listo");
    expect(e.escaneos).toContain("MANUAL:GT150-CAMEL-27×1");
  });

  it("paquete mixto: el par con FNSKU se escanea, el otro se da por bueno", () => {
    let e = avanzar(estadoInicial(), "X001EEE", CORTE, paquetes, nadie);
    expect(e.paquete?.numero).toBe(5);
    expect(e.pitidos).toBe(2);
    e = avanzar(e, "X001EEE", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.indicacion).toMatch(/sin código/);
    e = darPorBueno(e);
    expect(e.paso).toBe("listo");
  });

  it("'Dar por bueno' no cierra lo que sí tiene FNSKU", () => {
    const e = avanzar(estadoInicial(), "X001EEE", CORTE, paquetes, nadie);
    const d = darPorBueno(e);
    // Cierra el par sin FNSKU, pero el X001EEE sigue faltando.
    expect(d.paso).toBe("producto");
    expect(d.indicacion).toMatch(/faltan 1 par/);
    const bloqueado = darPorBueno({ ...d });
    expect(bloqueado.error).toMatch(/sí tiene código/);
  });
});

describe("la bocina", () => {
  it("dice cuántos pares y de qué, con el modelo letra por letra", async () => {
    const { fraseParaVoz } = await import("./preparar");
    const [dos] = numerarPaquetes([
      { orderId: "585899174098140055", packageId: "p", destinatario: null, pares: [{ sku: "GT135-DK BROWN-26", pares: 2, fnsku: "F" }] },
    ]);
    expect(fraseParaVoz(dos)).toBe("Pedido 0, 0, 5, 5. 2 pares, G T 135, dk brown, talla 26");
  });
  it("con dos productos los dice uno tras otro", async () => {
    const { fraseParaVoz } = await import("./preparar");
    const [p] = numerarPaquetes([
      { orderId: "585899174098140055", packageId: "p", destinatario: null, pares: [{ sku: "GT114-BEIGE-23-MX", pares: 1, fnsku: "A" }, { sku: "GT114-BLK-25-MX", pares: 1, fnsku: "B" }] },
    ]);
    expect(fraseParaVoz(p)).toBe("Pedido 0, 0, 5, 5. 1 par, G T 114, beige, talla 23. 1 par, G T 114, blk, talla 25");
  });
});


describe("la bocina dice el pedido", () => {
  const p = paquetesConOrden[1]; // orderId 585899174098143165
  it("primero los últimos cuatro dígitos del pedido, luego el contenido", () => {
    expect(pedidoHablado("585899174098143165")).toBe("Pedido 3, 1, 6, 5");
    expect(fraseParaVoz(p)).toBe("Pedido 3, 1, 6, 5. 1 par, G T 114, beige, talla 23");
  });
  it("al terminar: pedido completado", () => {
    expect(fraseDeCompletado(p)).toBe("Pedido 3, 1, 6, 5, completado");
  });
});

describe("el código de MELI también da por bueno el par", () => {
  // La misma caja puede traer pegada la etiqueta de Amazon (FNSKU) o la de
  // Full de cualquiera de las dos cuentas de MELI: las tres son de ESE par.
  const paquetes = numerarPaquetes([
    {
      orderId: "585899174098140001",
      packageId: "p1",
      destinatario: null,
      // FNSKU de Amazon + el código Full de CADA cuenta de MELI.
      pares: [{ sku: "GT134-NAVY-24-MX", pares: 2, fnsku: "X001FNSKU", codigos: ["FIEE49194", "JNQX88982"] }],
    },
  ]);
  const nadie = new Set<number>();

  it("el código Full elige el paquete y descuenta igual que el FNSKU", () => {
    let e = avanzar(estadoInicial(), "FIEE49194", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    expect(e.paquete?.numero).toBe(1);
    e = avanzar(e, "FIEE49194", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    // Y el otro par se puede cerrar con el FNSKU: es el mismo producto.
    e = avanzar(e, "X001FNSKU", CORTE, paquetes, nadie);
    expect(e.paso).toBe("listo");
  });

  it("el código Full de la OTRA cuenta de MELI también vale", () => {
    let e = avanzar(estadoInicial(), "585899174098140001", CORTE, paquetes, nadie);
    expect(e.paso).toBe("producto");
    e = avanzar(e, "jnqx88982", CORTE, paquetes, nadie); // el escáner puede traerlo en minúsculas
    expect(e.error).toBeNull();
    expect(e.faltantes[0].faltan).toBe(1);
  });

  it("un par con código Full pero sin FNSKU ya NO se cierra a mano: se escanea", () => {
    const sueltos = numerarPaquetes([
      {
        orderId: "585899174098140002",
        packageId: "p2",
        destinatario: null,
        pares: [{ sku: "MY2304-PURPLE-23-MX", pares: 1, fnsku: null, codigos: ["MLM55555555"] }],
      },
    ]);
    let e = avanzar(estadoInicial(), "MLM55555555", CORTE, sueltos, nadie);
    expect(e.paso).toBe("producto");
    expect(darPorBueno(e).error).toMatch(/sí tiene código/);
    e = avanzar(e, "MLM55555555", CORTE, sueltos, nadie);
    expect(e.paso).toBe("listo");
  });

  it("un código de otro producto sigue sin pasar, y el aviso dice los que sí valen", () => {
    let e = avanzar(estadoInicial(), "585899174098140001", CORTE, paquetes, nadie);
    e = avanzar(e, "MLM00000000", CORTE, paquetes, nadie);
    expect(e.error).toMatch(/no va en el #1/);
    expect(e.error).toMatch(/X001FNSKU o FIEE49194 o JNQX88982/);
  });
});
