-- Las pantallas de VENTAS cuentan igual que el Estado de resultados y el
-- correo de la mañana (9-oct-2026; dueño: «en el correo me llega diferente
-- info de venta de ayer que lo que veo en el panel», eligió la venta al
-- PRECIO PÚBLICO y «que en todas las secciones la info sea consistente
-- según la misma mecánica»).
--
-- Antes Ventas MELI y Ventas de fundas sumaban ventas_diarias /
-- yz_ventas_diarias: (1) traían órdenes que /orders/{id} tiene CANCELADAS
-- (el 8-oct, 16 pares de calzado), y (2) la venta en REVENTA iba a lo que
-- MELI pagó (unit_price ya neto de comisión y envío), mientras el corte y el
-- correo la reconstruyen al precio que pagó el cliente: el 8-oct el panel
-- decía $222 mil de calzado y el correo $361 mil (1,584 de 1,620 órdenes en
-- reventa). El neto era el mismo.
--
-- Ahora las dos salen de las ÓRDENES VIVAS (`ordenes_neto` /
-- `yz_ordenes_neto`, sin canceladas), y en un día sin órdenes registradas
-- de los renglones diarios de antes, igual que `ventasDelCorte`. La reventa
-- reconstruida (`total_comprador`) sube la venta Y la comisión en la misma
-- cantidad, repartida entre los renglones de la orden por su importe: el
-- neto no cambia.

-- ---------------------------------------------------------------- calzado
create or replace function public.ventas_vivas(p_account uuid, p_desde date, p_hasta date)
returns table(sku text, fecha date, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric, neto_confirmado boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  -- UNA sola pasada por el jsonb de las órdenes (el importe de la orden sale
  -- de una ventana, no de una subconsulta por orden): con toda la historia
  -- son ~155 mil órdenes y la versión de dos pasadas tardaba 7 s.
  with x as (
    select o.order_id, o.fecha, o.total,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      (o.neto_en is not null or o.neto > 0) as neto_conocido,
      case when o.tipo_venta = 'reventa' and o.total_comprador is not null
           then o.total_comprador - o.total else 0 end as alza,
      e->>'sku' as sku,
      coalesce((e->>'unidades')::numeric, 0) as unidades,
      coalesce((e->>'importe')::numeric, 0) as importe,
      coalesce((e->>'comision')::numeric, 0) as comision
    from ordenes_neto o, jsonb_array_elements(o.renglones) as e
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null
      and (select auth.role() = 'service_role' or es_mi_cuenta(p_account))
  ),
  r as (
    select x.*, sum(x.importe) over (partition by x.order_id) as importe_orden from x
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
  dias as (select distinct x.fecha from x)
  select g.sku, g.fecha, g.unidades, g.ordenes, g.importe, g.comision, g.neto, g.neto_confirmado from g
  union all
  select v.sku, v.fecha, v.unidades::bigint, v.ordenes::bigint, v.importe, v.comision, v.neto,
    coalesce(v.neto_confirmado, false)
  from ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (select auth.role() = 'service_role' or es_mi_cuenta(p_account))
    and not exists (select 1 from dias d where d.fecha = v.fecha);
$function$;

create or replace function public.ventas_resumen_sku(p_account uuid, p_desde date, p_hasta date, p_prev_desde date, p_prev_hasta date, p_hoy date)
returns table(sku text, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto_resuelto numeric, importe_neto_real numeric, comision_neto_real numeric, neto_real numeric, unidades_hoy bigint, unidades_prev bigint)
language sql
stable security definer
set search_path to 'public'
as $function$
  select v.sku,
    coalesce(sum(v.unidades) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.ordenes)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(case when v.neto_confirmado and v.neto is not null then v.neto
                      else coalesce(v.importe, 0) - coalesce(v.comision, 0) end)
             filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.neto)     filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.unidades) filter (where v.fecha = p_hoy and v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.unidades) filter (where v.fecha >= p_prev_desde and v.fecha <= p_prev_hasta), 0)::bigint
  from ventas_vivas(p_account, least(p_prev_desde, p_desde), greatest(p_hasta, p_prev_hasta, p_hoy)) v
  group by v.sku
  order by v.sku;
$function$;

