-- Causas de subida de TikTok: un pedido CANCELADO cuenta como causa desde
-- que el ERP SE ENTERÓ, no desde la hora de TikTok (17-nov-2026).
--
-- GT135-BEIGE-25-MX: TikTok canceló el 587241906563089898 a las 23:31:20Z; la
-- corrida de las 23:30 ya traía la ventana de pedidos cerrada en 23:31:19 y
-- escribió «4» a TikTok a las 23:31:30; el ERP se enteró de la cancelación a
-- las 23:41:46 (sincronizado_en) y el disponible subió a 5. `causasDeSubida`
-- comparaba la hora de TikTok (23:31:20) contra la última escritura
-- (23:31:30): «sin causa», y la subida 4 → 5 se frenaba en cada corrida
-- mientras hubiera avisos pendientes. La pantalla decía «1 por publicar» y
-- «Publicar disponibilidad» contestaba «nada por publicar».
--
-- La causa es cuando el ERP registró el cambio: el mayor entre la fecha de
-- TikTok y `sincronizado_en`.
create or replace function public.tiktok_cancelados_por_sku(p_account uuid, p_desde timestamptz, p_skus text[])
returns table(sku text, fecha timestamptz)
language sql
stable security definer
set search_path to 'public'
as $f$
  select i.sku_interno, max(greatest(o.fecha_actualizacion, coalesce(o.sincronizado_en, o.fecha_actualizacion)))
  from tiktok_orden_items i
  join tiktok_ordenes o on o.account_id = i.account_id and o.order_id = i.order_id
  where i.account_id = p_account
    and i.sku_interno = any(p_skus)
    and o.estado in ('CANCELLED', 'CANCEL')
    and greatest(o.fecha_actualizacion, coalesce(o.sincronizado_en, o.fecha_actualizacion)) > p_desde
    and (select coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account) or es_miembro_tiktok(p_account))
  group by i.sku_interno
  order by i.sku_interno;
$f$;
revoke all on function public.tiktok_cancelados_por_sku(uuid, timestamptz, text[]) from public, anon;
grant execute on function public.tiktok_cancelados_por_sku(uuid, timestamptz, text[]) to authenticated, service_role;
