import { beforeEach, describe, expect, it, vi } from "vitest";

const { traerTodo } = vi.hoisted(() => ({ traerTodo: vi.fn() }));

vi.mock("../datos/repos", async (importOriginal) => {
  const original = await importOriginal<typeof import("../datos/repos")>();
  return { ...original, traerTodo };
});

import { gastosDelRango } from "./corte-meli";
import { aliasAmazonDeCuenta } from "./tiktok-despacho";
import {
  existe,
  pedidosNoCancelados,
  stockActualAmazon,
  stockActualMeli,
} from "./productos-nuevos";
import { cuentaCalzadoId, cuentaFundasId } from "./costos-unificados";
import { cuentaAmazon } from "./amazon";

function dbConResultado(resultado: { data: unknown; error: unknown }) {
  const consulta: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "neq", "in", "order", "limit"]) {
    consulta[metodo] = vi.fn(() => consulta);
  }
  consulta.maybeSingle = vi.fn(async () => resultado);
  consulta.then = (resolve: (valor: typeof resultado) => unknown) => Promise.resolve(resultado).then(resolve);
  return { from: vi.fn(() => consulta) };
}

describe("fallos de fuentes esenciales", () => {
  beforeEach(() => {
    traerTodo.mockReset();
  });

  it("no convierte una falla de gastos en un mes sin gastos", async () => {
    traerTodo.mockRejectedValueOnce(new Error("gastos_meli: timeout"));

    await expect(
      gastosDelRango({} as never, "cuenta", "2026-09-01", "2026-09-30"),
    ).rejects.toThrow("gastos_meli: timeout");
  });

  it("no convierte una falla de alias de TikTok en un catálogo sin equivalencias", async () => {
    traerTodo.mockRejectedValueOnce(new Error("tiktok_alias_amazon: permiso denegado"));

    await expect(aliasAmazonDeCuenta({} as never, "cuenta")).rejects.toThrow(
      "tiktok_alias_amazon: permiso denegado",
    );
  });

  it("propaga fallos al leer pedidos y al buscar historial, en vez de clasificar productos como nuevos", async () => {
    const error = { message: "timeout" };
    await expect(pedidosNoCancelados(dbConResultado({ data: null, error }) as never, "cuenta")).rejects.toThrow(
      "pedidos: timeout",
    );
    await expect(existe(dbConResultado({ data: null, error }) as never, "ventas_diarias", (q) => q)).rejects.toThrow(
      "ventas_diarias: timeout",
    );
  });

  it("propaga fallos del stock actual de MELI y Amazon", async () => {
    const error = { message: "permiso denegado" };
    await expect(stockActualMeli(dbConResultado({ data: null, error }) as never, "cuenta", ["SKU"])).rejects.toThrow(
      "stock_full: permiso denegado",
    );
    await expect(stockActualAmazon(dbConResultado({ data: null, error }) as never, ["SKU"])).rejects.toThrow(
      "amazon_inventario: permiso denegado",
    );
  });

  it("distingue una cuenta ausente de un fallo al descubrirla", async () => {
    await expect(cuentaCalzadoId(dbConResultado({ data: null, error: null }) as never)).resolves.toBeNull();
    await expect(cuentaFundasId(dbConResultado({ data: null, error: null }) as never)).resolves.toBeNull();

    const error = { message: "conexión interrumpida" };
    await expect(cuentaCalzadoId(dbConResultado({ data: null, error }) as never)).rejects.toThrow(
      "meli_accounts: conexión interrumpida",
    );
    await expect(cuentaFundasId(dbConResultado({ data: null, error }) as never)).rejects.toThrow(
      "yz_cuentas: conexión interrumpida",
    );
  });

  it("no interpreta un fallo al descubrir Amazon como una cuenta desconectada", async () => {
    await expect(
      cuentaAmazon(dbConResultado({ data: null, error: { message: "timeout" } }) as never),
    ).rejects.toThrow("amazon_accounts: timeout");
  });
});