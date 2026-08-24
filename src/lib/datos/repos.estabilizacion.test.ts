import { describe, expect, it, vi } from "vitest";
import type { DB } from "./repos";
import {
  conCandado,
  RecursoOcupadoError,
  reemplazarExistencias,
} from "./repos";

function dbConRpc(rpc: ReturnType<typeof vi.fn>): DB {
  return { rpc } as unknown as DB;
}

describe("conCandado", () => {
  it("adquiere y libera el mismo token al terminar", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: "token-1", error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    const resultado = await conCandado(
      dbConRpc(rpc),
      "cuenta-1",
      "meli_sync",
      600,
      async () => "ok",
    );

    expect(resultado).toBe("ok");
    expect(rpc).toHaveBeenNthCalledWith(1, "adquirir_candado_trabajo", {
      p_account_id: "cuenta-1",
      p_recurso: "meli_sync",
      p_ttl_segundos: 600,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "liberar_candado_trabajo", {
      p_account_id: "cuenta-1",
      p_recurso: "meli_sync",
      p_token: "token-1",
    });
  });

  it("rechaza la segunda ejecución sin iniciar la tarea", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const tarea = vi.fn();

    await expect(
      conCandado(
        dbConRpc(rpc),
        "cuenta-1",
        "meli_sync",
        600,
        tarea,
        "Sincronización ocupada.",
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RecursoOcupadoError>>({
        name: "RecursoOcupadoError",
        message: "Sincronización ocupada.",
        recurso: "meli_sync",
      }),
    );
    expect(tarea).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("libera el candado aunque la tarea falle", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: "token-error", error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(
      conCandado(dbConRpc(rpc), "cuenta-1", "meli_sync", 600, async () => {
        throw new Error("falló MELI");
      }),
    ).rejects.toThrow("falló MELI");

    expect(rpc).toHaveBeenLastCalledWith("liberar_candado_trabajo", {
      p_account_id: "cuenta-1",
      p_recurso: "meli_sync",
      p_token: "token-error",
    });
  });
});

describe("reemplazarExistencias", () => {
  it("delega la foto completa a una sola llamada transaccional", async () => {
    const filas = [
      {
        almacen: "Industher",
        sku_caja: "P1-M1-NEGRO",
        modelo: "M1",
        talla: "CORRIDA",
      },
    ];
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });

    await expect(
      reemplazarExistencias(dbConRpc(rpc), "cuenta-1", ["Industher"], filas, false),
    ).resolves.toBe(1);

    expect(rpc).toHaveBeenCalledWith("reemplazar_existencias", {
      p_account_id: "cuenta-1",
      p_almacenes: ["Industher"],
      p_filas: filas,
      p_reemplazar_todo: false,
    });
  });

  it("propaga el error y no acepta una confirmación ambigua", async () => {
    const errorDb = dbConRpc(
      vi.fn().mockResolvedValue({ data: null, error: { message: "fila inválida" } }),
    );
    await expect(
      reemplazarExistencias(errorDb, "cuenta-1", ["A"], [{}], true),
    ).rejects.toThrow("existencias: fila inválida");

    const sinConteoDb = dbConRpc(vi.fn().mockResolvedValue({ data: null, error: null }));
    await expect(
      reemplazarExistencias(sinConteoDb, "cuenta-1", ["A"], [{}], true),
    ).rejects.toThrow("la base no confirmó");
  });
});