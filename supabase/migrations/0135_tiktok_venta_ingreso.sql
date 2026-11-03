-- TikTok: la VENTA es lo que TikTok cuenta como ingreso y los cargos van
-- desglosados (dueño, 11-oct-2026: «en TikTok según yo pagamos 6 % de
-- comisión, 8 % de envío y $6 de costo fijo, también afiliados e impuestos;
-- la suma debería ser casi 40 %»).
--
-- Septiembre 2026, pedidos liquidados: el cliente pagó $1,276,208 pero el
-- ingreso de TikTok (`revenue_amount`: precio menos el descuento del
-- vendedor) fue $1,357,487: la diferencia es el descuento que TikTok pone de
-- su bolsa y le paga al vendedor. Medida contra lo que pagó el cliente, la
-- barra de «plataforma» salía en 26–27 %; contra el ingreso de TikTok, los
-- cargos son ~30 % (33.7 % desde que TikTok cobra su 6 %, 24-sep-2026). La
-- misma regla que la reventa de MELI al precio público (0133).
--
-- 1. `pago_desglose` gana el desglose fino desde el crudo (`liquidacion`):
--    servicio (sfp_service_fee, el 8 %), porPar (fee_per_item_sold),
--    comisionTikTok (platform/dynamic/referral/tsp) y anuncios (GMV Max:
--    son PUBLICIDAD, no plataforma).
-- 2. `tiktok_ventas_pedidos` entrega `ingreso` y `anuncios` por pedido.
-- 3. `ventas_por_hora` (gráficas e Inicio) usa el ingreso de TikTok como
--    venta del pedido cuando ya tiene número.

