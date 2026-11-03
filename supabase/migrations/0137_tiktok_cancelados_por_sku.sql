-- Causas de subida de TikTok: pedidos cancelados por SKU en UNA consulta
-- (11-oct-2026). `causasDeSubida` leía los cancelados con un embebido
-- `tiktok_orden_items!inner(...)` sobre `tiktok_ordenes`, pero las dos tablas
-- no tienen llave entre sí: PostgREST contestaba «Could not find a
-- relationship between 'tiktok_ordenes' and 'tiktok_orden_items'» en cada
-- aviso (cada pocos segundos en los logs) y, por el catch, se frenaba TODA
-- subida del número publicado, también las que sí traían entrada,
-- devolución o ajuste: TikTok se quedaba ofreciendo de menos.
create or replace function public.tiktok_cancelados_por_sku(p_account uuid, p_desde timestamptz, p_skus text[])
returns table(sku text, fecha timestamptz)
language sql
stable security definer
set search_path to 'public'
as $f$
  select i.sku_interno, max(o.fecha_actualizacion)
  from tiktok_orden_items i
  join tiktok_ordenes o on o.account_id = i.account_id and o.order_id = i.order_id
  where i.account_id = p_account
    and i.sku_interno = any(p_skus)
    and o.estado in ('CANCELLED', 'CANCEL')
    and o.fecha_actualizacion > p_desde
    and (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account) or es_miembro_tiktok(p_account))
  group by i.sku_interno
  order by i.sku_interno;
$f$;
revoke all on function public.tiktok_cancelados_por_sku(uuid, timestamptz, text[]) from public, anon;
grant execute on function public.tiktok_cancelados_por_sku(uuid, timestamptz, text[]) to authenticated, service_role;
