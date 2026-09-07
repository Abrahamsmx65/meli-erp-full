-- ============================================================================
--  YAPANIZCEL: el neto real de TODAS las órdenes, no solo de 150 por corrida.
--
--  El panel de ventas de fundas mostraba importe − comisión como "neto" en
--  el 99% de los renglones (agosto 2026: 102 de 21,625 con depósito real),
--  y ahí faltan el envío de Full y las retenciones de ISR/IVA: el neto
--  real observado es ~51% de la venta, no 86%.
--
--  Arreglo en dos partes:
--   1. Cada orden se REGISTRA en yz_ordenes_neto al momento de leerla (sus
--      pagos y sus renglones sku/importe), y un trabajo de fondo le pide su
--      neto a Mercado Pago orden por orden hasta terminar; cuando un día
--      queda completo, el neto se ASIENTA en yz_ventas_diarias sin volver a
--      leer MELI.
--   2. Mientras un renglón no tiene depósito real, se ESTIMA con el
--      porcentaje observado en las órdenes que ya lo tienen, y el panel lo
--      declara. Los RPC devuelven separado lo real de lo pendiente.
-- ============================================================================

alter table yz_ordenes_neto
  add column if not exists payment_ids jsonb,
  -- [{ sku, importe }] de la orden, para repartir el neto sin releer MELI
  add column if not exists renglones   jsonb,
  -- cuándo se leyó el neto real; null = todavía no (neto 0 = desconocido)
  add column if not exists neto_en     timestamptz;

create index if not exists yz_ordenes_neto_pendientes_idx
  on yz_ordenes_neto (account_id, fecha desc) where neto <= 0;

alter table yz_sync_estado
  -- hasta qué día (hacia atrás) ya se registraron las órdenes viejas
  add column if not exists ordenes_registradas_desde date;

drop function if exists yz_ventas_resumen(uuid, date, date);
create function yz_ventas_resumen(p_account uuid, p_desde date, p_hasta date)
returns table (
  sku text, unidades bigint, ordenes bigint, importe numeric, comision numeric,
  neto numeric, unidades_sin_neto bigint, importe_sin_neto numeric, comision_sin_neto numeric
)
language sql stable security definer set search_path = public as $$
  select v.sku,
    sum(v.unidades)::bigint,
    sum(v.ordenes)::bigint,
    sum(v.importe),
    sum(v.comision),
    coalesce(sum(v.neto) filter (where v.neto is not null), 0),
    coalesce(sum(v.unidades) filter (where v.neto is null), 0)::bigint,
    coalesce(sum(v.importe) filter (where v.neto is null), 0),
    coalesce(sum(v.comision) filter (where v.neto is null), 0)
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  group by v.sku;
$$;

drop function if exists yz_ventas_por_dia(uuid, date, date);
create function yz_ventas_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (fecha date, unidades bigint, importe numeric, neto numeric, importe_sin_neto numeric, comision_sin_neto numeric)
language sql stable security definer set search_path = public as $$
  select v.fecha, sum(v.unidades)::bigint, sum(v.importe),
    coalesce(sum(v.neto) filter (where v.neto is not null), 0),
    coalesce(sum(v.importe) filter (where v.neto is null), 0),
    coalesce(sum(v.comision) filter (where v.neto is null), 0)
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  group by v.fecha order by v.fecha;
$$;

-- Lo observado: cuánto deposita Mercado Pago de cada peso vendido, y cuántas
-- órdenes del rango siguen sin su neto real.
create or replace function yz_netos_observados(p_account uuid, p_desde date, p_hasta date)
returns table (ordenes_con_neto bigint, total numeric, neto numeric, ordenes_pendientes bigint)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (where o.neto > 0)::bigint,
    coalesce(sum(o.total) filter (where o.neto > 0), 0),
    coalesce(sum(o.neto) filter (where o.neto > 0), 0),
    count(*) filter (where o.neto <= 0 and o.total > 0)::bigint
  from yz_ordenes_neto o
  where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account));
$$;

revoke all on function yz_ventas_resumen(uuid, date, date) from public, anon;
revoke all on function yz_ventas_por_dia(uuid, date, date) from public, anon;
revoke all on function yz_netos_observados(uuid, date, date) from public, anon;
grant execute on function yz_ventas_resumen(uuid, date, date) to authenticated, service_role;
grant execute on function yz_ventas_por_dia(uuid, date, date) to authenticated, service_role;
grant execute on function yz_netos_observados(uuid, date, date) to authenticated, service_role;
