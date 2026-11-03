import { describe, expect, it } from "vitest";
import {
  agregarACola,
  claveCola,
  esErrorDeRed,
  guardarCola,
  leerCola,
  quitarDeCola,
  textoDeCola,
  type AlmacenCola,
  type PendienteGuardar,
} from "./cola-preparados";

function memoria(): AlmacenCola & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => void datos.set(k, v),
    removeItem: (k) => void datos.delete(k),
  };
}

const p = (numero: number, orderId = `o${numero}`): PendienteGuardar => ({
  numero,
  orderId,
  packageId: `pk${numero}`,
  escaneos: [orderId, "X004EVU1ZL"],
  en: "2026-10-07T17:00:00.000Z",
});

describe("cola de constancias sin señal", () => {
  it("se guarda y se lee por corte; con la lista vacía la clave se borra", () => {
    const s = memoria();
    expect(leerCola(s, 87)).toEqual([]);
    expect(guardarCola(s, 87, [p(1), p(2)])).toBe(true);
    expect(leerCola(s, 87).map((x) => x.numero)).toEqual([1, 2]);
    expect(leerCola(s, 88)).toEqual([]);
    guardarCola(s, 87, []);
    expect(s.datos.has(claveCola(87))).toBe(false);
  });

  it("un valor corrupto o un storage que truena cuentan como cola vacía y no tiran la estación", () => {
    const s = memoria();
    s.setItem(claveCola(87), "{no es json");
    expect(leerCola(s, 87)).toEqual([]);
    const roto: AlmacenCola = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("lleno");
      },
      removeItem: () => undefined,
    };
    expect(leerCola(roto, 87)).toEqual([]);
    expect(guardarCola(roto, 87, [p(1)])).toBe(false);
    expect(leerCola(null, 87)).toEqual([]);
  });

  it("agregar reemplaza por pedido + paquete (el mismo paquete escaneado dos veces es uno) y quitar lo saca", () => {
    let cola = agregarACola([], p(1));
    cola = agregarACola(cola, p(2));
    cola = agregarACola(cola, { ...p(1), escaneos: ["o1", "GVSP46612"] });
    expect(cola.map((x) => x.numero)).toEqual([2, 1]);
    expect(cola[1].escaneos).toEqual(["o1", "GVSP46612"]);
    expect(quitarDeCola(cola, p(2)).map((x) => x.numero)).toEqual([1]);
  });

  it("distingue un fallo de red de un rechazo del servidor", () => {
    expect(esErrorDeRed(new TypeError("Failed to fetch"))).toBe(true);
    expect(esErrorDeRed(new TypeError("Load failed"))).toBe(true);
    expect(esErrorDeRed(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(esErrorDeRed(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(esErrorDeRed(new Error("Clave incorrecta."))).toBe(false);
    expect(esErrorDeRed(new Error("Ese corte no existe."))).toBe(false);
    expect(esErrorDeRed(null)).toBe(false);
  });

  it("el indicador dice cuántos faltan y si está mandando o esperando el wifi", () => {
    expect(textoDeCola(0, true)).toBeNull();
    expect(textoDeCola(1, false)).toBe("1 paquete por guardar · sin señal, se mandan solos al volver el wifi");
    expect(textoDeCola(3, true)).toBe("3 paquetes por guardar · mandando…");
  });
});
