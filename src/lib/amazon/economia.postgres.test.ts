import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const postgresDisponible = Boolean(process.env.DATABASE_URL && process.env.PGHOST);
const schema = `amazon_economia_test_${randomUUID().replaceAll("-", "")}`;
const accountId = randomUUID();
const ejecutarPsql = promisify(execFile);
const rutaMigracion = new URL(
  "../../../supabase/migrations/0066_cobertura_economia_amazon.sql",
  import.meta.url,
);

if (process.env.RUN_POSTGRES_TESTS === "1" && !postgresDisponible) {
  throw new Error(
    "Las pruebas PostgreSQL requieren una conexión disponible: faltan DATABASE_URL o PGHOST.",
  );
}

describe.runIf(postgresDisponible)("cobertura de SKU Economics con PostgreSQL real", () => {
  async function consultar(sql: string) {
    const { stdout } = await ejecutarPsql(
      "psql",
      ["--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", sql],
      { encoding: "utf8" },
    );
    return stdout.trim();
  }

  function aislarFuncion(migracion: string, nombre: string, nombreAislado: string) {
    const inicio = `create or replace function ${nombre}(`;
    const posicionInicio = migracion.indexOf(inicio);
    const posicionFin = migracion.indexOf("\n$$;", posicionInicio);
    if (posicionInicio === -1 || posicionFin === -1) {
      throw new Error(`No se encontró ${nombre} en la migración de economía`);
    }
    return migracion
      .slice(posicionInicio, posicionFin + 4)
      .replace(nombre, `${schema}.${nombreAislado}`)
      .replace("set search_path = public", `set search_path = ${schema}`)
      .replace(
        /  if not es_mi_cuenta_amazon\(p_account\) then\n    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';\n  end if;\n/,
        "",
      );
  }

  beforeAll(async () => {
    const migracion = await readFile(rutaMigracion, "utf8");
    const cobertura = aislarFuncion(migracion, "amazon_economia_cobertura", "cobertura");
    const hueco = aislarFuncion(migracion, "amazon_economia_hueco", "hueco");
    const reemplazar = aislarFuncion(migracion, "reemplazar_amazon_economia", "reemplazar");
    await consultar(`
      create schema ${schema};
      create table ${schema}.amazon_ventas_diarias (
        account_id uuid not null,
        seller_sku text not null,
        fecha date not null,
        unidades numeric not null,
        importe numeric not null
      );
      create table ${schema}.amazon_economia (
        account_id uuid not null,
        seller_sku text not null,
        fecha date not null,
        unidades numeric not null,
        ventas numeric not null,
        tarifas numeric not null default 0,
        publicidad numeric not null default 0,
        neto numeric not null default 0,
        actualizado_en timestamptz not null default now(),
        primary key (account_id, seller_sku, fecha)
      );
      ${cobertura}
      ${hueco}
      ${reemplazar}
    `);
  });

  afterAll(async () => {
    if (postgresDisponible) await consultar(`drop schema if exists ${schema} cascade`);
  });

  async function reiniciar() {
    await consultar(`truncate ${schema}.amazon_ventas_diarias, ${schema}.amazon_economia`);
  }

  it("no deja que el exceso de un SKU oculte el faltante de otro", async () => {
    await reiniciar();
    await consultar(`
      insert into ${schema}.amazon_ventas_diarias values
        ('${accountId}', 'A', '2026-07-01', 1, 100),
        ('${accountId}', 'B', '2026-07-01', 1, 100);
      insert into ${schema}.amazon_economia values
        ('${accountId}', 'A', '2026-07-01', 2, 200, 0, 0, 200, now());
    `);
    const cobertura = JSON.parse(await consultar(
      `select row_to_json(c) from ${schema}.cobertura('${accountId}', '2026-07-01', '2026-07-01') c`,
    ));
    expect(Number(cobertura.cobertura_importe)).toBe(0.5);
    expect(Number(cobertura.cobertura_unidades)).toBe(0.5);
    expect(cobertura.dias_cubiertos).toBe(0);
  });

  it("mantiene parcial incluso un faltante menor al 2%", async () => {
    await reiniciar();
    await consultar(`
      insert into ${schema}.amazon_ventas_diarias values
        ('${accountId}', 'A', '2026-07-09', 100, 100);
      insert into ${schema}.amazon_economia values
        ('${accountId}', 'A', '2026-07-09', 99, 99, 0, 0, 99, now());
    `);
    const cobertura = JSON.parse(await consultar(
      `select row_to_json(c) from ${schema}.cobertura('${accountId}', '2026-07-09', '2026-07-09') c`,
    ));
    expect(Number(cobertura.cobertura_importe)).toBe(0.99);
    expect(Number(cobertura.cobertura_unidades)).toBe(0.99);
    expect(cobertura.dias_cubiertos).toBe(0);
    expect(await consultar(
      `select desde || '|' || hasta from ${schema}.hueco('${accountId}', null, '2026-07-09')`,
    )).toBe("2026-07-09|2026-07-09");
  });

  it("reemplaza la foto del intervalo y elimina renglones que Amazon retiró", async () => {
    await reiniciar();
    await consultar(`
      insert into ${schema}.amazon_economia values
        ('${accountId}', 'A', '2026-07-09', 1, 100, 10, 0, 90, now()),
        ('${accountId}', 'B', '2026-07-09', 1, 100, 10, 0, 90, now());
      select ${schema}.reemplazar(
        '${accountId}',
        '2026-07-09',
        '2026-07-09',
        '[{"seller_sku":"A","fecha":"2026-07-09","unidades":1,"ventas":120,"tarifas":12,"publicidad":0,"neto":108}]'
      );
    `);
    expect(await consultar(
      `select seller_sku || '|' || ventas from ${schema}.amazon_economia order by seller_sku`,
    )).toBe("A|120");
  });
});