-- ============================================================================
--  Devoluciones: el par devuelto regresa al stock, así que su COSTO no se
--  perdió. El corte resta lo reembolsado y SUMA de vuelta el costo de los
--  pares devueltos (decisión del dueño). Para saber qué pares llevaba cada
--  orden, calzado también guarda los renglones (sku, unidades, importe,
--  comisión) en ordenes_neto, como ya hacía fundas. Las órdenes devueltas
--  sin renglones (de antes de esto) se estiman con el costo ÷ venta del mes.
--  Las funciones cambian de forma: se recrean.
-- ============================================================================

alter table ordenes_neto add column if not exists renglones jsonb;

drop function if exists cortes_ordenes_por_dia(uuid, date, date);
create function cortes_ordenes_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (
  fecha date, ordenes bigint, neto numeric, cancel_ordenes bigint, cancel_importe numeric,
  dev_ordenes bigint, dev_monto numeric, total bigint, revisadas bigint, pendientes bigint, sin_renglones bigint,
  sin_desc_ordenes bigint, sin_desc_total numeric,
  dev_costo numeric, dev_unidades bigint, dev_sin_costo_unidades bigint, dev_sin_renglones_monto numeric
)
language sql stable security definer set search_path = public as $$
  with o as (
    select o.order_id, o.fecha, o.estado, o.estado_pago, o.total, o.revisiones, o.renglones,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      greatest(0, o.reembolsado - greatest(0, o.neto - coalesce(o.neto_actual, o.neto))) as devolucion
    from ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and (auth.role() = 'service_role' or es_mi_cuenta(p_account))
  ),
  dev as (
    select * from o where o.estado is distinct from 'cancelled' and (o.devolucion > 0 or o.estado_pago in ('refunded', 'charged_back'))
  ),
  -- pares devueltos con su costo por modelo (Productos y costos)
  devr as (
    select d.fecha,
      coalesce((x->>'unidades')::numeric, 0) as unidades,
      pc.costo_mxn
    from dev d
    cross join lateral jsonb_array_elements(d.renglones) as x
    left join skus s on s.account_id = p_account and s.sku = (x->>'sku')
    left join productos_config pc on pc.account_id = p_account and pc.color = ''
      and pc.modelo = coalesce(s.modelo, split_part(x->>'sku', '-', 1))
    where d.renglones is not null
  ),
  devc as (
    select fecha,
      coalesce(sum(unidades * costo_mxn) filter (where costo_mxn is not null), 0) as costo,
      coalesce(sum(unidades), 0)::bigint as unidades,
      coalesce(sum(unidades) filter (where costo_mxn is null), 0)::bigint as sin_costo
    from devr group by fecha
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
    coalesce(sum(o.total) filter (where o.estado is distinct from 'cancelled' and o.total > 0 and o.neto_hoy >= o.total * 0.99), 0),
    coalesce(max(devc.costo), 0),
    coalesce(max(devc.unidades), 0)::bigint,
    coalesce(max(devc.sin_costo), 0)::bigint,
    coalesce(sum(o.devolucion) filter (where o.estado is distinct from 'cancelled' and o.renglones is null and (o.devolucion > 0 or o.estado_pago in ('refunded', 'charged_back'))), 0)
  from o left join devc on devc.fecha = o.fecha
  group by o.fecha order by o.fecha;
$$;

drop function if exists yz_cortes_ordenes_por_dia(uuid, date, date);
create function yz_cortes_ordenes_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (
  fecha date, ordenes bigint, neto numeric, cancel_ordenes bigint, cancel_importe numeric,
  dev_ordenes bigint, dev_monto numeric, total bigint, revisadas bigint, pendientes bigint, sin_renglones bigint,
  sin_desc_ordenes bigint, sin_desc_total numeric,
  dev_costo numeric, dev_unidades bigint, dev_sin_costo_unidades bigint, dev_sin_renglones_monto numeric
)
language sql stable security definer set search_path = public as $$
  with o as (
    select o.order_id, o.fecha, o.estado, o.estado_pago, o.total, o.revisiones, o.renglones,
      case when o.neto_actual is not null and o.neto_actual > 0 then o.neto_actual else o.neto end as neto_hoy,
      greatest(0, o.reembolsado - greatest(0, o.neto - (case when o.neto_actual is not null and o.neto_actual > 0 then o.neto_actual else o.neto end))) as devolucion
    from yz_ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  ),
  dev as (
    select * from o where o.estado is distinct from 'cancelled' and (o.devolucion > 0 or o.estado_pago in ('refunded', 'charged_back'))
  ),
  calzado as (select id from meli_accounts order by creado_en asc limit 1),
  devr as (
    select d.fecha,
      coalesce((x->>'unidades')::numeric, 0) as unidades,
      coalesce(pc.costo_mxn, yc.costo) as costo_mxn
    from dev d
    cross join lateral jsonb_array_elements(d.renglones) as x
    left join yz_skus s on s.account_id = p_account and s.sku = (x->>'sku')
    left join productos_config pc on pc.account_id = (select id from calzado) and pc.color = ''
      and pc.modelo = upper(coalesce(s.diseno, split_part(x->>'sku', '-', 1)))
    left join yz_costos yc on yc.account_id = p_account and yc.modelo = upper(coalesce(s.diseno, split_part(x->>'sku', '-', 1)))
    where d.renglones is not null
  ),
  devc as (
    select fecha,
      coalesce(sum(unidades * costo_mxn) filter (where costo_mxn is not null), 0) as costo,
      coalesce(sum(unidades), 0)::bigint as unidades,
      coalesce(sum(unidades) filter (where costo_mxn is null), 0)::bigint as sin_costo
    from devr group by fecha
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
    coalesce(sum(o.total) filter (where o.estado is distinct from 'cancelled' and o.total > 0 and o.neto_hoy > 0 and o.neto_hoy >= o.total * 0.99), 0),
    coalesce(max(devc.costo), 0),
    coalesce(max(devc.unidades), 0)::bigint,
    coalesce(max(devc.sin_costo), 0)::bigint,
    coalesce(sum(o.devolucion) filter (where o.estado is distinct from 'cancelled' and o.renglones is null and (o.devolucion > 0 or o.estado_pago in ('refunded', 'charged_back'))), 0)
  from o left join devc on devc.fecha = o.fecha
  group by o.fecha order by o.fecha;
$$;

revoke all on function cortes_ordenes_por_dia(uuid, date, date) from public, anon;
revoke all on function yz_cortes_ordenes_por_dia(uuid, date, date) from public, anon;
grant execute on function cortes_ordenes_por_dia(uuid, date, date) to authenticated, service_role;
grant execute on function yz_cortes_ordenes_por_dia(uuid, date, date) to authenticated, service_role;
