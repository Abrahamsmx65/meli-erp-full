-- 0166: ¿qué SKUs tuvieron stock o venta ALGUNA vez? De un jalón.
-- Productos nuevos lo preguntaba producto por producto con 4 consultas
-- `limit 1` (ventas_diarias, stock_snapshots, stock_operaciones,
-- amazon_ventas_diarias): ~22 mil peticiones al día a Supabase (auditoría
-- de costos, 25-nov-2026). Mismas reglas: venta > 0, foto con disponible > 0,
-- movimiento con resultado > 0; en Amazon, venta > 0.
create or replace function public.skus_con_historia(
  p_account uuid,
  p_skus text[],
  p_amazon uuid default null,
  p_skus_amazon text[] default '{}'
)
returns table (canal text, sku text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 'meli'::text, s.sku
  from unnest(coalesce(p_skus, '{}')) as s(sku)
  where (select (coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta(p_account)))
    and (
      exists (select 1 from ventas_diarias v where v.account_id = p_account and v.sku = s.sku and v.unidades > 0)
      or exists (select 1 from stock_snapshots f where f.account_id = p_account and f.sku = s.sku and f.disponible > 0)
      or exists (select 1 from stock_operaciones o where o.account_id = p_account and o.sku = s.sku and o.resultado_disponible > 0)
    )
  union all
  select 'amazon'::text, a.sku
  from unnest(coalesce(p_skus_amazon, '{}')) as a(sku)
  where p_amazon is not null
    and (select (coalesce(auth.role(), '') = 'service_role' or es_mi_cuenta_amazon(p_amazon)))
    and exists (select 1 from amazon_ventas_diarias v where v.account_id = p_amazon and v.seller_sku = a.sku and v.unidades > 0)
$$;

revoke execute on function public.skus_con_historia(uuid, text[], uuid, text[]) from public, anon;
grant execute on function public.skus_con_historia(uuid, text[], uuid, text[]) to authenticated, service_role;
