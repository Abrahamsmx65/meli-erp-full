import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { camposLiquidacionMeli, leerPagoMercadoPago, resumirPagosMeli } from "../meli/pagos";
import { armarEstadoResultados } from "./corte-meli";

const postgresDisponible = Boolean(process.env.DATABASE_URL && process.env.PGHOST);
const schema = `corte_meli_test_${randomUUID().replaceAll("-", "")}`;
const ejecutarPsql = promisify(execFile);
const rutaMigracion = new URL(
  "../../../supabase/migrations/0066_desglose_cargos_mercado_pago.sql",
  import.meta.url,
);
const rutaReparacion = new URL(
  "../../../supabase/migrations/0069_repara_procedencia_reembolso_meli.sql",
  import.meta.url,
);

if (process.env.RUN_POSTGRES_TESTS === "1" && !postgresDisponible) {
  throw new Error(
    "Las pruebas PostgreSQL requieren una conexión disponible: faltan DATABASE_URL o PGHOST.",
  );
}

describe.runIf(postgresDisponible)("devoluciones de Mercado Pago con PostgreSQL real", () => {
  async function consultar(sql: string) {
    const { stdout } = await ejecutarPsql(
      "psql",
      ["--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", sql],
      { encoding: "utf8" },
    );
    return stdout.trim();
  }

  function aislarFuncion(migracion: string, nombre: string, aislado: string) {
    const inicioSimple = `create function ${nombre}(`;
    const inicioReemplazable = `create or replace function ${nombre}(`;
    const inicio = migracion.includes(inicioSimple) ? inicioSimple : inicioReemplazable;
    const posicionInicio = migracion.indexOf(inicio);
    const posicionFin = migracion.indexOf("\n$$;", posicionInicio);
    if (posicionInicio === -1 || posicionFin === -1) {
      throw new Error(`No se encontró ${nombre} en la migración`);
    }
    return migracion
      .slice(posicionInicio, posicionFin + 4)
      .replace(inicio, `create or replace function ${schema}.${aislado}(`)
      .replaceAll("from ordenes_neto o", `from ${schema}.ordenes_neto o`)
      .replaceAll("from yz_ordenes_neto o", `from ${schema}.yz_ordenes_neto o`)
      .replaceAll("from ventas_diarias v", `from ${schema}.ventas_diarias v`)
      .replaceAll("from yz_ventas_diarias v", `from ${schema}.yz_ventas_diarias v`)
      .replaceAll("left join skus s", `left join ${schema}.skus s`)
      .replaceAll("left join yz_skus s", `left join ${schema}.yz_skus s`)
      .replaceAll("left join productos_config pc", `left join ${schema}.productos_config pc`)
      .replaceAll("left join yz_costos yc", `left join ${schema}.yz_costos yc`)
      .replaceAll("from meli_accounts", `from ${schema}.meli_accounts`)
      .replace(
        /\n\s+and \(auth\.role\(\) = 'service_role' or es_mi_cuenta(?:_yz)?\(p_account\)\)/,
        "",
      );
  }

  beforeAll(async () => {
    await consultar("select 1");
    const migracion = await readFile(rutaMigracion, "utf8");
    const calzado = aislarFuncion(migracion, "cortes_ordenes_por_dia", "calzado");
    const yapanizcel = aislarFuncion(migracion, "yz_cortes_ordenes_por_dia", "yapanizcel");
    const monitorCalzado = aislarFuncion(migracion, "ventas_resumen_sku", "monitor_calzado");
    const monitorYz = aislarFuncion(migracion, "yz_ventas_resumen", "monitor_yz");
    const monitorYzDia = aislarFuncion(migracion, "yz_ventas_por_dia", "monitor_yz_dia");
    const ventasYz = aislarFuncion(migracion, "yz_cortes_ventas_desde_ordenes", "ventas_yz");
    const ventasYzConfirmadas = aislarFuncion(
      migracion,
      "yz_cortes_ventas_desde_ordenes_confirmadas",
      "ventas_yz_confirmadas",
    );
    const renglonesYzConfirmados = aislarFuncion(
      migracion,
      "yz_ventas_renglones_confirmados",
      "renglones_yz_confirmados",
    );
    await consultar(`
      create schema ${schema};
      create table ${schema}.ordenes_neto (
        account_id uuid, order_id bigint, fecha date, estado text, estado_pago text,
        total numeric, revisiones integer, renglones jsonb, neto numeric,
        neto_actual numeric, reembolsado numeric, comision_mp numeric, envio_mp numeric,
        isr_mp numeric, iva_mp numeric, otros_mp numeric, cargos_sin_desglosar numeric,
        cargos_leidos_en timestamptz, neto_en timestamptz, tipo_venta text,
        reembolso_incluido_neto_base numeric, reembolso_base_confiable boolean
      );
      create table ${schema}.yz_ordenes_neto (like ${schema}.ordenes_neto including all);
      create table ${schema}.skus (account_id uuid, sku text, modelo text);
      create table ${schema}.productos_config (account_id uuid, color text, modelo text, costo_mxn numeric);
      create table ${schema}.meli_accounts (id uuid, creado_en timestamptz);
      create table ${schema}.yz_skus (account_id uuid, sku text, diseno text);
      create table ${schema}.yz_costos (account_id uuid, modelo text, costo numeric);
      create table ${schema}.ventas_diarias (
        account_id uuid, sku text, fecha date, unidades integer, ordenes integer,
        importe numeric, comision numeric, neto numeric,
        neto_confirmado boolean not null default false
      );
      create table ${schema}.yz_ventas_diarias (like ${schema}.ventas_diarias including all);
      ${calzado}
      ${yapanizcel}
      ${monitorCalzado}
      ${monitorYz}
      ${monitorYzDia}
      ${ventasYz}
      ${ventasYzConfirmadas}
      ${renglonesYzConfirmados}
    `);
  });

  afterAll(async () => {
    await consultar(`drop schema if exists ${schema} cascade`);
  });

  async function verificarCanal(tipo: "calzado" | "yapanizcel") {
    const cuenta = randomUUID();
    const sku = tipo === "calzado" ? "A1-ROJO-25" : "F1-NEGRO";
    const tabla = tipo === "calzado" ? "ordenes_neto" : "yz_ordenes_neto";
    if (tipo === "calzado") {
      await consultar(`
        insert into ${schema}.skus values ('${cuenta}', '${sku}', 'A1');
        insert into ${schema}.productos_config values ('${cuenta}', '', 'A1', 60);
      `);
    } else {
      await consultar(`
        insert into ${schema}.yz_skus values ('${cuenta}', '${sku}', 'F1');
        insert into ${schema}.yz_costos values ('${cuenta}', 'F1', 60);
      `);
    }
    const renglones = JSON.stringify([{ sku, unidades: 1 }]).replaceAll("'", "''");
    await consultar(`
      insert into ${schema}.${tabla}
        (account_id, order_id, fecha, estado, estado_pago, total, revisiones, renglones, neto, neto_actual, reembolsado,
         reembolso_incluido_neto_base, reembolso_base_confiable)
      values
        ('${cuenta}', 1, '2026-08-01', 'paid', 'approved', 200, 2, '${renglones}'::jsonb, 120, 70, 50, 0, true),
        ('${cuenta}', 2, '2026-08-02', 'paid', 'refunded', 200, 2, '${renglones}'::jsonb, 120, 120, 200, 0, true);
    `);

    const parcial = JSON.parse(await consultar(
      `select to_jsonb(x) from ${schema}.${tipo}('${cuenta}', '2026-08-01', '2026-08-01') x`,
    ));
    expect(parcial).toMatchObject({
      dev_ordenes: 1,
      dev_monto: 0,
      dev_en_neto: 50,
      dev_costo: 0,
      dev_unidades: 0,
      dev_sin_renglones_monto: 50,
    });

    const antes = JSON.parse(await consultar(
      `select to_jsonb(x) from ${schema}.${tipo}('${cuenta}', '2026-08-02', '2026-08-02') x`,
    ));
    await consultar(`update ${schema}.${tabla} set neto_actual = 0 where account_id = '${cuenta}' and order_id = 2`);
    const despues = JSON.parse(await consultar(
      `select to_jsonb(x) from ${schema}.${tipo}('${cuenta}', '2026-08-02', '2026-08-02') x`,
    ));
    expect(antes).toMatchObject({ dev_costo: 60, dev_unidades: 1, dev_monto: 200, dev_en_neto: 0 });
    expect(despues).toMatchObject({ dev_costo: 60, dev_unidades: 1, dev_monto: 80, dev_en_neto: 120 });
  }

  it("mantiene el costo recuperado de calzado y estima devoluciones parciales", async () => {
    await verificarCanal("calzado");
  });

  it("mantiene el costo recuperado de fundas y estima devoluciones parciales", async () => {
    await verificarCanal("yapanizcel");
  });

  it("distingue saldos cero y negativos confirmados de los centinelas históricos", async () => {
    const cuenta = randomUUID();
    for (const tabla of ["ventas_diarias", "yz_ventas_diarias"]) {
      await consultar(`
        insert into ${schema}.${tabla}
          (account_id, sku, fecha, unidades, ordenes, importe, comision, neto, neto_confirmado)
        values
          ('${cuenta}', 'PENDIENTE', '2026-08-01', 1, 1, 200, 30, 0, false),
          ('${cuenta}', 'CERO',      '2026-08-01', 1, 1, 200, 30, 0, true),
          ('${cuenta}', 'NEGATIVO',  '2026-08-01', 1, 1, 200, 30, -15, true);
      `);
    }

    const calzado = JSON.parse(await consultar(`
      select jsonb_object_agg(sku, to_jsonb(x) - 'sku')
      from ${schema}.monitor_calzado(
        '${cuenta}', '2026-08-01', '2026-08-01',
        '2026-07-25', '2026-07-31', '2026-08-01'
      ) x
    `));
    expect(calzado.PENDIENTE).toMatchObject({ neto_resuelto: 170, importe_neto_real: 0 });
    expect(calzado.CERO).toMatchObject({ neto_resuelto: 0, importe_neto_real: 200, neto_real: 0 });
    expect(calzado.NEGATIVO).toMatchObject({ neto_resuelto: -15, importe_neto_real: 200, neto_real: -15 });

    const yz = JSON.parse(await consultar(`
      select jsonb_object_agg(sku, to_jsonb(x) - 'sku')
      from ${schema}.monitor_yz('${cuenta}', '2026-08-01', '2026-08-01') x
    `));
    expect(yz.PENDIENTE).toMatchObject({ neto: 0, importe_sin_neto: 200 });
    expect(yz.CERO).toMatchObject({ neto: 0, importe_sin_neto: 0 });
    expect(yz.NEGATIVO).toMatchObject({ neto: -15, importe_sin_neto: 0 });

    const yzDia = JSON.parse(await consultar(`
      select to_jsonb(x)
      from ${schema}.monitor_yz_dia('${cuenta}', '2026-08-01', '2026-08-01') x
    `));
    expect(yzDia).toMatchObject({ neto: -15, importe_sin_neto: 200 });

    const renglonesConfirmados = JSON.parse(await consultar(`
      select jsonb_object_agg(sku, to_jsonb(x) - 'sku')
      from ${schema}.renglones_yz_confirmados('${cuenta}', '2026-08-01', '2026-08-01') x
    `));
    expect(renglonesConfirmados.PENDIENTE).toMatchObject({ neto: 0, neto_confirmado: false });
    expect(renglonesConfirmados.CERO).toMatchObject({ neto: 0, neto_confirmado: true });
    expect(renglonesConfirmados.NEGATIVO).toMatchObject({ neto: -15, neto_confirmado: true });

    const renglones = JSON.stringify([
      { sku: "NEGATIVO", unidades: 1, importe: 200, comision: 30 },
    ]).replaceAll("'", "''");
    const renglonesPendientes = JSON.stringify([
      { sku: "PENDIENTE", unidades: 1, importe: 200, comision: 30 },
    ]).replaceAll("'", "''");
    await consultar(`
      insert into ${schema}.yz_ordenes_neto
        (account_id, order_id, fecha, estado, total, renglones, neto, neto_actual, neto_en)
      values
        ('${cuenta}', 99, '2026-08-01', 'paid', 200, '${renglones}'::jsonb, 170, -15, now());
    `);
    const ventaYz = JSON.parse(await consultar(`
      select to_jsonb(x)
      from ${schema}.ventas_yz('${cuenta}', '2026-08-01', '2026-08-01') x
      where x.sku = 'NEGATIVO'
    `));
    expect(ventaYz).toMatchObject({ sku: "NEGATIVO", neto: -15 });

    await consultar(`
      insert into ${schema}.yz_ordenes_neto
        (account_id, order_id, fecha, estado, total, renglones, neto, neto_actual, neto_en)
      values
        ('${cuenta}', 100, '2026-08-01', 'paid', 200, '${renglonesPendientes}'::jsonb, 0, null, null);
    `);
    const ventasConfirmadas = JSON.parse(await consultar(`
      select jsonb_object_agg(sku, to_jsonb(x) - 'sku')
      from ${schema}.ventas_yz_confirmadas('${cuenta}', '2026-08-01', '2026-08-01') x
    `));
    expect(ventasConfirmadas.NEGATIVO).toMatchObject({ neto: -15, neto_confirmado: true });
    expect(ventasConfirmadas.PENDIENTE).toMatchObject({ neto: 0, neto_confirmado: false });
  });

  it("no descuenta dos veces reembolsos presentes en la primera lectura de ambos canales", async () => {
    for (const tipo of ["calzado", "yapanizcel"] as const) {
      const cuenta = randomUUID();
      const tabla = tipo === "calzado" ? "ordenes_neto" : "yz_ordenes_neto";
      const renglones = JSON.stringify([
        { sku: tipo === "calzado" ? "A1-ROJO-25" : "F1-NEGRO", unidades: 1, importe: 100, comision: 0 },
      ]).replaceAll("'", "''");
      await consultar(`
        insert into ${schema}.${tabla}
          (account_id, order_id, fecha, estado, estado_pago, total, revisiones, renglones,
           neto, neto_actual, neto_en, reembolsado, reembolso_incluido_neto_base,
           reembolso_base_confiable, cargos_sin_desglosar, cargos_leidos_en)
        values
          ('${cuenta}', 10, '2026-08-03', 'paid', 'refunded', 100, 2, '${renglones}'::jsonb,
           0, null, now(), 100, 100, true, 0, now()),
          ('${cuenta}', 11, '2026-08-04', 'paid', 'refunded', 100, 2, '${renglones}'::jsonb,
           30, null, now(), 50, 50, true, 0, now());
      `);

      const total = JSON.parse(await consultar(
        `select to_jsonb(x) from ${schema}.${tipo}('${cuenta}', '2026-08-03', '2026-08-03') x`,
      ));
      const parcial = JSON.parse(await consultar(
        `select to_jsonb(x) from ${schema}.${tipo}('${cuenta}', '2026-08-04', '2026-08-04') x`,
      ));
      expect(total).toMatchObject({
        neto: 0,
        dev_monto: 0,
        dev_en_neto: 100,
        cargos_sin_desglosar: 0,
        ajuste_liquidacion: 0,
        reembolsos_base_pendientes: 0,
      });
      expect(parcial).toMatchObject({
        neto: 30,
        dev_monto: 0,
        dev_en_neto: 50,
        cargos_sin_desglosar: 0,
        ajuste_liquidacion: 0,
        reembolsos_base_pendientes: 0,
      });
    }
  });

  it("migra una orden YZ sin leer y concilia su primera liquidación ya reembolsada", async () => {
    const cuenta = randomUUID();
    const sku = "LEGACY-NEGRO";
    const renglones = JSON.stringify([{ sku, unidades: 1, importe: 100, comision: 10 }]).replaceAll("'", "''");
    await consultar(`
      insert into ${schema}.yz_ordenes_neto
        (account_id, order_id, fecha, estado, total, revisiones, renglones, neto, neto_en, reembolsado)
      values
        ('${cuenta}', 99, '2026-08-05', 'paid', 100, 2, '${renglones}'::jsonb, 0, null, 0);
    `);

    const migracion = await readFile(rutaMigracion, "utf8");
    const inicio = migracion.indexOf("-- Solo una orden que ya tenía");
    const fin = migracion.indexOf("\nalter table public.ordenes_neto\n  drop constraint", inicio);
    expect(inicio).toBeGreaterThanOrEqual(0);
    expect(fin).toBeGreaterThan(inicio);
    const backfill = migracion
      .slice(inicio, fin)
      .replaceAll("public.ordenes_neto", `${schema}.ordenes_neto`)
      .replaceAll("public.yz_ordenes_neto", `${schema}.yz_ordenes_neto`);
    const reparacion = (await readFile(rutaReparacion, "utf8"))
      .replaceAll("public.ordenes_neto", `${schema}.ordenes_neto`)
      .replaceAll("public.yz_ordenes_neto", `${schema}.yz_ordenes_neto`);
    await consultar(`${backfill}\n${reparacion}`);

    const legado = JSON.parse(await consultar(`
      select json_build_object(
        'neto', neto,
        'neto_en', neto_en,
        'base', reembolso_incluido_neto_base,
        'confiable', reembolso_base_confiable
      )
      from ${schema}.yz_ordenes_neto
      where account_id = '${cuenta}' and order_id = 99
    `));
    expect(legado).toMatchObject({ neto: 0, neto_en: null, base: null, confiable: null });

    const resumen = resumirPagosMeli(
      [leerPagoMercadoPago({
        status: "refunded",
        transaction_amount: 100,
        net_received_amount: -10,
        transaction_amount_refunded: 100,
        fee_details: [{ type: "marketplace_fee", amount: 10 }],
      })],
      100,
      10,
      legado.neto_en == null ? undefined : Number(legado.neto),
      legado.base,
      legado.confiable,
    );
    const campos = camposLiquidacionMeli(resumen);
    expect(campos).toMatchObject({
      reembolsado: 100,
      reembolso_incluido_neto_base: 100,
      reembolso_base_confiable: true,
      cargos_sin_desglosar: 0,
    });

    await consultar(`
      update ${schema}.yz_ordenes_neto set
        neto = ${resumen.neto},
        neto_actual = null,
        neto_en = now(),
        estado_pago = '${resumen.estadoPago}',
        reembolsado = ${resumen.reembolsado},
        reembolso_incluido_neto_base = ${resumen.reembolsoIncluidoNetoBase},
        reembolso_base_confiable = ${resumen.reembolsoBaseConfiable},
        comision_mp = ${resumen.comision},
        envio_mp = ${resumen.envio},
        isr_mp = ${resumen.isr},
        iva_mp = ${resumen.iva},
        otros_mp = ${resumen.otros},
        cargos_sin_desglosar = ${resumen.cargosSinDesglosar},
        cargos_leidos_en = now()
      where account_id = '${cuenta}' and order_id = 99;
    `);
    const sql = JSON.parse(await consultar(
      `select to_jsonb(x) from ${schema}.yapanizcel('${cuenta}', '2026-08-05', '2026-08-05') x`,
    ));
    expect(sql).toMatchObject({
      neto: -10,
      dev_monto: 0,
      dev_en_neto: 100,
      cargos_sin_desglosar: 0,
      ajuste_liquidacion: 0,
      reembolsos_base_pendientes: 0,
    });

    const corte = armarEstadoResultados({
      periodo: "2026-08",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      cuenta: "YAPANIZCEL",
      generadoEn: "2026-09-09T12:00:00.000Z",
      ventas: [{ sku, fecha: "2026-08-05", unidades: 1, ordenes: 1, importe: 100, comision: 10, neto: -10 }],
      ordenes: [{
        orderId: 99, fecha: "2026-08-05", total: 100, neto: -10, netoActual: null,
        netoLeido: true, reembolsado: 100, reembolsoIncluidoNetoBase: 100,
        reembolsoBaseConfiable: true, estado: "paid", estadoPago: "refunded",
        revisiones: 2, comisionMp: 10, cargosSinDesglosar: 0, cargosLeidos: true,
        renglones: [{ sku, unidades: 1, importe: 100 }],
      }],
      modeloDeSku: new Map([[sku, "LEGACY"]]),
      config: new Map([["LEGACY", { categoria: "Fundas", costo: 0 }]]),
      adsPorModelo: new Map(),
      adsSinAmarre: 0,
      errorAds: null,
      gastos: [],
      cargos: [],
      cargosLeidos: true,
    });
    expect(corte.netoDepositado).toBe(-10);
    expect(corte.devoluciones).toMatchObject({ monto: 0, incluidoEnNeto: 100 });
    expect(corte.cargosSinDesglosar).toBe(0);
    expect(corte.ajusteLiquidacion).toBe(0);
    expect(corte.utilidadNeta).toBe(-10);
    expect(corte.revision.exacto).toBe(true);
  });
});