create or replace function public.tiktok_desglose_fino(p_liq jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $f$
  with x as (
    select e as t
    from jsonb_array_elements(coalesce(p_liq->'sku_transactions', p_liq->'unsettled', p_liq->'statement_transactions', '[]'::jsonb)) e
  ),
  v as (
    select k, sum(coalesce(nullif(t->'fee_tax_breakdown'->'fee'->>k, ''), nullif(t->>k, ''), '0')::numeric) as s
    from x, unnest(array[
      'sfp_service_fee_amount', 'fee_per_item_sold_amount',
      'platform_commission_amount', 'dynamic_commission_amount', 'referral_fee_amount', 'tsp_commission_amount',
      'gmv_max_ad_fee_amount', 'gmv_max_coupon_fee', 'tap_shop_ads_commission'
    ]) k
    group by k
  )
  select jsonb_build_object(
    'servicio', abs(coalesce((select s from v where k = 'sfp_service_fee_amount'), 0)),
    'porPar', abs(coalesce((select s from v where k = 'fee_per_item_sold_amount'), 0)),
    'comisionTikTok', abs(coalesce((select sum(s) from v where k in ('platform_commission_amount', 'dynamic_commission_amount', 'referral_fee_amount', 'tsp_commission_amount')), 0)),
    'anuncios', abs(coalesce((select sum(s) from v where k in ('gmv_max_ad_fee_amount', 'gmv_max_coupon_fee', 'tap_shop_ads_commission')), 0))
  );
$f$;

update public.tiktok_ordenes
   set pago_desglose = pago_desglose || public.tiktok_desglose_fino(liquidacion)
 where pago_desglose is not null
   and liquidacion is not null
   and not (pago_desglose ? 'servicio');

create or replace function public.tiktok_ventas_pedidos(p_account uuid, p_desde timestamp with time zone, p_hasta timestamp with time zone)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if not (
    es_mi_cuenta(p_account)
    or es_miembro_tiktok(p_account)
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  ) then
    raise exception 'tiktok_ventas_pedidos: la cuenta % no es tuya', p_account
      using errcode = '42501';
  end if;

  with t as (
    select o.order_id
    from tiktok_ordenes o
    where o.account_id = p_account
      and (
        (o.fecha_creacion >= p_desde and o.fecha_creacion < p_hasta)
        or o.estado in ('UNPAID', 'ON_HOLD', 'AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING')
      )
  ),
  ords as (
    select jsonb_agg(jsonb_build_object(
      'orderId', o.order_id,
      'estado', o.estado,
      'creadoEn', o.fecha_creacion,
      'actualizadoEn', o.fecha_actualizacion,
      'esMuestra', coalesce(o.es_muestra, false),
      'netoRecibido', o.neto_recibido,
      'pagoEsperado', o.pago_esperado,
      'afiliado', o.pago_afiliado,
      'ingreso', o.pago_desglose -> 'ingreso',
      'anuncios', o.pago_desglose -> 'anuncios',
      'destinatario', o.detalle ->> 'destinatario',
      'creador', o.creador,
      'afiliadoLeido', o.afiliado_leido_en is not null
    )) as j
    from tiktok_ordenes o
    join t on t.order_id = o.order_id
    where o.account_id = p_account
  ),
  rens as (
    select jsonb_agg(jsonb_build_object(
      'orderId', i.order_id,
      'skuInterno', i.sku_interno,
      'sellerSku', i.seller_sku,
      'cantidad', coalesce(i.cantidad, 0),
      'precio', i.precio,
      'estado', i.estado
    )) as j
    from tiktok_orden_items i
    join t on t.order_id = i.order_id
    where i.account_id = p_account
  )
  select jsonb_build_object(
    'ordenes', coalesce((select j from ords), '[]'::jsonb),
    'renglones', coalesce((select j from rens), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;

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
    with x as (
      select o.order_id, o.fecha,
        extract(hour from ((o.orden_cruda->>'date_created')::timestamptz at time zone 'UTC' - interval '6 hours'))::int as hora,
        case when o.tipo_venta = 'reventa' and o.total_comprador is not null
             then o.total_comprador - o.total else 0 end as alza,
        coalesce((e->>'unidades')::numeric, 0) as u,
        coalesce((e->>'importe')::numeric, 0) as i
      from ordenes_neto o, jsonb_array_elements(o.renglones) e
      where p_canal = 'meli_calzado' and o.account_id = p_account
        and o.fecha >= p_desde and o.fecha <= p_hasta
        and o.estado is distinct from 'cancelled' and o.renglones is not null
        and coalesce(e->>'sku', '') <> ''
      union all
      select o.order_id, o.fecha,
        extract(hour from ((o.orden_cruda->>'date_created')::timestamptz at time zone 'UTC' - interval '6 hours'))::int,
        case when o.tipo_venta = 'reventa' and o.total_comprador is not null
             then o.total_comprador - o.total else 0 end,
        coalesce((e->>'unidades')::numeric, 0),
        coalesce((e->>'importe')::numeric, 0)
      from yz_ordenes_neto o, jsonb_array_elements(o.renglones) e
      where p_canal = 'meli_fundas' and o.account_id = p_account
        and o.fecha >= p_desde and o.fecha <= p_hasta
        and o.estado is distinct from 'cancelled' and o.renglones is not null
        and coalesce(e->>'sku', '') <> ''
    ),
    ord as (
      -- la reventa sube la venta solo si la orden trae importe en sus renglones,
      -- como `ventas_vivas` (reparte el alza por importe)
      select order_id, fecha, hora, sum(u) as u, sum(i) + case when sum(i) > 0 then max(alza) else 0 end as i
      from x group by order_id, fecha, hora
    ),
    dias_ord as (select fecha, sum(u) u, count(*) o, sum(i) i from ord group by fecha),
    dias_viejos as (
      select v.fecha, sum(v.unidades) u, sum(v.ordenes) o, sum(v.importe) i
      from ventas_diarias v
      where p_canal = 'meli_calzado' and v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
        and not exists (select 1 from dias_ord d where d.fecha = v.fecha)
      group by v.fecha
      union all
      select v.fecha, sum(v.unidades), sum(v.ordenes), sum(v.importe)
      from yz_ventas_diarias v
      where p_canal = 'meli_fundas' and v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
        and not exists (select 1 from dias_ord d where d.fecha = v.fecha)
      group by v.fecha
    ),
    dias as (select * from dias_ord union all select * from dias_viejos),
    horas as (
      select fecha, hora, sum(u) u, count(*) o, sum(i) i from ord where hora is not null group by fecha, hora
    )
    select jsonb_build_object(
      'dias', coalesce((select jsonb_agg(jsonb_build_object('f', fecha, 'u', u, 'o', o, 'i', round(i, 2)) order by fecha) from dias), '[]'::jsonb),
      'horas', coalesce((select jsonb_agg(jsonb_build_object('f', fecha, 'h', hora, 'u', u, 'o', o, 'i', round(i, 2)) order by fecha, hora) from horas), '[]'::jsonb)
    ) into r;

  elsif p_canal = 'tiktok' then
    with o as (
      select t.order_id,
        coalesce(t.fecha_creacion, t.fecha_actualizacion) - interval '6 hours' as local,
        -- la venta es el ingreso de TikTok cuando ya tiene número (0135)
        case when (t.neto_recibido is not null or t.pago_esperado is not null)
             then nullif(t.pago_desglose->>'ingreso', '')::numeric end as ingreso
      from tiktok_ordenes t
      where t.account_id = p_account
        and coalesce(t.fecha_creacion, t.fecha_actualizacion) >= (p_desde::timestamp + interval '6 hours') at time zone 'UTC'
        and coalesce(t.fecha_creacion, t.fecha_actualizacion) < ((p_hasta + 1)::timestamp + interval '6 hours') at time zone 'UTC'
        and not coalesce(t.es_muestra, false)
        and upper(coalesce(t.estado, '')) not in ('UNPAID', 'CANCELLED', 'CANCEL')
    ),
    ord as (
      select o.order_id,
        (o.local at time zone 'UTC')::date as fecha,
        extract(hour from (o.local at time zone 'UTC'))::int as hora,
        sum(it.cantidad) as u,
        coalesce(max(o.ingreso), sum(coalesce(it.precio, 0) * it.cantidad)) as i
      from o join tiktok_orden_items it on it.account_id = p_account and it.order_id = o.order_id
      where it.sku_interno is not null
        and upper(coalesce(it.estado, '')) not in ('UNPAID', 'CANCELLED', 'CANCEL')
      group by 1, 2, 3
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

