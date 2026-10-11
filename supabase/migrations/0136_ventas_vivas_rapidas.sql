-- `ventas_vivas` y `yz_ventas_vivas` rápidas (11-oct-2026; dueño: «sigue
-- igual de mal, tengo que recargar varias veces en cada pestaña»).
--
-- Las dos de la 0133 sacaban el importe de cada orden con una función de
-- ventana sobre TODOS los renglones (`sum() over (partition by order_id)`),
-- que ordenaba ~100 mil renglones y se iba a disco: 7.2 s para 90 días de
-- calzado. Con carga pasaban de los 8 s del `statement_timeout`, el
-- refresco de fondo de Ventas y Publicidad moría («ventas_resumen_sku:
-- canceling statement due to statement timeout» en los logs) y la pantalla
-- se quedaba sirviendo el renglón viejo para siempre. Ahora el importe de
-- la orden sale de sus propios renglones en el mismo paso (lateral, sin
-- ordenar nada) y los días con órdenes salen de las órdenes, no de los
-- renglones: 1.0 s para los mismos 90 días. Mismo resultado al centavo.

create or replace function public.ventas_vivas(p_account uuid, p_desde date, p_hasta date)
 returns table(sku text, fecha date, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric, neto_confirmado boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with o as materialized (
    select o.fecha, o.total,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      (o.neto_en is not null or o.neto > 0) as neto_conocido,
      case when o.tipo_venta = 'reventa' and o.total_comprador is not null
           then o.total_comprador - o.total else 0 end as alza,
      o.renglones
    from ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null
      and (select auth.role() = 'service_role' or es_mi_cuenta(p_account))
  ),
  r as (
    select o.fecha, o.total, o.neto_hoy, o.neto_conocido, o.alza, t.importe_orden,
      e->>'sku' as sku,
      coalesce((e->>'unidades')::numeric, 0) as unidades,
      coalesce((e->>'importe')::numeric, 0) as importe,
      coalesce((e->>'comision')::numeric, 0) as comision
    from o
    cross join lateral (select sum(coalesce((x->>'importe')::numeric, 0)) as importe_orden
                        from jsonb_array_elements(o.renglones) x) t
    cross join lateral jsonb_array_elements(o.renglones) e
  ),
  g as (
    select r.sku, r.fecha,
      sum(r.unidades)::bigint as unidades,
      count(*)::bigint as ordenes,
      round(sum(r.importe + case when r.importe_orden > 0 then r.alza * r.importe / r.importe_orden else 0 end), 2) as importe,
      round(sum(r.comision + case when r.importe_orden > 0 then r.alza * r.importe / r.importe_orden else 0 end), 2) as comision,
      case when bool_or(r.total > 0 and not r.neto_conocido) then 0
           else round(sum(case when r.neto_conocido and r.importe_orden > 0
                               then r.neto_hoy * r.importe / r.importe_orden else 0 end), 2) end as neto,
      not bool_or(r.total > 0 and not r.neto_conocido) as neto_confirmado
    from r
    where r.sku is not null and r.sku <> ''
    group by r.sku, r.fecha
  ),
  dias as (select distinct o.fecha from o)
  select g.sku, g.fecha, g.unidades, g.ordenes, g.importe, g.comision, g.neto, g.neto_confirmado from g
  union all
  select v.sku, v.fecha, v.unidades::bigint, v.ordenes::bigint, v.importe, v.comision, v.neto,
    coalesce(v.neto_confirmado, false)
  from ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (select auth.role() = 'service_role' or es_mi_cuenta(p_account))
    and not exists (select 1 from dias d where d.fecha = v.fecha);
$function$;

create or replace function public.yz_ventas_vivas(p_account uuid, p_desde date, p_hasta date)
 returns table(sku text, fecha date, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric, unidades_con_neto bigint, importe_con_neto numeric, comision_con_neto numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with o as materialized (
    select o.fecha,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      (o.neto_en is not null or o.neto > 0 or not (o.total > 0)) as neto_conocido,
      case when o.tipo_venta = 'reventa' and o.total_comprador is not null
           then o.total_comprador - o.total else 0 end as alza,
      o.renglones
    from yz_ordenes_neto o
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null
      and (select auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  ),
  r as (
    select o.fecha, o.neto_conocido,
      e->>'sku' as sku,
      coalesce((e->>'unidades')::numeric, 0) as unidades,
      coalesce((e->>'importe')::numeric, 0)
        + case when t.importe_orden > 0 then o.alza * coalesce((e->>'importe')::numeric, 0) / t.importe_orden else 0 end as importe,
      coalesce((e->>'comision')::numeric, 0)
        + case when t.importe_orden > 0 then o.alza * coalesce((e->>'importe')::numeric, 0) / t.importe_orden else 0 end as comision,
      case when o.neto_conocido and t.importe_orden > 0
           then o.neto_hoy * coalesce((e->>'importe')::numeric, 0) / t.importe_orden else 0 end as neto
    from o
    cross join lateral (select sum(coalesce((x->>'importe')::numeric, 0)) as importe_orden
                        from jsonb_array_elements(o.renglones) x) t
    cross join lateral jsonb_array_elements(o.renglones) e
  ),
  g as (
    select r.sku, r.fecha,
      sum(r.unidades)::bigint as unidades,
      count(*)::bigint as ordenes,
      round(sum(r.importe), 2) as importe,
      round(sum(r.comision), 2) as comision,
      round(sum(r.neto), 2) as neto,
      coalesce(sum(r.unidades) filter (where r.neto_conocido), 0)::bigint as unidades_con_neto,
      round(coalesce(sum(r.importe) filter (where r.neto_conocido), 0), 2) as importe_con_neto,
      round(coalesce(sum(r.comision) filter (where r.neto_conocido), 0), 2) as comision_con_neto
    from r
    where r.sku is not null and r.sku <> ''
    group by r.sku, r.fecha
  ),
  dias as (select distinct o.fecha from o)
  select g.sku, g.fecha, g.unidades, g.ordenes, g.importe, g.comision, g.neto,
    g.unidades_con_neto, g.importe_con_neto, g.comision_con_neto
  from g
  union all
  select v.sku, v.fecha, v.unidades::bigint, v.ordenes::bigint, v.importe, v.comision, coalesce(v.neto, 0),
    coalesce(v.unidades_con_neto, 0)::bigint, coalesce(v.importe_con_neto, 0), coalesce(v.comision_con_neto, 0)
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (select auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
    and not exists (select 1 from dias d where d.fecha = v.fecha);
$function$;
