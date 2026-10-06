-- 0112 · `amazon_economia_hueco` acotado: la economía se busca por llave, no
-- agrupando toda la tabla.
--
-- La versión anterior agrupaba TODA `amazon_economia` con fecha <= p_hasta
-- (2.47 millones de renglones) aunque las ventas a revisar fueran cuatro
-- días: desde el 10-sep-2026 el paso `cron_economia` del latido moría por
-- tiempo («canceling statement due to statement timeout») en cada corrida,
-- SKU Economics se quedó en el 30 de septiembre y octubre no tenía
-- publicidad por modelo. Ahora cada (fecha, SKU) vendido se busca en la
-- economía por su llave primaria (account_id, seller_sku, fecha): con el
-- cursor en el 30-sep son unos cientos de lecturas, no millones.

create or replace function public.amazon_economia_hueco(p_account uuid, p_desde date, p_hasta date)
returns table(desde date, hasta date)
language sql stable security definer
set search_path to 'public'
as $function$
  with v as (
    select fecha, seller_sku, sum(importe) importe, sum(unidades)::numeric unidades
    from amazon_ventas_diarias
    where account_id = p_account
      and fecha between coalesce(p_desde, '-infinity'::date) and p_hasta
      and (importe > 0 or unidades > 0)
    group by fecha, seller_sku
  ), faltantes as (
    select v.fecha
    from v
    left join amazon_economia e
      on e.account_id = p_account
     and e.seller_sku = v.seller_sku
     and e.fecha = v.fecha
    where coalesce(e.ventas, 0) < v.importe
       or coalesce(e.unidades, 0) < v.unidades
  )
  select min(fecha), max(fecha) from faltantes having count(*) > 0;
$function$;
