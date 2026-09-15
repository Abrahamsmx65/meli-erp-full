-- ============================================================================
--  Los cortes suman las ÓRDENES en la base, no en la página.
--
--  Agosto de calzado son ~35 mil órdenes: traerlas a la página, página por
--  página y con la RLS evaluada renglón por renglón, se pasaba del tiempo
--  límite de Postgres ("canceling statement due to statement timeout") y la
--  pantalla tronaba. Estas funciones (security definer, con el permiso
--  comprobado UNA vez) devuelven lo que el motor necesita: por día, el neto
--  de las órdenes vivas, las canceladas, las devoluciones y el avance de la
--  revisión. Las de fundas además arman los renglones sku|día desde los
--  renglones guardados en cada orden.
--
--  La regla de la devolución es la misma del motor (corte-meli.ts): si
--  Mercado Pago ya bajó el neto, solo se resta lo que falte.
-- ============================================================================

create or replace function cortes_ordenes_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (
  fecha date, ordenes bigint, neto numeric, cancel_ordenes bigint, cancel_importe numeric,
  dev_ordenes bigint, dev_monto numeric, total bigint, revisadas bigint, pendientes bigint, sin_renglones bigint
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
    0::bigint
  from o group by o.fecha order by o.fecha;
$$;

create or replace function yz_cortes_ordenes_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (
  fecha date, ordenes bigint, neto numeric, cancel_ordenes bigint, cancel_importe numeric,
  dev_ordenes bigint, dev_monto numeric, total bigint, revisadas bigint, pendientes bigint, sin_renglones bigint
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
    count(*) filter (where o.estado is distinct from 'cancelled' and o.renglones is null)::bigint
  from o group by o.fecha order by o.fecha;
$$;

-- Renglones sku|día desde las órdenes de fundas (canceladas fuera). Un día
-- con alguna orden cobrada sin neto se deja SIN neto (0): el motor lo estima.
create or replace function yz_cortes_ventas_desde_ordenes(p_account uuid, p_desde date, p_hasta date)
returns table (sku text, fecha date, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric)
language sql stable security definer set search_path = public as $$
  with o as (
    select o.order_id, o.fecha, o.total, o.renglones,
      case when o.neto_actual is not null and o.neto_actual > 0 then o.neto_actual else o.neto end as neto_hoy
    from yz_ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null
      and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  ),
  dias as (
    select o.fecha, bool_or(o.total > 0 and not (o.neto_hoy > 0)) as incompleto from o group by o.fecha
  ),
  r as (
    select o.order_id, o.fecha, o.neto_hoy,
      x->>'sku' as sku,
      coalesce((x->>'unidades')::numeric, 0) as unidades,
      coalesce((x->>'importe')::numeric, 0) as importe,
      coalesce((x->>'comision')::numeric, 0) as comision,
      sum(coalesce((x->>'importe')::numeric, 0)) over (partition by o.order_id) as importe_orden
    from o, jsonb_array_elements(o.renglones) as x
  )
  select r.sku, r.fecha,
    sum(r.unidades)::bigint,
    count(*)::bigint,
    sum(r.importe),
    sum(r.comision),
    case when d.incompleto then 0
         else round(sum(case when r.neto_hoy > 0 and r.importe_orden > 0 then r.neto_hoy * r.importe / r.importe_orden else 0 end), 2) end
  from r join dias d on d.fecha = r.fecha
  where r.sku is not null
  group by r.sku, r.fecha, d.incompleto;
$$;

-- Los renglones diarios de fundas tal cual, sin la RLS renglón por renglón.
create or replace function yz_ventas_renglones(p_account uuid, p_desde date, p_hasta date)
returns table (sku text, fecha date, unidades int, ordenes int, importe numeric, comision numeric, neto numeric)
language sql stable security definer set search_path = public as $$
  select v.sku, v.fecha, v.unidades, v.ordenes, v.importe, v.comision, v.neto
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  order by v.fecha, v.sku;
$$;

revoke all on function cortes_ordenes_por_dia(uuid, date, date) from public, anon;
revoke all on function yz_cortes_ordenes_por_dia(uuid, date, date) from public, anon;
revoke all on function yz_cortes_ventas_desde_ordenes(uuid, date, date) from public, anon;
revoke all on function yz_ventas_renglones(uuid, date, date) from public, anon;
grant execute on function cortes_ordenes_por_dia(uuid, date, date) to authenticated, service_role;
grant execute on function yz_cortes_ordenes_por_dia(uuid, date, date) to authenticated, service_role;
grant execute on function yz_cortes_ventas_desde_ordenes(uuid, date, date) to authenticated, service_role;
grant execute on function yz_ventas_renglones(uuid, date, date) to authenticated, service_role;
