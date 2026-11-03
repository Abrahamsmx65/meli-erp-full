-- TikTok en las gráficas y en Inicio SIN lo de David (dueño, 30-oct-2026:
-- «ayer me sale que hubo 686 unidades vendidas en TikTok y en Ventas TikTok
-- salen 400 y fracción»). La rama `tiktok` de `ventas_por_hora` contaba
-- TODOS los pares de la tienda; Ventas TikTok (y el corte, el correo) quita
-- los de las publicaciones ligadas a un vendedor externo (`skusExternos`):
-- el 29-oct eran 225 pares (196 con nombre GT… y 29 con «D-»). Ahora la
-- serie usa la misma regla, y `inicio_ventas_skus` también.

create or replace function public.ventas_por_hora(p_canal text, p_account uuid, p_desde date, p_hasta date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  r jsonb;
begin
  if p_canal = 'meli_calzado' or p_canal = 'tiktok' then
    if not (coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account)) then
      raise exception 'Esa cuenta no es tuya';
    end if;
  elsif p_canal = 'meli_fundas' then
    if not (coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta_yz(p_account)) then
      raise exception 'Esa cuenta no es tuya';
    end if;
  elsif p_canal = 'amazon' then
    if not (coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta_amazon(p_account)) then
      raise exception 'Esa cuenta no es tuya';
    end if;
  else
    raise exception 'Canal desconocido: %', p_canal;
  end if;

  if p_canal in ('meli_calzado', 'meli_fundas') then
    with h as (
      select fecha, hora, u, o, i from ventas_dia_hora
      where account_id = p_account and canal = p_canal and fecha >= p_desde and fecha <= p_hasta
        and (u <> 0 or o <> 0 or i <> 0)
    ),
    dias as (select fecha, sum(u) u, sum(o) o, sum(i) i from h group by fecha)
    select jsonb_build_object(
      'dias', coalesce((select jsonb_agg(jsonb_build_object('f', fecha, 'u', u, 'o', o, 'i', round(i, 2)) order by fecha) from dias), '[]'::jsonb),
      'horas', coalesce((select jsonb_agg(jsonb_build_object('f', fecha, 'h', hora, 'u', u, 'o', o, 'i', round(i, 2)) order by fecha, hora) from h where hora >= 0), '[]'::jsonb)
    ) into r;

  elsif p_canal = 'tiktok' then
    -- Los pares de las publicaciones ligadas a un vendedor externo (David)
    -- no son venta del dueño: la misma regla que `skusExternos` /
    -- `sinVentasExternas` de Ventas TikTok. En un pedido mixto la venta se
    -- recorta a la parte del dueño por precio (sin precios, por pares).
    with ext as (
      select distinct coalesce(s.sku_interno, s.seller_sku) as sku
      from tiktok_skus s
      join tiktok_productos_externos e on e.account_id = s.account_id and e.product_id = s.product_id
      where s.account_id = p_account and coalesce(s.sku_interno, s.seller_sku) is not null
    ),
    o as (
      select t.order_id,
        coalesce(t.fecha_creacion, t.fecha_actualizacion) - interval '6 hours' as local,
        case when (t.neto_recibido is not null or t.pago_esperado is not null)
             then nullif(t.pago_desglose->>'ingreso', '')::numeric end as ingreso
      from tiktok_ordenes t
      where t.account_id = p_account
        and coalesce(t.fecha_creacion, t.fecha_actualizacion) >= (p_desde::timestamp + interval '6 hours') at time zone 'UTC'
        and coalesce(t.fecha_creacion, t.fecha_actualizacion) < ((p_hasta + 1)::timestamp + interval '6 hours') at time zone 'UTC'
        and not coalesce(t.es_muestra, false)
        and upper(coalesce(t.estado, '')) not in ('UNPAID', 'CANCELLED', 'CANCEL')
    ),
    ren as (
      select o.order_id,
        (o.local at time zone 'UTC')::date as fecha,
        extract(hour from (o.local at time zone 'UTC'))::int as hora,
        sum(it.cantidad) as u_total,
        sum(it.cantidad) filter (where ext.sku is null) as u,
        sum(coalesce(it.precio, 0) * it.cantidad) as p_total,
        sum(coalesce(it.precio, 0) * it.cantidad) filter (where ext.sku is null) as p_propio,
        max(o.ingreso) as ingreso
      from o join tiktok_orden_items it on it.account_id = p_account and it.order_id = o.order_id
      left join ext on ext.sku = it.sku_interno
      where it.sku_interno is not null
        and upper(coalesce(it.estado, '')) not in ('UNPAID', 'CANCELLED', 'CANCEL')
      group by 1, 2, 3
    ),
    ord as (
      select order_id, fecha, hora, u,
        case
          when ingreso is null then coalesce(p_propio, 0)
          when p_total > 0 then ingreso * coalesce(p_propio, 0) / p_total
          else ingreso * u / nullif(u_total, 0)
        end as i
      from ren
      where coalesce(u, 0) > 0
    ),
    dias as (select fecha, sum(u) u, count(*) o, sum(i) i from ord group by fecha),
    horas as (select fecha, hora, sum(u) u, count(*) o, sum(i) i from ord group by fecha, hora)
    select jsonb_build_object(
      'dias', coalesce((select jsonb_agg(jsonb_build_object('f', fecha, 'u', u, 'o', o, 'i', round(i, 2)) order by fecha) from dias), '[]'::jsonb),
      'horas', coalesce((select jsonb_agg(jsonb_build_object('f', fecha, 'h', hora, 'u', u, 'o', o, 'i', round(i, 2)) order by fecha, hora) from horas), '[]'::jsonb)
    ) into r;

  else
    select jsonb_build_object(
      'dias', coalesce((
        select jsonb_agg(jsonb_build_object('f', d.fecha, 'u', d.u, 'o', d.o, 'i', round(d.i, 2)) order by d.fecha)
        from (select fecha, sum(unidades) u, sum(ordenes) o, sum(importe) i
              from amazon_ventas_diarias
              where account_id = p_account and fecha >= p_desde and fecha <= p_hasta
              group by fecha) d), '[]'::jsonb),
      'horas', coalesce((
        select jsonb_agg(jsonb_build_object('f', fecha, 'h', hora, 'u', unidades, 'o', ordenes, 'i', importe) order by fecha, hora)
        from amazon_ventas_horas
        where account_id = p_account and fecha >= p_desde and fecha <= p_hasta), '[]'::jsonb)
    ) into r;
  end if;

  return r;
