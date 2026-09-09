import { describe, expect, it } from "vitest";
import { crearGastoEmpresarial, importarGastoEmpresarial } from "./gastos-empresariales";

function baseFalsa() {
  const filas: any[] = [];
  let siguienteId = 1;

  return {
    filas,
    db: {
      from() {
        return {
          insert(fila: any) {
            const repetida = filas.find(
              (x) =>
                x.account_id === fila.account_id &&
                ((fila.clave_idempotencia && x.clave_idempotencia === fila.clave_idempotencia) ||
                  (fila.clave_importacion && x.clave_importacion === fila.clave_importacion)),
            );
            return {
              select() {
                return {
                  async single() {
                    if (repetida) return { data: null, error: { code: "23505", message: "duplicate key" } };
                    const guardada = { ...fila, id: siguienteId++ };
                    filas.push(guardada);
                    return { data: { id: guardada.id }, error: null };
                  },
                };
              },
            };
          },
          select() {
            const filtros: Record<string, unknown> = {};
            const consulta: any = {
              eq(campo: string, valor: unknown) {
                filtros[campo] = valor;
                return consulta;
              },
              async maybeSingle() {
                return {
                  data: filas.find((fila) => Object.entries(filtros).every(([campo, valor]) => fila[campo] === valor)) ?? null,
                  error: null,
                };
              },
            };
            return consulta;
          },
        };
      },
    } as any,
  };
}

describe("crearGastoEmpresarial", () => {
  it("devuelve el gasto original cuando se pierde la respuesta y se reintenta la misma petición", async () => {
    const { db, filas } = baseFalsa();
    const peticion = {
      fecha: "2026-09-01",
      concepto: "Nómina primera quincena",
      categoria: "Nómina",
      monto: 12500,
      claveIdempotencia: "01991fd8-7c42-7f87-9d83-dbd643a44e42",
    };

    const respuestaPerdida = await crearGastoEmpresarial(db, "cuenta-1", "usuario-1", peticion);
    const reintento = await crearGastoEmpresarial(db, "cuenta-1", "usuario-1", peticion);

    expect(respuestaPerdida).toEqual({ id: 1, fecha: "2026-09-01" });
    expect(reintento).toEqual(respuestaPerdida);
    expect(filas).toHaveLength(1);
  });
});

describe("importarGastoEmpresarial", () => {
  it("ignora ids internos del archivo y repite la misma fila sin duplicarla", async () => {
    const { db, filas } = baseFalsa();
    const fila = {
      id: 777,
      fecha: "2026-09-02",
      concepto: "Flete",
      categoria: "Logística",
      monto: 450,
      claveImportacion: "archivo-2026-09:fila-1",
    };

    const primera = await importarGastoEmpresarial(db, "cuenta-1", "usuario-1", fila);
    const repetida = await importarGastoEmpresarial(db, "cuenta-1", "usuario-1", fila);

    expect(primera).toEqual({ id: 1, fecha: "2026-09-02" });
    expect(repetida).toEqual(primera);
    expect(filas).toHaveLength(1);
    expect(filas[0]).not.toHaveProperty("id", fila.id);
  });

  it("no sobrescribe un gasto cuando la clave externa se reutiliza con otros datos", async () => {
    const { db, filas } = baseFalsa();
    const original = {
      id: 77,
      fecha: "2026-09-03",
      concepto: "Seguro",
      categoria: "Operación",
      monto: 300,
      claveImportacion: "proveedor:factura-42",
    };
    await importarGastoEmpresarial(db, "cuenta-1", "usuario-1", original);

    const conflicto = await importarGastoEmpresarial(db, "cuenta-1", "usuario-1", {
      ...original,
      id: 1,
      concepto: "Gasto que no debe reemplazarlo",
      monto: 999,
    });

    expect(conflicto).toEqual({ error: "La clave de importación ya pertenece a otro gasto." });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ concepto: "Seguro", monto: 300 });
  });

  it("permite la misma clave externa en cuentas diferentes", async () => {
    const { db, filas } = baseFalsa();
    const fila = {
      fecha: "2026-09-04",
      concepto: "Licencia",
      categoria: "Software",
      monto: 100,
      claveImportacion: "sistema:licencia-1",
    };

    await importarGastoEmpresarial(db, "cuenta-1", "usuario-1", fila);
    await importarGastoEmpresarial(db, "cuenta-2", "usuario-2", fila);

    expect(filas).toHaveLength(2);
  });
});