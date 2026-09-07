-- ============================================================================
--  Órdenes depositadas COMPLETAS (neto = total): desde el 27 de agosto de
--  2026 Mercado Pago dejó de descontar comisión y envío en el pago de una
--  parte creciente de las órdenes de calzado (el 2 de septiembre ya eran la
--  mitad); MELI las cobra aparte, por facturación. Sin esto, el corte las
--  tomaba como si no costaran nada. Se cuentan por día para que el corte
--  las estime con lo observado en las órdenes normales, y se guarda el
--  ratio observado. Las funciones cambian de forma: se recrean.
-- ============================================================================

drop function if exists cortes_ordenes_por_dia(uuid, date, date);
create function cortes_ordenes_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (
  fecha date, ordenes bigint, neto numeric, cancel_ordenes bigint, cancel_importe numeric,
  dev_ordenes bigint, dev_monto numeric, total bigint, revisadas bigint, pendientes bigint, sin_renglones bigint,
  sin_desc_ordenes bigint, sin_desc_total numeric
)
language sql stable security definer set search_path = public as $$
  with o as (
    select o.fecha, o.estado, o.estado_pago, o.total, o.revisiones,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      greatest(0, o.reembolsado - greatest(0, o.neto - coalesce(o.neto_actual, o.neto))) as devolucion
    from ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and (auth.role() = 'service_role' or es_mi_cuenta(p_account))
  )
  select o.fecha,
    count(*) filter (where o.estado is distinct from 'cancelled')::bigint,
    coalesce(sum(o.neto_hoy) filter (where o.estado is distinct from 'cancelled'), 0),
    count(*) filter (where o.estado = 'cancelled')::bigint,
    coalesce(sum(o.total) filter (where o.estado = 'cancelled'), 0),
    count(*) filter (where o.estado is distinct from 'cancelled' and (o.devolucion > 0 or o.estado_pago in ('refunded', 'charged_back')))::bigint,
    coalesce(sum(o.devolucion) filter (where o.estado is distinct from 'cancelled'), 0),
    count(*)::bigint,
    count(*) filter (where o.revisiones >= 1)::bigint,
    count(*) filter (where o.revisiones < 2)::bigint,
    0::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.total > 0 and o.neto_hoy >= o.total * 0.99)::bigint,
    coalesce(sum(o.total) filter (where o.estado is distinct from 'cancelled' and o.total > 0 and o.neto_hoy >= o.total * 0.99), 0)
  from o group by o.fecha order by o.fecha;
$$;

drop function if exists yz_cortes_ordenes_por_dia(uuid, date, date);
create function yz_cortes_ordenes_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (
  fecha date, ordenes bigint, neto numeric, cancel_ordenes bigint, cancel_importe numeric,
  dev_ordenes bigint, dev_monto numeric, total bigint, revisadas bigint, pendientes bigint, sin_renglones bigint,
  sin_desc_ordenes bigint, sin_desc_total numeric
)
language sql stable security definer set search_path = public as $$
  with o as (
    select o.fecha, o.estado, o.estado_pago, o.total, o.revisiones, o.renglones,
      case when o.neto_actual is not null and o.neto_actual > 0 then o.neto_actual else o.neto end as neto_hoy,
      greatest(0, o.reembolsado - greatest(0, o.neto - (case when o.neto_actual is not null and o.neto_actual > 0 then o.neto_actual else o.neto end))) as devolucion
    from yz_ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  )
  select o.fecha,
    count(*) filter (where o.estado is distinct from 'cancelled')::bigint,
    coalesce(sum(o.neto_hoy) filter (where o.estado is distinct from 'cancelled'), 0),
    count(*) filter (where o.estado = 'cancelled')::bigint,
    coalesce(sum(o.total) filter (where o.estado = 'cancelled'), 0),
    count(*) filter (where o.estado is distinct from 'cancelled' and (o.devolucion > 0 or o.estado_pago in ('refunded', 'charged_back')))::bigint,
    coalesce(sum(o.devolucion) filter (where o.estado is distinct from 'cancelled'), 0),
    count(*)::bigint,
    count(*) filter (where o.revisiones >= 1)::bigint,
    count(*) filter (where o.revisiones < 2)::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.renglones is null)::bigint,
    count(*) filter (where o.estado is distinct from 'cancelled' and o.total > 0 and o.neto_hoy > 0 and o.neto_hoy >= o.total * 0.99)::bigint,
    coalesce(sum(o.total) filter (where o.estado is distinct from 'cancelled' and o.total > 0 and o.neto_hoy > 0 and o.neto_hoy >= o.total * 0.99), 0)
  from o group by o.fecha order by o.fecha;
$$;

-- Lo que Mercado Pago descuenta de cada peso vendido en las órdenes NORMALES
-- (las que sí traen descuento en el pago), para estimar las que no.
create or replace function cortes_ratio_observado(p_account uuid, p_desde date, p_hasta date)
returns table (ordenes bigint, total numeric, neto numeric)
language sql stable security definer set search_path = public as $$
  select count(*)::bigint, coalesce(sum(o.total), 0), coalesce(sum(coalesce(o.neto_actual, o.neto)), 0)
  from ordenes_neto o
  where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
    and o.estado is distinct from 'cancelled' and o.total > 0
    and coalesce(o.neto_actual, o.neto) > 0 and coalesce(o.neto_actual, o.neto) < o.total * 0.99
    and (auth.role() = 'service_role' or es_mi_cuenta(p_account));
$$;

create or replace function yz_cortes_ratio_observado(p_account uuid, p_desde date, p_hasta date)
returns table (ordenes bigint, total numeric, neto numeric)
language sql stable security definer set search_path = public as $$
  select count(*)::bigint, coalesce(sum(o.total), 0), coalesce(sum(o.neto), 0)
  from yz_ordenes_neto o
  where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
    and o.estado is distinct from 'cancelled' and o.total > 0 and o.neto > 0 and o.neto < o.total * 0.99
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account));
$$;

-- La orden a la que MELI amarra cada cargo facturado, cuando la trae.
alter table meli_cargos add column if not exists orden_id text;
alter table yz_cargos add column if not exists orden_id text;

revoke all on function cortes_ordenes_por_dia(uuid, date, date) from public, anon;
revoke all on function yz_cortes_ordenes_por_dia(uuid, date, date) from public, anon;
revoke all on function cortes_ratio_observado(uuid, date, date) from public, anon;
revoke all on function yz_cortes_ratio_observado(uuid, date, date) from public, anon;
grant execute on function cortes_ordenes_por_dia(uuid, date, date) to authenticated, service_role;
grant execute on function yz_cortes_ordenes_por_dia(uuid, date, date) to authenticated, service_role;
grant execute on function cortes_ratio_observado(uuid, date, date) to authenticated, service_role;
grant execute on function yz_cortes_ratio_observado(uuid, date, date) to authenticated, service_role;