end;
$function$;


create or replace function public.inicio_ventas_skus(
  p_meli uuid,
  p_amazon uuid,
  p_yz uuid,
  p_desde date,
  p_hasta date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  admin boolean := coalesce(auth.role(), '') = 'service_role';
  ok_meli boolean := p_meli is not null and (admin or es_mi_cuenta(p_meli));
  ok_amz boolean := p_amazon is not null and (admin or es_mi_cuenta_amazon(p_amazon));
  ok_yz boolean := p_yz is not null and (admin or es_mi_cuenta_yz(p_yz));
  r jsonb;
begin
  with ext as (
    select distinct coalesce(s.sku_interno, s.seller_sku) as sku
    from tiktok_skus s
    join tiktok_productos_externos e on e.account_id = s.account_id and e.product_id = s.product_id
    where ok_meli and s.account_id = p_meli and coalesce(s.sku_interno, s.seller_sku) is not null
  ),
  v as (
    select 'meli_calzado'::text as canal, d.sku, sum(d.unidades)::bigint as u, sum(d.importe) as i
    from ventas_dia_sku d
    where ok_meli and d.account_id = p_meli and d.canal = 'meli_calzado'
      and d.fecha >= p_desde and d.fecha <= p_hasta
    group by d.sku
    union all
    select 'meli_fundas', d.sku, sum(d.unidades)::bigint, sum(d.importe)
    from ventas_dia_sku d
    where ok_yz and d.account_id = p_yz and d.canal = 'meli_fundas'
      and d.fecha >= p_desde and d.fecha <= p_hasta
    group by d.sku
    union all
    select 'amazon', a.seller_sku, sum(a.unidades)::bigint, sum(a.importe)
    from amazon_ventas_diarias a
    where ok_amz and a.account_id = p_amazon
      and a.fecha >= p_desde and a.fecha <= p_hasta
    group by a.seller_sku
    union all
    select 'tiktok', t.sku, sum(t.unidades)::bigint, sum(t.importe)
    from tiktok_ventas_diarias t
    where ok_meli and t.account_id = p_meli
      and t.fecha >= p_desde and t.fecha <= p_hasta
      and not exists (select 1 from ext where ext.sku = t.sku)
    group by t.sku
  )
  select coalesce(jsonb_agg(jsonb_build_array(canal, sku, u, i) order by canal, sku), '[]'::jsonb)
  into r
  from v
  where u <> 0 or i <> 0;
  return r;
end;
$$;
