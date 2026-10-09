-- Gráficas de venta POR DÍA y POR HORA en cada canal y en el general
-- (dueño, 9-oct-2026: «una gráfica por horas y por días en todos los canales
-- y en el general»).
--
-- Una sola función contesta los cuatro canales con LAS MISMAS reglas que su
-- pantalla, en hora de México (UTC−6 fijo, como `diaMx`):
--   meli_calzado / meli_fundas: órdenes vivas (`ventas_vivas`), la venta al
--     precio público (reventa reconstruida) y la hora de `orden_cruda.date_created`;
--     un día sin órdenes registradas sale de los renglones diarios, sin hora.
--   tiktok: pedidos en pie (sin muestras, sin pagar ni cancelados), lo cobrado
--     = precio × cantidad de cada renglón con SKU del ERP, como «Cobrado».
--   amazon: por día, `amazon_ventas_diarias` (la de su pantalla); por hora,
--     `amazon_ventas_horas`, que la lectura del reporte llena desde hoy (el
--     reporte trae la hora y la tabla diaria la perdía).
-- Devuelve UN jsonb {dias, horas}: PostgREST entrega a lo más mil renglones y
-- 60 días por hora son 1,440.

create table if not exists public.amazon_ventas_horas (
  account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  fecha date not null,
  hora smallint not null check (hora between 0 and 23),
  unidades integer not null default 0,
  ordenes integer not null default 0,
  importe numeric not null default 0,
  primary key (account_id, fecha, hora)
);
alter table public.amazon_ventas_horas enable row level security;
create policy amazon_ventas_horas_mias on public.amazon_ventas_horas
  for all using (account_id in (select mis_cuentas_amazon()))
  with check (account_id in (select mis_cuentas_amazon()));

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
        coalesce(t.fecha_creacion, t.fecha_actualizacion) - interval '6 hours' as local
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
        sum(coalesce(it.precio, 0) * it.cantidad) as i
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

revoke all on function public.ventas_por_hora(text, uuid, date, date) from public, anon;
grant execute on function public.ventas_por_hora(text, uuid, date, date) to authenticated, service_role;