create or replace function public.ventas_totales_dia(p_account uuid, p_desde date, p_hasta date)
returns table(fecha date, unidades bigint, ordenes bigint, importe numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  select v.fecha,
    coalesce(sum(v.unidades), 0)::bigint,
    coalesce(sum(v.ordenes), 0)::bigint,
    coalesce(sum(v.importe), 0)
  from ventas_vivas(p_account, p_desde, p_hasta) v
  group by v.fecha order by v.fecha;
$function$;

-- El PLAN de Full solo necesita saber qué SKU vendió alguna vez y cuánto
-- antes de la ventana (rango abierto desde 2020): no enseña dinero y con
-- las órdenes tardaría ~3 s por página en el latido. Sigue leyendo los
-- renglones diarios, como antes.
create or replace function public.ventas_resumen_sku_diarias(p_account uuid, p_desde date, p_hasta date, p_prev_desde date, p_prev_hasta date, p_hoy date)
returns table(sku text, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto_resuelto numeric, importe_neto_real numeric, comision_neto_real numeric, neto_real numeric, unidades_hoy bigint, unidades_prev bigint)
language sql
stable security definer
set search_path to 'public'
as $function$
  select v.sku,
    coalesce(sum(v.unidades) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.ordenes)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(case when v.neto_confirmado and v.neto is not null then v.neto
                      else coalesce(v.importe, 0) - coalesce(v.comision, 0) end)
             filter (where v.fecha >= p_desde and v.fecha <= p_hasta), 0),
    coalesce(sum(v.importe)  filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.comision) filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.neto)     filter (where v.fecha >= p_desde and v.fecha <= p_hasta and v.neto_confirmado), 0),
    coalesce(sum(v.unidades) filter (where v.fecha = p_hoy and v.fecha >= p_desde and v.fecha <= p_hasta), 0)::bigint,
    coalesce(sum(v.unidades) filter (where v.fecha >= p_prev_desde and v.fecha <= p_prev_hasta), 0)::bigint
  from ventas_diarias v
  where v.account_id = p_account and v.fecha >= least(p_prev_desde, p_desde)
    and (select auth.role() = 'service_role' or es_mi_cuenta(p_account))
  group by v.sku
  order by v.sku;
$function$;

revoke all on function public.ventas_resumen_sku_diarias(uuid, date, date, date, date, date) from public, anon;
grant execute on function public.ventas_resumen_sku_diarias(uuid, date, date, date, date, date) to authenticated, service_role;
revoke all on function public.ventas_vivas(uuid, date, date) from public, anon;
grant execute on function public.ventas_vivas(uuid, date, date) to authenticated, service_role;

-- ----------------------------------------------------------------- fundas
create or replace function public.yz_ventas_vivas(p_account uuid, p_desde date, p_hasta date)
returns table(sku text, fecha date, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric,
  unidades_con_neto bigint, importe_con_neto numeric, comision_con_neto numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  with x as (
    select o.order_id, o.fecha,
      coalesce(o.neto_actual, o.neto) as neto_hoy,
      (o.neto_en is not null or o.neto > 0 or not (o.total > 0)) as neto_conocido,
      case when o.tipo_venta = 'reventa' and o.total_comprador is not null
           then o.total_comprador - o.total else 0 end as alza,
      e->>'sku' as sku,
      coalesce((e->>'unidades')::numeric, 0) as unidades,
      coalesce((e->>'importe')::numeric, 0) as importe,
      coalesce((e->>'comision')::numeric, 0) as comision
    from yz_ordenes_neto o, jsonb_array_elements(o.renglones) as e
    where o.account_id = p_account and o.fecha >= p_desde and o.fecha <= p_hasta
      and o.estado is distinct from 'cancelled' and o.renglones is not null
      and (select auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  ),
  r as (
    select x.fecha, x.sku, x.unidades, x.neto_conocido,
      x.importe + a.alza_renglon as importe,
      x.comision + a.alza_renglon as comision,
      case when x.neto_conocido and a.importe_orden > 0 then x.neto_hoy * x.importe / a.importe_orden else 0 end as neto
    from (select x.*, sum(x.importe) over (partition by x.order_id) as importe_orden from x) x
    cross join lateral (select x.importe_orden,
      case when x.importe_orden > 0 then x.alza * x.importe / x.importe_orden else 0 end as alza_renglon) a
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
  dias as (select distinct x.fecha from x)
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

create or replace function public.yz_ventas_resumen(p_account uuid, p_desde date, p_hasta date)
returns table(sku text, unidades bigint, ordenes bigint, importe numeric, comision numeric, neto numeric, unidades_sin_neto bigint, importe_sin_neto numeric, comision_sin_neto numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  select v.sku,
    sum(v.unidades)::bigint,
    sum(v.ordenes)::bigint,
    sum(v.importe),
    sum(v.comision),
    coalesce(sum(v.neto), 0),
    coalesce(sum(greatest(v.unidades - v.unidades_con_neto, 0)), 0)::bigint,
    coalesce(sum(greatest(v.importe - v.importe_con_neto, 0)), 0),
    coalesce(sum(greatest(v.comision - v.comision_con_neto, 0)), 0)
  from yz_ventas_vivas(p_account, p_desde, p_hasta) v
  group by v.sku;
$function$;

create or replace function public.yz_ventas_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table(fecha date, unidades bigint, importe numeric, neto numeric, importe_sin_neto numeric, comision_sin_neto numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  select v.fecha, sum(v.unidades)::bigint, sum(v.importe),
    coalesce(sum(v.neto), 0),
    coalesce(sum(greatest(v.importe - v.importe_con_neto, 0)), 0),
    coalesce(sum(greatest(v.comision - v.comision_con_neto, 0)), 0)
  from yz_ventas_vivas(p_account, p_desde, p_hasta) v
  group by v.fecha order by v.fecha;
$function$;

revoke all on function public.yz_ventas_vivas(uuid, date, date) from public, anon;
grant execute on function public.yz_ventas_vivas(uuid, date, date) to authenticated, service_role;
