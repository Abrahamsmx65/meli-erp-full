-- 0111 · Los RPC de Amazon que corren en el FONDO aceptan al service_role.
--
-- `es_mi_cuenta_amazon` se decide por auth.uid(), y el cron del corte
-- general, el latido (plan de FBA) y la planificación de China llaman a
-- estos RPC con el cliente admin (service_role, sin usuario). Hasta el
-- 6-oct-2026 contestaban «Esa cuenta de Amazon no es tuya» y:
--   · el corte general de TODOS los meses decía «no se pudo leer la
--     economía por producto (SKU Economics)»: la publicidad de Amazon
--     ($443 mil en agosto, $494 mil en septiembre) iba completa como gasto
--     general y la ganancia por modelo de Amazon salía SIN su publicidad
--     (el dueño: «Amazon no está jalando su publicidad»);
--   · `amazon_historia_sku` fallaba en el latido y las reglas de producto
--     NUEVO y SIN VENTA del plan de FBA se apagaban en cada corrida;
--   · `amazon_compras_por_sku` fallaba para el pedido a China del fondo.
-- `amazon_pagos_por_sku` ya lo aceptaba desde la 0098; estos cuatro son los
-- que faltaban. Mismo cuerpo, solo cambia el control de acceso.

create or replace function public.amazon_economia_por_sku(p_account uuid, p_desde date, p_hasta date)
returns table(seller_sku text, unidades numeric, ventas numeric, tarifas numeric, publicidad numeric, neto numeric, ultima_fecha date)
language plpgsql stable security definer
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    select
      e.seller_sku,
      sum(e.unidades)   as unidades,
      sum(e.ventas)     as ventas,
      sum(e.tarifas)    as tarifas,
      sum(e.publicidad) as publicidad,
      sum(e.neto)       as neto,
      max(e.fecha)      as ultima_fecha
    from amazon_economia e
    where e.account_id = p_account
      and e.fecha >= p_desde
      and e.fecha <= p_hasta
    group by e.seller_sku
    order by e.seller_sku;
end;
$function$;

create or replace function public.amazon_economia_cobertura(p_account uuid, p_desde date, p_hasta date)
returns table(cobertura_importe numeric, cobertura_unidades numeric, dias_venta integer, dias_cubiertos integer)
language plpgsql stable security definer
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;
  return query
    with v as (
      select fecha, seller_sku, sum(importe) importe, sum(unidades)::numeric unidades
      from amazon_ventas_diarias
      where account_id = p_account and fecha between p_desde and p_hasta
        and (importe > 0 or unidades > 0)
      group by fecha, seller_sku
    ), e as (
      select fecha, seller_sku, sum(ventas) ventas, sum(unidades) unidades
      from amazon_economia
      where account_id = p_account and fecha between p_desde and p_hasta
      group by fecha, seller_sku
    ), por_sku_dia as (
      select
        v.fecha,
        least(greatest(coalesce(e.ventas, 0), 0), greatest(v.importe, 0)) importe_cubierto,
        greatest(v.importe, 0) importe_vendido,
        least(greatest(coalesce(e.unidades, 0), 0), greatest(v.unidades, 0)) unidades_cubiertas,
        greatest(v.unidades, 0) unidades_vendidas,
        coalesce(e.ventas, 0) >= v.importe
          and coalesce(e.unidades, 0) >= v.unidades as completo
      from v
      left join e using (fecha, seller_sku)
    ), por_dia as (
      select fecha, bool_and(completo) completo
      from por_sku_dia
      group by fecha
    )
    select
      coalesce(sum(importe_cubierto) / nullif(sum(importe_vendido), 0), 1),
      coalesce(sum(unidades_cubiertas) / nullif(sum(unidades_vendidas), 0), 1),
      (select count(*) from por_dia)::integer,
      (select count(*) from por_dia where completo)::integer
    from por_sku_dia;
end;
$function$;

create or replace function public.amazon_historia_sku(p_account uuid)
returns table(seller_sku text, unidades bigint, primera_venta date, primera_foto date)
language plpgsql stable security definer
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    with ventas as (
      select v.seller_sku,
             sum(v.unidades)::bigint                                   as unidades,
             min(v.fecha) filter (where v.unidades > 0)               as primera_venta
        from amazon_ventas_diarias v
       where v.account_id = p_account
       group by v.seller_sku
    ),
    fotos as (
      select s.seller_sku,
             min(s.fecha) filter (where s.total > 0)                  as primera_foto
        from amazon_inventario_snapshots s
       where s.account_id = p_account
       group by s.seller_sku
    )
    select coalesce(v.seller_sku, f.seller_sku) as seller_sku,
           coalesce(v.unidades, 0)::bigint      as unidades,
           v.primera_venta,
           f.primera_foto
      from ventas v
      full outer join fotos f on f.seller_sku = v.seller_sku
     order by 1;
end;
$function$;

create or replace function public.amazon_compras_por_sku(p_account uuid, p_desde date)
returns table(seller_sku text, unidades numeric, dias_agotado integer)
language plpgsql stable security definer
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not es_mi_cuenta_amazon(p_account) then
    raise exception 'Esa cuenta de Amazon no es tuya' using errcode = '42501';
  end if;

  return query
    with v as (
      select av.seller_sku, sum(av.unidades)::numeric as unidades
      from amazon_ventas_diarias av
      where av.account_id = p_account
        and av.fecha >= p_desde
      group by av.seller_sku
    ),
    f as (
      select s.seller_sku, count(*)::integer as dias_agotado
      from amazon_inventario_snapshots s
      where s.account_id = p_account
        and s.fecha >= p_desde
        and coalesce(s.disponible, 0) <= 0
        and not exists (
          select 1
          from amazon_ventas_diarias av
          where av.account_id = p_account
            and av.seller_sku = s.seller_sku
            and av.fecha = s.fecha
            and av.unidades > 0
        )
      group by s.seller_sku
    )
    select v.seller_sku, v.unidades, coalesce(f.dias_agotado, 0)::integer as dias_agotado
    from v
    left join f on f.seller_sku = v.seller_sku
    order by v.seller_sku;
end;
$function$;
