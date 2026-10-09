-- `publicidad_resumen_items` sin ORDER BY: devuelve ~1,200 publicaciones y el
-- API de Supabase entrega 1,000 por respuesta, así que el gasto de ~200
-- publicaciones nunca llegaba a la pantalla de Publicidad. Se lee por páginas
-- (`rpcPaginado`) y paginar exige un orden estable. Mismo cuerpo.
CREATE OR REPLACE FUNCTION public.publicidad_resumen_items(p_account uuid, p_desde date, p_hasta date)
 RETURNS TABLE(item_id text, gasto numeric, clicks bigint, impresiones bigint, unidades_ads numeric, venta_ads numeric, estado text, campana_id text, titulo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with permitido as (
    select (auth.role() = 'service_role' or es_mi_cuenta(p_account)) as ok
  ),
  d as (
    select p.item_id, p.gasto, p.clicks, p.impresiones, p.unidades_ads, p.venta_ads
    from publicidad_diaria p, permitido
    where permitido.ok and p.account_id = p_account
      and p.fecha >= p_desde and p.fecha <= p_hasta
  ),
  ult as (
    select distinct on (p.item_id) p.item_id, p.estado, p.campana_id, p.titulo
    from publicidad_diaria p, permitido
    where permitido.ok and p.account_id = p_account
    order by p.item_id, p.fecha desc
  )
  select d.item_id, sum(d.gasto), sum(d.clicks)::bigint, sum(d.impresiones)::bigint,
         sum(d.unidades_ads), sum(d.venta_ads), u.estado, u.campana_id, u.titulo
  from d join ult u using (item_id)
  group by d.item_id, u.estado, u.campana_id, u.titulo
  order by d.item_id;
$function$;
