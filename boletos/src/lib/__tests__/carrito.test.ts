import { describe, expect, it } from "vitest";
import { carritoVacio, leerCarrito, resumirCarrito } from "../carrito";

const tipos = [
  { id: "kit", nombre: "Kit de Jalá", precio: 350 },
  { id: "aco", nombre: "Acompañante", precio: 150 },
];
const donativo = { nombre: "Misheberaj", monto: 1000 };

describe("carrito", () => {
  it("suma boletos por tipo y el donativo", () => {
    const r = resumirCarrito({ renglones: [{ tipo_id: "kit", cantidad: 2 }, { tipo_id: "aco", cantidad: 1 }], donativos: 1 }, tipos, donativo);
    expect(r.boletos).toBe(3);
    expect(r.total).toBe(2 * 350 + 150 + 1000);
    expect(r.lineas.map((l) => l.nombre)).toEqual(["Kit de Jalá", "Acompañante", "Misheberaj"]);
  });

  it("ignora tipos desconocidos, ceros y el donativo si el evento no lo ofrece", () => {
    const r = resumirCarrito({ renglones: [{ tipo_id: "otro", cantidad: 5 }, { tipo_id: "kit", cantidad: 0 }], donativos: 2 }, tipos, { nombre: null, monto: null });
    expect(r.boletos).toBe(0);
    expect(r.total).toBe(0);
    expect(r.lineas).toEqual([]);
  });

  it("lee el formulario y descarta valores raros", () => {
    const f = new FormData();
    f.set("tipo_kit", "2");
    f.set("tipo_aco", "-3");
    f.set("donativos", "abc");
    const c = leerCarrito(f, tipos);
    expect(c).toEqual({ renglones: [{ tipo_id: "kit", cantidad: 2 }, { tipo_id: "aco", cantidad: 0 }], donativos: 0 });
    expect(carritoVacio(c)).toBe(false);
    expect(carritoVacio({ renglones: [{ tipo_id: "kit", cantidad: 0 }], donativos: 0 })).toBe(true);
  });
});
