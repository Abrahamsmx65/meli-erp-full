-- Fundas: el neto se asienta POR ORDEN, no por día completo.
--
-- Antes un día entraba a yz_ventas_diarias solo cuando TODAS sus órdenes
-- tenían depósito leído (neto_confirmado por renglón sku+día). Con 1,400
-- órdenes al día y la lectura de netos a 1,000 por corrida, casi ningún día
-- se completaba: el panel de Ventas enseñaba $75 mil de neto contra $4.4
-- millones de venta y una ganancia negativa (costo de todas las unidades
-- contra el neto de casi ninguna). Ahora cada renglón sku+día guarda el
-- neto de las órdenes que SÍ tienen depósito y cuánta venta/unidades le
-- falta por leer; la ganancia se calcula solo sobre lo leído (nada se
-- estima) y lo demás se declara.

alter table public.yz_ventas_diarias
  add column if not exists importe_con_neto  numeric not null default 0,
  add column if not exists unidades_con_neto integer not null default 0,
  add column if not exists comision_con_neto numeric not null default 0;

-- Asienta un día: reparte el neto vigente de cada orden con depósito entre
-- sus SKUs en proporción al importe y lo suma por sku.
create or replace function public.yz_asentar_dia(p_account uuid, p_fecha date)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_yz(p_account) then
    raise exception 'sin permiso';
  end if;

  with ord as (
    select o.order_id,
      coalesce(o.neto_actual, o.neto) as saldo,
      (o.neto_en is not null or coalesce(o.neto, 0) > 0) as leido,
      o.renglones
    from yz_ordenes_neto o
    where o.account_id = p_account and o.fecha = p_fecha
      and coalesce(o.estado, '') <> 'cancelled'
      and jsonb_typeof(o.renglones) = 'array'
  ), ren as (
    select ord.order_id, ord.saldo, ord.leido,
      x.sku, coalesce(x.importe, 0)::numeric as importe,
      coalesce(x.unidades, 1)::integer as unidades,
      coalesce(x.comision, 0)::numeric as comision,
      sum(coalesce(x.importe, 0)::numeric) over (partition by ord.order_id) as importe_orden
    from ord, jsonb_to_recordset(ord.renglones) as x(sku text, importe numeric, unidades integer, comision numeric)
    where x.sku is not null
  ), agg as (
    select sku,
      round(coalesce(sum(case when leido and importe_orden > 0 then saldo * importe / importe_orden end), 0), 2) as neto,
      coalesce(sum(importe) filter (where leido), 0) as importe_con_neto,
      coalesce(sum(unidades) filter (where leido), 0)::integer as unidades_con_neto,
      coalesce(sum(comision) filter (where leido), 0) as comision_con_neto
    from ren group by sku
  ), upd as (
    update yz_ventas_diarias v
    set neto = coalesce(a.neto, 0),
        importe_con_neto = coalesce(a.importe_con_neto, 0),
        unidades_con_neto = coalesce(a.unidades_con_neto, 0),
        comision_con_neto = coalesce(a.comision_con_neto, 0),
        neto_confirmado = coalesce(a.unidades_con_neto, 0) >= v.unidades and v.unidades > 0
    from (select v2.sku from yz_ventas_diarias v2 where v2.account_id = p_account and v2.fecha = p_fecha) f
    left join agg a on a.sku = f.sku
    where v.account_id = p_account and v.fecha = p_fecha and v.sku = f.sku
    returning 1
  )
  select count(*) into n from upd;
  return n;
end;
$$;

revoke all on function public.yz_asentar_dia(uuid, date) from public, anon;
grant execute on function public.yz_asentar_dia(uuid, date) to authenticated, service_role;

-- Los resúmenes leen el neto parcial y declaran lo que falta por leer.
create or replace function yz_ventas_resumen(p_account uuid, p_desde date, p_hasta date)
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
    coalesce(sum(v.neto), 0),
    coalesce(sum(greatest(v.unidades - v.unidades_con_neto, 0)), 0)::bigint,
    coalesce(sum(greatest(v.importe - v.importe_con_neto, 0)), 0),
    coalesce(sum(greatest(v.comision - v.comision_con_neto, 0)), 0)
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  group by v.sku;
$$;

create or replace function yz_ventas_por_dia(p_account uuid, p_desde date, p_hasta date)
returns table (fecha date, unidades bigint, importe numeric, neto numeric, importe_sin_neto numeric, comision_sin_neto numeric)
language sql stable security definer set search_path = public as $$
  select v.fecha, sum(v.unidades)::bigint, sum(v.importe),
    coalesce(sum(v.neto), 0),
    coalesce(sum(greatest(v.importe - v.importe_con_neto, 0)), 0),
    coalesce(sum(greatest(v.comision - v.comision_con_neto, 0)), 0)
  from yz_ventas_diarias v
  where v.account_id = p_account and v.fecha >= p_desde and v.fecha <= p_hasta
    and (auth.role() = 'service_role' or es_mi_cuenta_yz(p_account))
  group by v.fecha order by v.fecha;
$$;
