import { describe, expect, it } from "vitest";
import { traerRpcTodo } from "./repos";

/**
 * El API corta la respuesta en 1,000 renglones aunque la función devuelva
 * más. `traerRpcTodo` pide por páginas hasta que una viene incompleta; aquí
 * se prueba con un cliente falso que imita ese tope.
 */
function dbFalsa(totalFilas: number, tope: number, fallaEnPagina?: number) {
  const llamadas: { desde: number; hasta: number }[] = [];
  const db = {
    rpc(_fn: string, _params: unknown) {
      return {
        range(desde: number, hasta: number) {
          llamadas.push({ desde, hasta });
          if (fallaEnPagina != null && llamadas.length - 1 === fallaEnPagina) {
            return Promise.resolve({ data: null, error: { message: "se cayó" } });
          }
          // El API nunca devuelve más de `tope` renglones de un jalón.
          const pedidos = Math.min(hasta - desde + 1, tope);
          const filas = [];
          for (let i = desde; i < Math.min(desde + pedidos, totalFilas); i++) {
            filas.push({ n: i });
          }
          return Promise.resolve({ data: filas, error: null });
        },
      };
    },
  };
  return { db, llamadas };
}

describe("traerRpcTodo", () => {
  it("junta todas las páginas cuando la función devuelve más del tope", async () => {
    const { db, llamadas } = dbFalsa(5966, 1000);
    const { filas, error } = await traerRpcTodo<{ n: number }>(db as any, "f", {});
    expect(error).toBeNull();
    // Sin paginar solo habrían llegado 1,000 de 5,966.
    expect(filas).toHaveLength(5966);
    expect(filas[0].n).toBe(0);
    expect(filas[5965].n).toBe(5965);
    expect(llamadas).toHaveLength(6); // 5 llenas + 1 incompleta
  });

  it("una sola página cuando cabe todo", async () => {
    const { db, llamadas } = dbFalsa(120, 1000);
    const { filas, error } = await traerRpcTodo<{ n: number }>(db as any, "f", {});
    expect(filas).toHaveLength(120);
    expect(error).toBeNull();
    expect(llamadas).toHaveLength(1);
  });

  it("no se cuelga cuando el total es múltiplo exacto del paso", async () => {
    const { db } = dbFalsa(2000, 1000);
    const { filas } = await traerRpcTodo<{ n: number }>(db as any, "f", {});
    expect(filas).toHaveLength(2000);
  });

  it("devuelve el error y lo ya traído, sin inventar que está completo", async () => {
    const { db } = dbFalsa(5000, 1000, 2);
    const { filas, error } = await traerRpcTodo<{ n: number }>(db as any, "f", {});
    expect(error).toBe("se cayó");
    expect(filas).toHaveLength(2000); // las dos páginas que sí llegaron
  });
});
