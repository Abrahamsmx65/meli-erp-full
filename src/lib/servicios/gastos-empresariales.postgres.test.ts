import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const postgresDisponible = Boolean(process.env.DATABASE_URL && process.env.PGHOST);
const schema = `gastos_rls_test_${randomUUID().replaceAll("-", "")}`;
const rol = `gastos_rls_${randomUUID().replaceAll("-", "")}`;
const ejecutarPsql = promisify(execFile);
const rutaMigracion = new URL(
  "../../../supabase/migrations/0066_gastos_empresariales.sql",
  import.meta.url,
);
const rutaMigracionImportacion = new URL(
  "../../../supabase/migrations/0068_gastos_empresariales_importacion.sql",
  import.meta.url,
);

if (process.env.RUN_POSTGRES_TESTS === "1" && !postgresDisponible) {
  throw new Error(
    "Las pruebas PostgreSQL requieren una conexión disponible: faltan DATABASE_URL o PGHOST.",
  );
}

describe.runIf(postgresDisponible)("aislamiento RLS de gastos empresariales", () => {
  const usuarioA = randomUUID();
  const usuarioB = randomUUID();
  const cuentaA = randomUUID();
  const cuentaB = randomUUID();

  async function consultar(sql: string) {
    const { stdout } = await ejecutarPsql(
      "psql",
      [
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--quiet",
        "--set",
        "ON_ERROR_STOP=1",
        "--command",
        sql,
      ],
      { encoding: "utf8" },
    );
    return stdout.trim();
  }

  async function comoUsuario(usuario: string, sql: string) {
    return consultar(`
      begin;
      set local role ${rol};
      set local "request.jwt.claim.sub" = '${usuario}';
      ${sql}
      rollback;
    `);
  }

  async function fallaComoUsuario(usuario: string, sql: string) {
    try {
      await comoUsuario(usuario, sql);
      return "";
    } catch (error) {
      return (error as { stderr?: string }).stderr ?? String(error);
    }
  }

  beforeAll(async () => {
    try {
      await consultar("select 1");
    } catch (error) {
      throw new Error(
        "Las pruebas PostgreSQL requieren una conexión disponible y psql no pudo conectarse.",
        { cause: error },
      );
    }

    const [migracion, migracionImportacion] = await Promise.all([
      readFile(rutaMigracion, "utf8"),
      readFile(rutaMigracionImportacion, "utf8"),
    ]);
    const politica = migracion.match(
      /create policy gastos_empresariales_mios[\s\S]*?with check \(es_mi_cuenta\(account_id\)\);/,
    )?.[0];
    if (!politica) {
      throw new Error("No se encontró la política RLS de gastos empresariales");
    }

    await consultar(`
      create role ${rol} nologin;
      create schema ${schema};
      create table ${schema}.cuentas (
        id uuid primary key,
        owner_id uuid not null
      );
      create table ${schema}.gastos_empresariales (
        id bigserial primary key,
        account_id uuid not null references ${schema}.cuentas(id),
        fecha date not null,
        concepto text not null,
        categoria text not null,
        monto numeric(14,2) not null
      );
      ${migracionImportacion.replaceAll(
        "public.gastos_empresariales",
        `${schema}.gastos_empresariales`,
      )}
      create function ${schema}.es_mi_cuenta(a uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = ${schema}
      as $$
        select exists (
          select 1 from cuentas
          where id = a
            and owner_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        )
      $$;

      insert into ${schema}.cuentas (id, owner_id)
      values
        ('${cuentaA}'::uuid, '${usuarioA}'::uuid),
        ('${cuentaB}'::uuid, '${usuarioB}'::uuid);
      insert into ${schema}.gastos_empresariales
        (account_id, fecha, concepto, categoria, monto)
      values
        ('${cuentaA}'::uuid, date '2026-09-01', 'Gasto A', 'Operación', 100),
        ('${cuentaB}'::uuid, date '2026-09-02', 'Gasto B', 'Operación', 200);

      alter table ${schema}.gastos_empresariales enable row level security;
      ${politica
        .replace(
          "create policy gastos_empresariales_mios on public.gastos_empresariales",
          `create policy gastos_empresariales_mios on ${schema}.gastos_empresariales`,
        )
        .replaceAll("es_mi_cuenta", `${schema}.es_mi_cuenta`)}
      grant usage on schema ${schema} to ${rol};
      grant select, insert, update, delete on ${schema}.gastos_empresariales to ${rol};
      grant usage, select on sequence ${schema}.gastos_empresariales_id_seq to ${rol};
      grant execute on function ${schema}.es_mi_cuenta(uuid) to ${rol};
    `);
  });

  afterAll(async () => {
    await consultar(`
      drop schema if exists ${schema} cascade;
      drop role if exists ${rol};
    `);
  });

  it("solo permite listar, editar y eliminar gastos de la cuenta propia", async () => {
    const listadoA = JSON.parse(
      await comoUsuario(
        usuarioA,
        `select json_agg(concepto order by concepto) from ${schema}.gastos_empresariales;`,
      ),
    );
    const listadoB = JSON.parse(
      await comoUsuario(
        usuarioB,
        `select json_agg(concepto order by concepto) from ${schema}.gastos_empresariales;`,
      ),
    );

    expect(listadoA).toEqual(["Gasto A"]);
    expect(listadoB).toEqual(["Gasto B"]);

    const cambiosPropios = await comoUsuario(
      usuarioA,
      `update ${schema}.gastos_empresariales
       set concepto = 'Gasto A editado'
       where account_id = '${cuentaA}'::uuid
       returning concepto;`,
    );
    const edicionCruzada = await comoUsuario(
      usuarioA,
      `update ${schema}.gastos_empresariales
       set concepto = 'Gasto B alterado'
       where account_id = '${cuentaB}'::uuid
       returning concepto;`,
    );
    const borradoCruzado = await comoUsuario(
      usuarioA,
      `delete from ${schema}.gastos_empresariales
       where account_id = '${cuentaB}'::uuid
       returning concepto;`,
    );

    expect(cambiosPropios).toBe("Gasto A editado");
    expect(edicionCruzada).toBe("");
    expect(borradoCruzado).toBe("");

    const borradoPropio = await comoUsuario(
      usuarioA,
      `delete from ${schema}.gastos_empresariales
       where account_id = '${cuentaA}'::uuid
       returning concepto;`,
    );
    const reasignacionCruzada = await fallaComoUsuario(
      usuarioA,
      `update ${schema}.gastos_empresariales
       set account_id = '${cuentaB}'::uuid
       where account_id = '${cuentaA}'::uuid;`,
    );

    expect(borradoPropio).toBe("Gasto A");
    expect(reasignacionCruzada).toContain(
      "violates row-level security policy for table \"gastos_empresariales\"",
    );

    const estadoFinal = JSON.parse(
      await consultar(`
        select json_object_agg(account_id, concepto)
        from ${schema}.gastos_empresariales
      `),
    );
    expect(estadoFinal).toEqual({
      [cuentaA]: "Gasto A",
      [cuentaB]: "Gasto B",
    });
  });

  it("permite crear gastos propios y rechaza altas directas en otra cuenta", async () => {
    const altaPropia = await comoUsuario(
      usuarioA,
      `insert into ${schema}.gastos_empresariales
         (account_id, fecha, concepto, categoria, monto)
       values
         ('${cuentaA}'::uuid, date '2026-09-03', 'Gasto A nuevo', 'Operación', 300)
       returning concepto;`,
    );
    const altaCruzada = await fallaComoUsuario(
      usuarioA,
      `insert into ${schema}.gastos_empresariales
         (account_id, fecha, concepto, categoria, monto)
       values
         ('${cuentaB}'::uuid, date '2026-09-04', 'Gasto B intruso', 'Operación', 400);`,
    );

    expect(altaPropia).toBe("Gasto A nuevo");
    expect(altaCruzada).toContain(
      "violates row-level security policy for table \"gastos_empresariales\"",
    );

    const datosCuentaAjena = JSON.parse(
      await consultar(`
        select json_agg(
          json_build_object(
            'fecha', fecha,
            'concepto', concepto,
            'categoria', categoria,
            'monto', monto
          )
          order by id
        )
        from ${schema}.gastos_empresariales
        where account_id = '${cuentaB}'::uuid
      `),
    );
    expect(datosCuentaAjena).toEqual([
      {
        fecha: "2026-09-02",
        concepto: "Gasto B",
        categoria: "Operación",
        monto: 200,
      },
    ]);
  });

  it("rechaza atómicamente un lote que mezcla cuentas propias y ajenas", async () => {
    const altaMixta = await fallaComoUsuario(
      usuarioA,
      `insert into ${schema}.gastos_empresariales
         (account_id, fecha, concepto, categoria, monto)
       values
         ('${cuentaA}'::uuid, date '2026-09-05', 'Gasto propio del lote', 'Operación', 500),
         ('${cuentaB}'::uuid, date '2026-09-06', 'Gasto ajeno del lote', 'Operación', 600);`,
    );

    expect(altaMixta).toContain(
      "violates row-level security policy for table \"gastos_empresariales\"",
    );

    const estadoFinal = JSON.parse(
      await consultar(`
        select json_agg(
          json_build_object(
            'account_id', account_id,
            'fecha', fecha,
            'concepto', concepto,
            'categoria', categoria,
            'monto', monto
          )
          order by id
        )
        from ${schema}.gastos_empresariales
      `),
    );
    expect(estadoFinal).toEqual([
      {
        account_id: cuentaA,
        fecha: "2026-09-01",
        concepto: "Gasto A",
        categoria: "Operación",
        monto: 100,
      },
      {
        account_id: cuentaB,
        fecha: "2026-09-02",
        concepto: "Gasto B",
        categoria: "Operación",
        monto: 200,
      },
    ]);
  });

  it("repetir la misma importación es idempotente y no acepta ids internos", async () => {
    const resultado = JSON.parse(
      await comoUsuario(
      usuarioA,
      `insert into ${schema}.gastos_empresariales
         (account_id, clave_importacion, fecha, concepto, categoria, monto)
       values
         ('${cuentaA}'::uuid, 'archivo-septiembre:fila-1', date '2026-09-07',
          'Gasto importado', 'Importación', 700)
       on conflict (account_id, clave_importacion)
         where clave_importacion is not null do nothing;
       insert into ${schema}.gastos_empresariales
         (account_id, clave_importacion, fecha, concepto, categoria, monto)
       values
         ('${cuentaA}'::uuid, 'archivo-septiembre:fila-1', date '2026-09-07',
          'Gasto importado', 'Importación', 700)
       on conflict (account_id, clave_importacion)
         where clave_importacion is not null do nothing;
       select json_build_object(
         'cantidad', count(*),
         'id', min(id),
         'clave', min(clave_importacion),
         'concepto', min(concepto)
       )
       from ${schema}.gastos_empresariales
       where clave_importacion = 'archivo-septiembre:fila-1';`,
      ),
    );

    expect(resultado).toMatchObject({
      cantidad: 1,
      clave: "archivo-septiembre:fila-1",
      concepto: "Gasto importado",
    });
    expect(resultado.id).not.toBe(1);
  });

  it("una clave reutilizada no sobrescribe el gasto existente y queda limitada a su cuenta", async () => {
    const gastoConClaveReutilizada = JSON.parse(
      await comoUsuario(
        usuarioA,
        `insert into ${schema}.gastos_empresariales
         (account_id, clave_importacion, fecha, concepto, categoria, monto)
       values
         ('${cuentaA}'::uuid, 'proveedor:factura-42', date '2026-09-08',
          'Factura original', 'Importación', 800)
       on conflict (account_id, clave_importacion)
         where clave_importacion is not null do nothing;
       insert into ${schema}.gastos_empresariales
         (account_id, clave_importacion, fecha, concepto, categoria, monto)
       values
         ('${cuentaA}'::uuid, 'proveedor:factura-42', date '2026-09-09',
          'No debe sobrescribir', 'Importación', 999)
       on conflict (account_id, clave_importacion)
         where clave_importacion is not null do nothing;
       select json_build_object('concepto', concepto, 'monto', monto)
       from ${schema}.gastos_empresariales
       where account_id = '${cuentaA}'::uuid
         and clave_importacion = 'proveedor:factura-42';`,
      ),
    );
    const mismaClaveOtraCuenta = await comoUsuario(
      usuarioB,
      `insert into ${schema}.gastos_empresariales
         (account_id, clave_importacion, fecha, concepto, categoria, monto)
       values
         ('${cuentaB}'::uuid, 'proveedor:factura-42', date '2026-09-09',
          'Factura de otra cuenta', 'Importación', 900)
       on conflict (account_id, clave_importacion)
         where clave_importacion is not null do nothing
       returning concepto;`,
    );

    expect(gastoConClaveReutilizada).toEqual({
      concepto: "Factura original",
      monto: 800,
    });
    expect(mismaClaveOtraCuenta).toBe("Factura de otra cuenta");
  });
});