import { describe, expect, it } from "vitest";
import { armarProducto, costoDeEnvio, normalizarCarrito, pagoCuadra, validarDatos } from "./tienda";

const producto = { product_id: "p1", modelo: "GT134", titulo: "Botín", descripcion: null, imagenes: [] };
const v = (sku_id: string, color: string, talla: string, interno: string | null, precio: number | null = 799) => ({
  sku_id, sku_interno: interno, color, talla, precio, precio_lista: null, imagen: null,
});

describe("armarProducto", () => {
  it("agrupa por color, ordena tallas y pone lo agotado al final", () => {
    const p = armarProducto(
      producto,
      [v("a", "Negro", "25", "N25"), v("b", "Negro", "23", "N23"), v("c", "Café", "24", "C24"), v("d", "Rojo", "24", null)],
      new Map([["N25", 2], ["N23", 0], ["C24", 0]]),
    );
    expect(p.colores.map((c) => c.color)).toEqual(["Negro", "Café"]);
    expect(p.colores[0].tallas.map((t) => t.talla)).toEqual(["23", "25"]);
    expect(p.disponible).toBe(2);
    expect(p.tallasRango).toBe("25");
    expect(p.precioDesde).toBe(799);
  });
});

describe("envío", () => {
  it("gratis desde el umbral", () => {
    expect(costoDeEnvio(500, { costo: 99, gratisDesde: 999 })).toBe(99);
    expect(costoDeEnvio(999, { costo: 99, gratisDesde: 999 })).toBe(0);
    expect(costoDeEnvio(0, { costo: 99, gratisDesde: null })).toBe(0);
  });
});

describe("carrito", () => {
  it("junta repetidos, quita basura y topa", () => {
    expect(normalizarCarrito([{ skuId: "a", cantidad: 2 }, { skuId: "a", cantidad: 9 }, { skuId: "", cantidad: 1 }, { skuId: "b", cantidad: -1 }, "x"])).toEqual([
      { skuId: "a", cantidad: 10 },
    ]);
    expect(normalizarCarrito(null)).toEqual([]);
  });
});

describe("pago", () => {
  it("solo cuadra si es de ESTE pedido y cubre el total", () => {
    expect(pagoCuadra({ external_reference: "7", transaction_amount: 898 }, { id: 7, total: 898 })).toBe(true);
    expect(pagoCuadra({ external_reference: "8", transaction_amount: 898 }, { id: 7, total: 898 })).toBe(false);
    expect(pagoCuadra({ external_reference: "7", transaction_amount: 1 }, { id: 7, total: 898 })).toBe(false);
  });
});

describe("datos de envío", () => {
  it("pide lo obligatorio y revisa CP y teléfono", () => {
    const { errores } = validarDatos({ email: "malo", cp: "123", telefono: "55" });
    expect(errores.email).toBeTruthy();
    expect(errores.cp).toBeTruthy();
    expect(errores.telefono).toBeTruthy();
    expect(errores.calle).toBeTruthy();
    const ok = validarDatos({
      email: "A@B.MX", nombre: "Ana", telefono: "55 1234 5678", calle: "Juárez", numero: "10",
      colonia: "Centro", cp: "06000", ciudad: "CDMX", estado: "Ciudad de México",
    });
    expect(ok.errores).toEqual({});
    expect(ok.datos.email).toBe("a@b.mx");
  });
});

describe("fotos de Amazon", () => {
  it("cada color usa sus fotos de Amazon; sin ellas, las de TikTok", () => {
    const p = armarProducto(
      { ...producto, imagenes: ["tt1", "tt2"], fotos_amazon: { Negro: ["amz1", "amz2"] } },
      [v("a", "Negro", "25", "N25"), v("c", "Café", "24", "C24")],
      new Map([["N25", 1], ["C24", 1]]),
    );
    const negro = p.colores.find((c) => c.color === "Negro")!;
    const cafe = p.colores.find((c) => c.color === "Café")!;
    expect(negro.fotos).toEqual(["amz1", "amz2"]);
    expect(negro.imagen).toBe("amz1");
    expect(cafe.fotos).toEqual(["tt1", "tt2"]);
  });
});
